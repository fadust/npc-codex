import test from 'node:test';
import assert from 'node:assert/strict';
import { storyProse, tagScanEvidence, mergeScanResult } from '../core.js';
import { stripFlorisLog } from '../floris.js';

test('relationship prose excludes preset planning and structured rosters', () => {
    const text = '<log>Ari Senn may arrive.</log>Kai thanks Ari Vale.<World_State>NPCs Present: Ari Senn</World_State>';
    assert.equal(storyProse(stripFlorisLog(text)), 'Kai thanks Ari Vale.');
});
test('single-reply evidence gets its source once without mutating scanner output', () => {
    const input = { profileUpdates: [{ id: 'ari', evidence: { mannerisms: ['Taps her ring', '[m2] Watches the door'] } }] };
    const tagged = tagScanEvidence(input, 4);
    assert.deepEqual(tagged.profileUpdates[0].evidence.mannerisms, ['[m4] Taps her ring', '[m2] Watches the door']);
    assert.equal(input.profileUpdates[0].evidence.mannerisms[0], 'Taps her ring');
    assert.deepEqual(tagScanEvidence(tagged, 4), tagged);
});
test('both memory input routes preserve manual memory locks', () => {
    let state = mergeScanResult({ npcs: [] }, { npcs: [{ name: 'Ari Vale', present: true, memories: ['Saved Kai from drowning'] }] }).state;
    const npc = state.npcs[0];
    npc.manualProfileFields = ['memories'];
    state = mergeScanResult(state, { npcs: [{ id: npc.id, name: npc.name, memories: ['Opened the sealed vault'] }], profileUpdates: [{ id: npc.id, memories: ['Recovered the lost crown'] }] }).state;
    assert.deepEqual(state.npcs[0].memories, ['Saved Kai from drowning']);
});
