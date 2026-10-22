import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyRelationshipDelta, buildRelationshipPassPrompt, filterHearsayRelationshipDelta, relationshipValuesText } from '../core.js';
import { buildCastPassPrompt } from '../cast.js';
import { KNOWLEDGE_SHAREABILITY_RULE, newPlayerKnowledge, propagatePlayerKnowledge } from '../knowledge.js';
import { normalizeSocialGraph } from '../social.js';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const ALMS = { fact: 'Kai gave alms to the poor at the cathedral steps', kind: 'knows', source: 'witnessed' };

function npc(id, name, extra = {}) {
    return { id, name, aliases: [], knowledge: [], ...extra };
}

function tie(aId, bId) {
    return normalizeSocialGraph({ edges: [{ aId, bId, aToB: 'colleague', bToA: 'colleague', confidence: 'explicit' }] });
}

// The participation check is internal to index.js; evaluate its own source with a stubbed name matcher.
function relevanceCheck(named = false) {
    const start = index.indexOf('function currentExchangeRelationshipRelevant');
    const source = index.slice(start, index.indexOf('\nfunction ', start + 10));
    return new Function('transcriptMentionsNpcRecord', `${source}; return currentExchangeRelationshipRelevant;`)(() => named);
}

test('an unnamed NPC the single-reply scan reports present is a relationship target', () => {
    const relevant = relevanceCheck(false);
    const almoner = npc('npc_almoner', 'the almoner');
    assert.equal(relevant(almoner, 'Kai presses coins into a beggar\'s hand.', { present: true }, { currentExchangeOnly: true, presentCounts: true }), true);
    // Full-window scans keep the name-only rule: presence there may be historical.
    assert.equal(relevant(almoner, 'Kai presses coins into a beggar\'s hand.', { present: true }, { currentExchangeOnly: true, presentCounts: false }), false);
    assert.equal(relevant(almoner, 'Kai presses coins into a beggar\'s hand.', { present: false }, { currentExchangeOnly: true, presentCounts: true }), false);
    assert.match(index, /presentCounts: !options\.currentExchangeOnly/);
});

test('a player fact travels only along an existing social-graph tie, recorded as told by the teller', () => {
    const almoner = npc('npc_almoner', 'the almoner', { knowledge: [ALMS] });
    const bishop = npc('npc_bishop', 'Bishop Aldric');
    const linked = propagatePlayerKnowledge([almoner, bishop], tie(almoner.id, bishop.id), 'Kai');
    const told = linked.npcs[1].knowledge.find(entry => entry.source === 'told');
    assert.equal(told.fact, 'Kai gave alms to the poor at the cathedral steps (told by the almoner)');
    assert.equal(told.from, 'the almoner');
    assert.equal(told.kind, 'knows');
    assert.deepEqual(linked.told.map(item => item.npcId), ['npc_bishop']);

    const unlinked = propagatePlayerKnowledge([almoner, bishop], normalizeSocialGraph({ edges: [] }), 'Kai');
    assert.deepEqual(unlinked.npcs[1].knowledge, []);
    assert.equal(unlinked.told.length, 0);
});

test('secret facts never travel, and an unaware receiver blocks the fact', () => {
    const confession = { fact: 'Kai confessed to stealing the reliquary', kind: 'secret', source: 'witnessed' };
    const priest = npc('npc_priest', 'Father Oren', { knowledge: [confession] });
    const bishop = npc('npc_bishop', 'Bishop Aldric');
    assert.equal(propagatePlayerKnowledge([priest, bishop], tie(priest.id, bishop.id), 'Kai').told.length, 0);

    // "You may tell the Bishop": the cast pass records it as shareable knowledge, so it travels.
    const allowed = { ...priest, knowledge: [{ ...confession, kind: 'knows' }] };
    assert.equal(propagatePlayerKnowledge([allowed, bishop], tie(priest.id, bishop.id), 'Kai').told.length, 1);

    const gated = npc('npc_bishop', 'Bishop Aldric', { knowledge: [{ fact: 'Kai gave alms to the poor at the cathedral steps', kind: 'unaware' }] });
    const almoner = npc('npc_almoner', 'the almoner', { knowledge: [ALMS] });
    assert.equal(propagatePlayerKnowledge([almoner, gated], tie(almoner.id, gated.id), 'Kai').told.length, 0);

    assert.match(KNOWLEDGE_SHAREABILITY_RULE, /confession to clergy/);
    assert.ok(buildCastPassPrompt({ transcript: 'Kai kneels in the confessional.' }).includes(KNOWLEDGE_SHAREABILITY_RULE));
});

test('a fact moves one hop per scan', () => {
    const almoner = npc('npc_almoner', 'the almoner', { knowledge: [ALMS] });
    const bishop = npc('npc_bishop', 'Bishop Aldric');
    const cardinal = npc('npc_cardinal', 'Cardinal Vey');
    const graph = normalizeSocialGraph({ edges: [
        { aId: almoner.id, bId: bishop.id, aToB: 'superior', bToA: 'subordinate', confidence: 'explicit' },
        { aId: bishop.id, bId: cardinal.id, aToB: 'superior', bToA: 'subordinate', confidence: 'explicit' },
    ] });
    const first = propagatePlayerKnowledge([almoner, bishop, cardinal], graph, 'Kai');
    assert.deepEqual(first.told.map(item => item.npcId), ['npc_bishop']);
    const second = propagatePlayerKnowledge(first.npcs, graph, 'Kai');
    assert.deepEqual(second.told.map(item => item.npcId), ['npc_cardinal']);
    // The relay names the latest teller, and nobody learns it twice.
    assert.match(second.told[0].fact, /\(told by Bishop Aldric\)$/);
    assert.doesNotMatch(second.told[0].fact, /almoner/);
    assert.equal(propagatePlayerKnowledge(second.npcs, graph, 'Kai').told.length, 0);
    // The receivers of this scan are relationship targets with how they learned.
    const learned = newPlayerKnowledge([almoner, bishop, cardinal], first.npcs, 'Kai');
    assert.deepEqual([...learned.keys()], ['npc_bishop']);
});

test('a change driven only by a told fact is capped at ordinary impact on one axis and needs grounded values', () => {
    const bishop = npc('npc_bishop', 'Bishop Aldric', { role: 'Bishop', beliefs: [{ about: 'world', belief: 'Charity to the poor is the highest devotion' }] });
    const knowledge = 'Kai gave alms to the poor at the cathedral steps (told by the almoner)';
    const values = relationshipValuesText(bishop);
    const delta = filterHearsayRelationshipDelta(
        { trust: 2, affection: 5, desire: 0, tension: -2 },
        { trust: 'Kai gave alms', affection: 'Kai gave alms to the poor', desire: '', tension: 'alms eased him' },
        'devotion to charity',
        { knowledge, values },
    );
    assert.deepEqual(delta, { trust: 0, affection: 1, desire: 0, tension: 0 });
    // Evidence from outside the receiver's knowledge entry, or a value it does not hold, moves nothing.
    assert.deepEqual(filterHearsayRelationshipDelta({ trust: 0, affection: 2, desire: 0, tension: 0 }, { affection: 'Kai rescued a child from the river' }, 'devotion to charity', { knowledge, values }), { trust: 0, affection: 0, desire: 0, tension: 0 });
    assert.deepEqual(filterHearsayRelationshipDelta({ trust: 0, affection: 2, desire: 0, tension: 0 }, { affection: 'Kai gave alms to the poor' }, 'love of gambling', { knowledge, values }), { trust: 0, affection: 0, desire: 0, tension: 0 });
    // Applied at ordinary impact, inertia and milestones are unchanged.
    const update = applyRelationshipDelta({ trust: 0, affection: 0, desire: 0, tension: 0 }, delta, 'ordinary');
    assert.equal(update.relationship.affection, 1);
    assert.match(index, /hearsayOnly \? 'ordinary' : normalized\.relationshipImpact/);
});

test('the evaluator gets each target\'s values and how it learned, and asks for the reason chain', () => {
    const bishop = npc('npc_bishop', 'Bishop Aldric', { role: 'Bishop', likes: ['almsgiving'], dislikes: ['greed'] });
    const learned = new Map([[bishop.id, [{ fact: 'Kai gave alms (told by the almoner)', kind: 'knows', source: 'told', from: 'the almoner' }]]]);
    const prompt = buildRelationshipPassPrompt({ transcript: 'Kai gave alms.', targets: [bishop], userName: 'Kai', learned });
    const target = JSON.parse(prompt.match(/Targets: (.*)\r?\n/)[1])[0];
    assert.equal(target.values, 'Bishop; likes almsgiving; dislikes greed');
    assert.deepEqual(target.learnedOf, [{ fact: 'Kai gave alms (told by the almoner)', how: 'told by the almoner' }]);
    assert.match(prompt, /not generic morality/);
    assert.match(prompt, /reached the Bishop via the almoner; matches his devotion to charity/);
    assert.match(prompt, /"relationshipValue"/);
});
