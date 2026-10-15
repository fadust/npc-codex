import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInjection, buildScannerPrompt, createNpcRecord, mergeScanResult, normalizeNpcRecord } from '../core.js';
import {
    enforceKnowledgeBoundaries,
    knowledgeFromEditorText,
    knowledgeToEditorText,
    mergeKnowledge,
    normalizeKnowledge,
    readScanKnowledge,
    renderKnowledgeGate,
    textHidesFrom,
} from '../knowledge.js';

const KIM_SECRET = 'Soo-jin secretly signed Eun-ji as co-guarantor on a loan from Hanseong Capital; she must never know.';

function stateWith(...npcs) {
    return { npcs, candidates: [], dismissed: [], turn: 1 };
}

test('knowledge entries normalize kinds, sources and dedupe paraphrases', () => {
    const list = normalizeKnowledge([
        'Kai is doorway-born, from another world',
        { fact: 'Kai is doorway born from another world', kind: 'knows', source: 'heard', from: 'Kai' },
        { text: 'Deserted the Ashen Legion at Callow Ford', stance: 'hidden' },
        { fact: 'The courier was killed by the Gask house', kind: 'does_not_know' },
        { fact: '' },
        null,
    ]);
    assert.equal(list.length, 3);
    assert.deepEqual(list.map(entry => entry.kind), ['knows', 'secret', 'unaware']);
    assert.equal(list[0].source, 'told');
    assert.equal(list[0].from, 'Kai');
});

test('scanner payload accepts knowledge, knows, secrets and unaware arrays', () => {
    const entries = readScanKnowledge({
        knowledge: [{ fact: 'The compass points where you last slept', kind: 'knows', source: 'told' }],
        secrets: ['Was Corporal Sera Duhn of the Ashen Legion'],
        unaware: ['Kai picked the Gask house lock'],
    });
    assert.deepEqual(entries.map(entry => entry.kind), ['knows', 'secret', 'unaware']);
});

test('a later on-page lesson replaces an unaware gate; a secret survives being re-seen as plain knowledge', () => {
    const learned = mergeKnowledge([{ fact: 'Mother signed the loan guarantee in my name', kind: 'unaware' }],
        [{ fact: 'Mother signed the loan guarantee in my name', kind: 'knows', source: 'told' }], { sourceMessageId: 40 });
    assert.equal(learned.length, 1);
    assert.equal(learned[0].kind, 'knows');
    assert.equal(learned[0].sourceMessageId, 40);

    const kept = mergeKnowledge([{ fact: 'Deserted the Ashen Legion at Callow Ford', kind: 'secret' }],
        [{ fact: 'Deserted the Ashen Legion at Callow Ford', kind: 'knows' }]);
    assert.equal(kept[0].kind, 'secret');

    const notForgotten = mergeKnowledge([{ fact: 'Kai is doorway-born', kind: 'knows' }], [{ fact: 'Kai is doorway-born', kind: 'unaware' }]);
    assert.equal(notForgotten[0].kind, 'knows');
});

test('hidden-from detection: direct phrasing, pronoun with an earlier actor, and the holder is never flagged', () => {
    assert.ok(textHidesFrom('Never tell Tomas about Callow Ford', ['Tomas Vantrell', 'Tomas']));
    assert.ok(textHidesFrom('She kept the debt hidden from Eun-ji for a year', ['Eun-ji']));
    assert.ok(textHidesFrom('Eun-ji must never know about the guarantee', ['Eun-ji']));
    assert.ok(textHidesFrom(KIM_SECRET, ['Eun-ji'], { otherLabels: ['Soo-jin'] }));
    assert.equal(textHidesFrom(KIM_SECRET, ['Soo-jin'], { otherLabels: ['Eun-ji'] }), false);
    assert.equal(textHidesFrom('Eun-ji knows the peephole drill', ['Eun-ji']), false);
});

test('the Kim leak: a secret stored on the NPC it is hidden from moves to the holder and gates the victim', () => {
    const eunji = { id: 'e', name: 'Eun-ji', memories: [KIM_SECRET, 'Kai taught her to check the peephole.'], knowledge: [] };
    const soojin = { id: 's', name: 'Soo-jin', memories: [], knowledge: [] };
    const { npcs, changes } = enforceKnowledgeBoundaries([eunji, soojin], { sourceMessageId: 107, turn: 9 });
    const [e, s] = npcs;
    assert.deepEqual(e.memories, ['Kai taught her to check the peephole.']);
    assert.deepEqual(e.knowledge.map(entry => entry.kind), ['unaware']);
    assert.equal(e.knowledge[0].sourceMessageId, 107);
    assert.deepEqual(s.knowledge.map(entry => entry.kind), ['secret']);
    assert.ok(changes.some(change => change.npcId === 'e' && change.action === 'remove-leak'));
    assert.equal(enforceKnowledgeBoundaries(npcs).changes.length, 0, 'guard is idempotent');
});

test('a holder secret naming another NPC gives that NPC an unaware gate and strips repeats from their memories', () => {
    const sera = { id: 'sera', name: 'Sera Vantrell', aliases: ['Sera Duhn'], memories: [], knowledge: [{ fact: 'Deserted the Ashen Legion at Callow Ford; never tell Tomas', kind: 'secret' }] };
    const tomas = { id: 'tomas', name: 'Tomas Vantrell', memories: ['Sera deserted the Ashen Legion at Callow Ford.'], knowledge: [] };
    const { npcs } = enforceKnowledgeBoundaries([sera, tomas]);
    assert.equal(npcs[0], sera, 'unchanged NPCs keep their identity');
    assert.deepEqual(npcs[1].memories, []);
    assert.deepEqual(npcs[1].knowledge.map(entry => entry.kind), ['unaware']);
});

test('mergeScanResult stores scanner knowledge and runs the cross-NPC guard on misattributed memories', () => {
    const eunji = createNpcRecord('Eun-ji');
    const soojin = createNpcRecord('Soo-jin', [eunji.id]);
    const result = mergeScanResult(stateWith(eunji, soojin), {
        npcs: [
            { id: eunji.id, name: 'Eun-ji', present: true, memories: [KIM_SECRET] },
            { id: soojin.id, name: 'Soo-jin', present: true, knowledge: [{ fact: 'The sedan men work for Choi Dong-wook of Hanseong Capital', kind: 'knows', source: 'witnessed' }] },
        ],
    }, { turn: 2, sourceMessageId: 107 });
    const e = result.state.npcs.find(npc => npc.id === eunji.id);
    const s = result.state.npcs.find(npc => npc.id === soojin.id);
    assert.equal(e.memories.length, 0);
    assert.deepEqual(e.knowledge.map(entry => entry.kind), ['unaware']);
    assert.deepEqual(s.knowledge.map(entry => entry.kind).sort(), ['knows', 'secret']);
    assert.ok(result.report.knowledgeGuard.length > 0);
});

test('manual knowledge lock keeps the edited ledger against scanner deltas', () => {
    const npc = createNpcRecord('Ha-neul');
    npc.knowledge = [{ fact: 'Bae works for Choi', kind: 'knows' }];
    npc.manualProfileFields = ['knowledge'];
    const result = mergeScanResult(stateWith(npc), { npcs: [{ id: npc.id, name: 'Ha-neul', present: true, knowledge: [{ fact: 'Kai hides two women upstairs', kind: 'knows' }] }] }, { turn: 2 });
    assert.deepEqual(result.state.npcs[0].knowledge.map(entry => entry.fact), ['Bae works for Choi']);
});

test('stored records round-trip knowledge; editor text round-trips kinds and keeps metadata', () => {
    const record = normalizeNpcRecord({ ...createNpcRecord('Soo-jin'), knowledge: [{ fact: 'Signed Eun-ji as co-guarantor', kind: 'secret', sourceMessageId: 12 }] });
    assert.equal(record.knowledge[0].kind, 'secret');
    const text = knowledgeToEditorText(record.knowledge);
    assert.equal(text, 'secret: Signed Eun-ji as co-guarantor');
    const edited = knowledgeFromEditorText(`${text}\nunaware: Where her ex-husband is\nThe sedan is Choi's`, record.knowledge);
    assert.deepEqual(edited.map(entry => entry.kind), ['secret', 'unaware', 'knows']);
    assert.equal(edited[0].sourceMessageId, 12);
});

test('injection renders the knowledge gate in the essential block, even on the minimum budget', () => {
    const eunji = { ...createNpcRecord('Eun-ji'), present: true, personality: 'Quiet, observant.', knowledge: [{ fact: KIM_SECRET, kind: 'unaware' }] };
    const text = buildInjection([eunji], 'Eun-ji watches the door.', 1, 3);
    assert.match(text, /KNOWLEDGE GATES ARE HARD LIMITS/);
    assert.match(text, /- Eun-ji: KNOWLEDGE GATE \(authoritative\): does NOT know[^\n]*; IDENTITY/);
    const soojin = { ...createNpcRecord('Soo-jin'), present: true, personality: 'Sharp, guarded, pragmatic. '.repeat(20), knowledge: [{ fact: 'Signed Eun-ji as co-guarantor', kind: 'secret' }] };
    const tight = buildInjection([{ ...eunji, personality: 'Quiet, observant. '.repeat(30) }, soojin], 'Eun-ji and Soo-jin talk.', 1, 3, undefined, 1);
    assert.match(tight, /KNOWLEDGE GATE \(authoritative\): does NOT know/, 'minimum budget still carries the gate');
    const gate = renderKnowledgeGate({ knowledge: [{ fact: 'x '.repeat(200), kind: 'knows' }, { fact: 'must stay hidden', kind: 'unaware' }] }, 120);
    assert.ok(gate.startsWith('KNOWLEDGE GATE (authoritative): does NOT know'), 'unaware renders first so caps never drop it');
    assert.ok(gate.length <= 120);
    const plain = buildInjection([{ ...createNpcRecord('Pell'), present: true, personality: 'Terse.' }], 'Pell works.', 1, 3);
    assert.doesNotMatch(plain, /KNOWLEDGE/);
});

test('scanner prompt carries the knowledge rule and existing ledger for dedupe', () => {
    const eunji = { ...createNpcRecord('Eun-ji'), present: true, knowledge: [{ fact: 'Mother signed the guarantee', kind: 'unaware' }] };
    const prompt = buildScannerPrompt({ transcript: 'Eun-ji: "Americano."', existingNpcs: [eunji], userName: 'Kai', charName: 'The Kim Women' });
    assert.match(prompt, /KNOWLEDGE \(who knows what\)/);
    assert.match(prompt, /unaware: Mother signed the guarantee/);
});

test('knowledge pass targets only named dossiers on information-bearing exchanges', async () => {
    const { knowledgePassTargets, knowledgePassRelevant } = await import('../knowledge.js');
    const npcs = [{ id: 's', name: 'Soo-jin' }, { id: 'e', name: 'Eun-ji' }, { id: 'h', name: 'Park Ha-neul', aliases: ['Ha-neul'] }, { id: 'x', name: 'Dead Man', lifeState: 'deceased' }];
    assert.equal(knowledgePassRelevant('Rain all day. Ramyeon for lunch.'), false);
    assert.deepEqual(knowledgePassTargets(npcs, 'Eun-ji ate ramyeon with Kai.'), []);
    const text = 'While Eun-ji showered, Soo-jin confessed the guarantee. "She must never know." Dead Man watched.';
    assert.deepEqual(knowledgePassTargets(npcs, text).map(npc => npc.id), ['s', 'e']);
    assert.deepEqual(knowledgePassTargets(npcs, 'Ha-neul whispered that Bae tips like a dead man.').map(npc => npc.id), ['h']);
});

test('knowledge pass prompt, parse and apply: decisions merge per target and the guard still runs', async () => {
    const { buildKnowledgePassPrompt, parseKnowledgePass, applyKnowledgeDecisions } = await import('../knowledge.js');
    const targets = [{ id: 's', name: 'Soo-jin', knowledge: [] }, { id: 'e', name: 'Eun-ji', knowledge: [], memories: [] }];
    const prompt = buildKnowledgePassPrompt({ transcript: 'Soo-jin confessed.', targets, userName: 'Kai' });
    assert.match(prompt, /"id":"s"/);
    assert.match(prompt, /Kai is the player/);
    const decisions = parseKnowledgePass({ npcs: [
        { id: 's', knowledge: [{ fact: 'Soo-jin forged Eun-ji\'s seal as co-guarantor and hides it from Eun-ji', kind: 'secret' }] },
        { name: 'Eun-ji', knowledge: [{ fact: 'Soo-jin forged Eun-ji\'s seal as co-guarantor', kind: 'unaware' }] },
        { id: 'stranger', knowledge: [{ fact: 'ignored', kind: 'knows' }] },
    ] }, targets);
    assert.deepEqual([...decisions.keys()], ['s', 'e']);
    const locked = { id: 'e2', name: 'Eun-ji', knowledge: [], manualProfileFields: ['knowledge'] };
    const { npcs, applied } = applyKnowledgeDecisions([targets[0], targets[1], locked], new Map([...decisions, ['e2', decisions.get('e')]]), { sourceMessageId: 9 });
    assert.equal(applied, 2);
    assert.equal(npcs[0].knowledge[0].kind, 'secret');
    assert.equal(npcs[1].knowledge[0].kind, 'unaware');
    assert.equal(npcs[1].knowledge[0].sourceMessageId, 9);
    assert.equal(npcs[2], locked, 'manual knowledge lock is respected');
});
