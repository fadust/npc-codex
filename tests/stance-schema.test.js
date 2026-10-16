import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord, buildInjection } from '../core.js';
import { castDecisionsToScan, buildCastPassPrompt } from '../cast.js';
import { applyStanceDecisions, readStanceDecisions, renderStanceInjection, stanceBand, temperamentExpression, temperamentOf } from '../stance.js';
import { applySchemaToDelta, findWorldSchema, parseWorldSchema, schemaPromptLine } from '../schema.js';

const HOSTILE = { trust: -60, affection: -70, desire: 0, tension: 60 };
const WARM = { trust: 50, affection: 60, desire: 10, tension: 5 };

test('S2.9: the same stance reads through each temperament', () => {
    const calm = { ...createNpcRecord('Hana'), personality: 'Calm, measured, rarely raises her voice.' };
    const fiery = { ...createNpcRecord('Bo'), personality: 'Hot-tempered and brash, quick to anger.' };
    assert.equal(temperamentOf(calm), 'calm');
    assert.equal(temperamentOf(fiery), 'fiery');
    assert.equal(stanceBand(HOSTILE), 'hostile');
    assert.equal(stanceBand(WARM), 'warm');
    assert.match(temperamentExpression(calm, HOSTILE), /cold, clipped, controlled distance; never loud/);
    assert.match(temperamentExpression(calm, WARM), /quiet steadiness/);
    assert.match(temperamentExpression(fiery, HOSTILE), /sharp open anger/);
    assert.equal(temperamentExpression({ ...createNpcRecord('X') }, HOSTILE), '', 'no temperament known, no blend');
    const line = buildInjection([{ ...calm, present: true, relationship: HOSTILE }], 'Hana', 5).split('\n').find(item => item.startsWith('- Hana'));
    assert.match(line, /PLAYER RELATIONSHIP \(secondary modifier\): .*through a calm temperament this shows as cold, clipped/);
});

test('NPC stances: both present, never toward the player, small steps, injected only toward people in the scene', () => {
    const aria = { ...createNpcRecord('Aria'), personality: 'Proud and formal.' };
    const kael = createNpcRecord('Kael', [aria.id]);
    const decisions = readStanceDecisions('Aria', [
        { toward: 'Kael', trust: -1, affection: 0, tension: 2, note: 'thinks he is too naive' },
        { toward: 'Kai', trust: 2 },
        { toward: 'Mira', trust: 1 },
    ], { present: ['Aria', 'Kael'], userName: 'Kai' });
    assert.equal(decisions.length, 1);
    let npcs = applyStanceDecisions([aria, kael], decisions, { turn: 3 }).npcs;
    for (let i = 0; i < 2; i += 1) npcs = applyStanceDecisions(npcs, decisions, { turn: 4 + i }).npcs;
    assert.deepEqual(npcs[0].stances[0], { toward: 'Kael', trust: -24, affection: 0, tension: 48, note: 'thinks he is too naive', turn: 5 });
    assert.equal(renderStanceInjection(npcs[0], { presentNames: ['Aria'] }), '');
    assert.equal(renderStanceInjection(npcs[0], { presentNames: ['Aria', 'Kael'] }), 'toward others here: Kael: wary (thinks he is too naive), shows as formal; keeps rank and distance');
    assert.match(buildInjection(npcs.map(npc => ({ ...npc, present: true })), 'Aria and Kael', 6), /toward others here: Kael: wary/);
});

test('cast pass returns stances that resolve to dossier names', () => {
    const aria = createNpcRecord('Aria');
    const out = castDecisionsToScan({ people: [
        { ref: 'Aria', is: aria.id, present: true, stances: [{ toward: 'the young knight', trust: -1, note: 'naive' }] },
        { ref: 'the young knight', is: 'new', name: 'Kael', present: true },
    ] }, { transcript: 'Aria rolls her eyes at the young knight.', npcs: [aria], userName: 'Kai' });
    assert.deepEqual(out.stances.map(item => [item.who, item.toward, item.trust]), [['Aria', 'Kael', -1]]);
});

test('S2.13 schema: parsed from a card block or a lorebook entry; prompt names it', () => {
    const text = 'attributes: STR, DEX, INT\npools: HP, Stamina\nranks: Iron < Bronze < Silver < Gold\nskills: Swordsmanship, Tracking';
    assert.deepEqual(parseWorldSchema(text), { attributes: ['STR', 'DEX', 'INT'], pools: ['HP', 'Stamina'], ranks: ['Iron', 'Bronze', 'Silver', 'Gold'], skills: ['Swordsmanship', 'Tracking'] });
    assert.deepEqual(parseWorldSchema('ranks: S > A > B').ranks, ['B', 'A', 'S'], '">" reads high to low');
    assert.equal(findWorldSchema({ cardText: `Intro.\n[NPC Codex Schema]\n${text}\n[/NPC Codex Schema]` }).source, 'card');
    assert.equal(findWorldSchema({ entries: [{ world: 'Drakmor', comment: 'NPC Codex Schema', key: [], content: text }] }).source, 'Drakmor');
    assert.equal(findWorldSchema({ entries: [{ comment: 'Guild hall', content: text }] }), null);
    assert.match(buildCastPassPrompt({ transcript: 'x', schema: parseWorldSchema(text) }), /WORLD SCHEMA \(use exactly these names; nothing outside a listed set\): attributes STR, DEX, INT; pools HP, Stamina; ranks low->high Iron < Bronze < Silver < Gold; skills Swordsmanship, Tracking\./);
});

test('S2.13 schema: sheet changes are kept on the schema', () => {
    const schema = parseWorldSchema('attributes: STR, DEX\nranks: Iron < Bronze < Silver\npools: HP');
    const { delta, rejected } = applySchemaToDelta({ attributes: [{ name: 'str', value: '14' }, { name: 'Charisma', value: '9' }], pools: [{ name: 'hp', current: 5, max: 10 }, { name: 'Mana', current: 1, max: 2 }], skills: [{ name: 'Cooking' }], rank: 'bronze' }, schema);
    assert.deepEqual(delta.attributes, [{ name: 'STR', value: '14' }]);
    assert.deepEqual(delta.pools, [{ name: 'HP', current: 5, max: 10 }]);
    assert.deepEqual(delta.skills, [{ name: 'Cooking' }], 'no skill list defined: skills stay open');
    assert.equal(delta.rank, 'Bronze');
    assert.equal(rejected.length, 2);
    assert.equal(applySchemaToDelta({ rank: 'Platinum' }, schema).delta.rank, '');
});
