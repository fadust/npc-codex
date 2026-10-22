import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeScanResult } from '../core.js';

// (1.2.19) An NPC already in the dossier gains new memories: they are added to the stored ones,
// deduplicated and capped, whichever part of the capture (npcs[] or profileUpdates) carries them.
const M1 = "Stamped Astra's first rat-cull bounty slip and logged sixty-four tails";
const M2 = "Warned Astra that Brecht's dock boys target anyone carrying board silver";
const M3 = 'Asked Astra to clear the swamp drake so the council keeps the hall open';

const merge = (state, scan, turn) => mergeScanResult(state, scan, { turn, sourceMessageId: turn }).state;
const elke = state => state.npcs.find(npc => npc.name === 'Elke');
const withElke = () => merge({ npcs: [] }, { npcs: [{ name: 'Elke', role: 'Guild intake clerk', present: true, memories: [M1] }] }, 1);

test('v1.2.19 a new memory in an existing NPC\'s npcs[] entry is added to the stored ones', () => {
    let state = withElke();
    assert.deepEqual(elke(state).memories, [M1]);
    state = merge(state, { npcs: [{ id: elke(state).id, name: 'Elke', present: true, memories: [M2] }] }, 2);
    assert.deepEqual(elke(state).memories, [M1, M2]);
});

test('v1.2.19 a new memory filed under profileUpdates for an existing NPC is added, never dropped or replacing', () => {
    let state = withElke();
    state = merge(state, { npcs: [], profileUpdates: [{ id: elke(state).id, evidence: { personality: ['Relieved'] }, memories: [M2] }] }, 2);
    assert.deepEqual(elke(state).memories, [M1, M2]);
    // Memories alone in a profile update count too.
    state = merge(state, { npcs: [], profileUpdates: [{ id: elke(state).id, memories: [M3] }] }, 3);
    assert.deepEqual(elke(state).memories, [M1, M2, M3]);
});

test('v1.2.19 a resent or paraphrased stored memory is not duplicated, by either route', () => {
    let state = withElke();
    const id = elke(state).id;
    state = merge(state, { npcs: [{ id, name: 'Elke', memories: [M1, M2] }] }, 2);
    state = merge(state, { npcs: [], profileUpdates: [{ id, memories: [M2, `${M1}.`] }] }, 3);
    state = merge(state, { npcs: [{ id, name: 'Elke', memories: ["Elke stamped Astra's first rat-cull bounty slip, logging sixty-four tails"] }] }, 4);
    // The paraphrase may stand in for its stored twin (the fuller wording wins), never beside it.
    const stored = elke(state).memories;
    assert.equal(stored.length, 2);
    assert.equal(stored[1], M2);
    assert.match(stored[0], /rat-cull bounty slip/);
});

test('v1.2.19 memories added over many replies stay capped at five without wiping the earlier ones wholesale', () => {
    let state = withElke();
    const id = elke(state).id;
    const more = [
        'Elke forged a waiver so Astra could enter the sealed archive',
        'The guild council suspended Elke for a week over the missing ledger',
        'Elke revealed she once served as a scout in the northern pass war',
        'Elke burned the Brecht contract in front of the whole hall',
        'Elke named Astra her successor at the intake desk',
    ];
    more.forEach((memory, index) => { state = merge(state, index % 2 ? { npcs: [], profileUpdates: [{ id, memories: [memory] }] } : { npcs: [{ id, name: 'Elke', memories: [memory] }] }, index + 2); });
    const stored = elke(state).memories;
    assert.equal(stored.length, 5);
    assert.ok(stored.includes(more.at(-1)), 'the newest memory is kept');
    assert.equal(new Set(stored).size, stored.length);
});

