import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord, mergeScanResult, normalizeNpcRecord, buildInjection } from '../core.js';
import { castDecisionsToScan, castSignals } from '../cast.js';
import {
    applyMemoryDecision,
    episodesFromEditorText,
    episodesToEditorText,
    memoryContext,
    readMemoryDecision,
    renderMemoryInjection,
} from '../memory.js';

const MINE = 'In the collapsed mine Kai promised Sera he would come back for her, then left her alone in the dark until dawn. Sera kept the lantern burning and swore she would repay the Guild debt before the festival.';

test('only witnesses gain memories; ungrounded or hidden events are rejected; max 2 new', () => {
    const sera = { ...createNpcRecord('Sera'), knowledge: [{ fact: 'Kai sold the map to the Guild', kind: 'unaware' }] };
    const decision = readMemoryDecision({
        present: true,
        memory: { ops: [
            { op: 'add', event: 'Kai promised to come back, then left her alone in the dark until dawn', effect: 'doubts Kai’s promises', level: 'defining', fit: 'contradicts' },
            { op: 'add', event: 'Kai sold the map to the Guild', effect: 'betrayed', level: 'defining' },
            { op: 'add', event: 'Sera fought a dragon on the bridge', level: 'significant' },
            { op: 'add', event: 'Sera kept the lantern burning', level: 'minor' },
            { op: 'add', event: 'Sera swore to repay the Guild debt', level: 'minor' },
        ], intents: [{ op: 'add', what: 'repay the Guild debt', due: 'before the festival' }] },
    }, { transcript: `${MINE} Kai sold the map to the Guild.`, npc: sera });
    assert.equal(decision.ops.length, 2);
    assert.equal(decision.ops[0].episode.level, 'defining');
    assert.ok(decision.rejected.some(reason => /hidden from them/.test(reason)));
    assert.ok(decision.rejected.some(reason => /not in exchange/.test(reason)));
    assert.ok(decision.rejected.some(reason => /per-turn limit/.test(reason)));
    assert.equal(decision.intents.length, 1);

    const absent = readMemoryDecision({ present: false, memory: { ops: [{ op: 'add', event: 'Kai promised to come back', level: 'minor' }] } }, { transcript: MINE });
    assert.equal(absent.ops.length, 0);
});

test('ops revise instead of duplicate; delete spares pinned; intents close by id', () => {
    let npc = createNpcRecord('Sera');
    npc = applyMemoryDecision(npc, { ops: [{ op: 'add', episode: { event: 'Kai left her alone in the mine', effect: 'doubts Kai', level: 'defining' } }], intents: [{ op: 'add', intention: { what: 'repay the Guild debt', due: 'festival' } }] }, { turn: 3 }).npc;
    npc = applyMemoryDecision(npc, { ops: [{ op: 'add', episode: { event: 'Kai left her alone in the mine', level: 'minor' } }] }, { turn: 4 }).npc;
    assert.equal(npc.episodes.length, 1, 'a repeated event is not stored twice');
    assert.deepEqual(npc.episodes[0], { id: 'm1', event: 'Kai left her alone in the mine', effect: 'doubts Kai', level: 'defining', turn: 3 });
    npc = applyMemoryDecision(npc, { ops: [{ op: 'update', id: 'm1', episode: { event: 'Kai left her alone in the mine, but came back with help', effect: 'trust slowly mending', level: 'defining' } }], intents: [{ op: 'done', id: 'i1' }] }, { turn: 9 }).npc;
    assert.equal(npc.episodes[0].effect, 'trust slowly mending');
    assert.equal(npc.intentions[0].status, 'done');
    npc = { ...npc, episodes: [{ ...npc.episodes[0], pinned: true }] };
    assert.equal(applyMemoryDecision(npc, { ops: [{ op: 'delete', id: 'm1' }] }).npc.episodes.length, 1);
});

test('injection leads with the effect, carries relative time and open intents; legacy memories migrate', () => {
    const npc = normalizeNpcRecord({ ...createNpcRecord('Sera'), episodes: [
        { id: 'm1', event: 'Kai left her alone in the mine', effect: 'doubts Kai’s promises', level: 'defining', turn: 2 },
        { id: 'm2', event: 'shared a joke about the goat', level: 'minor', turn: 48 },
    ], intentions: [{ id: 'i1', what: 'repay the Guild debt', due: 'festival', status: 'open' }] });
    const line = renderMemoryInjection(npc, { turn: 50 });
    assert.match(line, /never recite/);
    assert.match(line, /doubts Kai’s promises \(Kai left her alone in the mine, long ago\)/);
    assert.match(line, /shared a joke about the goat \(just now\)/);
    assert.match(line, /still means to \/ unresolved: repay the Guild debt \(by festival\)/);
    assert.match(buildInjection([{ ...npc, present: true }], 'Sera', 50), /lived memories/);

    const legacy = normalizeNpcRecord({ ...createNpcRecord('Old'), memories: ['Saved the mayor from the fire'] });
    assert.equal(legacy.episodes[0].event, 'Saved the mayor from the fire');
    assert.deepEqual(memoryContext(legacy).memories, ['m1 [significant] Saved the mayor from the fire']);
});

test('editor round-trip keeps ids, levels, pins and effects', () => {
    const npc = { episodes: [{ id: 'm4', event: 'Kai left her in the mine', effect: 'doubts Kai', level: 'defining', turn: 2 }] };
    const text = episodesToEditorText(npc);
    assert.equal(text, 'defining: Kai left her in the mine => doubts Kai');
    const back = episodesFromEditorText(`* ${text}\nminor: laughed at the goat`, npc.episodes);
    assert.deepEqual(back[0], { id: 'm4', event: 'Kai left her in the mine', effect: 'doubts Kai', level: 'defining', turn: 2, pinned: true });
    assert.equal(back[1].level, 'minor');
});

test('cast pass: a known NPC triggers the memory pass; the decision lands on the dossier through the merge', () => {
    const sera = createNpcRecord('Sera');
    assert.equal(castSignals('Sera looks away.', { knownLabels: ['Sera'] }).memory, true);
    const cast = castDecisionsToScan({ people: [{ ref: 'Sera', is: sera.id, present: true, memory: { ops: [{ op: 'add', event: 'Kai promised Sera he would come back for her', effect: 'hopes, warily', level: 'significant' }] } }] }, { transcript: MINE, npcs: [sera] });
    const merged = mergeScanResult({ npcs: [sera], candidates: [], dismissed: [], turn: 5 }, { npcs: cast.npcs }, { turn: 5, sourceMessageId: 9 });
    const stored = merged.state.npcs[0].episodes;
    assert.equal(stored.length, 1);
    assert.equal(stored[0].effect, 'hopes, warily');
    assert.equal(stored[0].sourceMessageId, 9);
});

test('cast pass: places are never admitted as new people', () => {
    const out = castDecisionsToScan({ people: [
        { ref: 'Charms corridor', is: 'new', name: 'Charms corridor', present: false },
        { ref: 'Priya Nair', is: 'new', name: 'Priya Nair', present: true },
    ] }, { transcript: 'Priya Nair will show you the shortcut to the Charms corridor.' });
    assert.deepEqual(out.npcs.map(row => row.name), ['Priya Nair']);
    assert.ok(out.report.rejected.some(item => item.reason === 'a place, not a person'));
});
