import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord, normalizeNpcRecord, buildInjection } from '../core.js';
import { buildCastShortlist } from '../cast.js';
import { presenceGuard } from '../trust.js';
import { applyFlorisReadout, parseFlorisReadout, renderFlorisReadout, stripFlorisLog } from '../floris.js';

// Real readout lines from the trial chats, plus a Bond line in the preset's exact format.
const REPLY = `Betty slams the door behind her.

<log>
[Bond: Kai ↔ Betty | Stage: Wary Allies | Affection: 55% | Fear: 10% | Trust: 40% | Yearning: 30% · Shift: +5 trust, he kept his word]
[Feel: Betty | T2 F1 D3 Y4 · terror of rejection masked by aggression]
[Feel: Robert — T1 F0 D2 Y3 · need to maintain control of the scene]
[Feel: Ghost | T2 F2 D2 Y2]
</log>`;

test('parses Bond and Feel readouts in both separator styles', () => {
    const { bonds, feels } = parseFlorisReadout(REPLY, { userName: 'Kai' });
    assert.deepEqual(bonds, [{ name: 'Betty', stage: 'Wary Allies', values: { affection: 55, fear: 10, trust: 40, yearning: 30 }, shift: '+5 trust, he kept his word' }]);
    assert.deepEqual(feels[0], { name: 'Betty', levels: { tenderness: 2, fury: 1, dread: 3, yearning: 4 }, hidden: 'terror of rejection masked by aggression' });
    assert.equal(feels[1].name, 'Robert');
    assert.equal(feels[1].levels.fury, 0);
    assert.equal(parseFlorisReadout('[Bond: Kai ↔ Character | Stage: Stage Name | Affection: N%]', { userName: 'Kai' }).bonds.length, 0, 'the unfilled template is ignored');
});

test('readouts attach to the right dossier as a hint; NPC Codex numbers stay untouched', () => {
    const betty = normalizeNpcRecord({ ...createNpcRecord('Betty Moore'), relationship: { trust: 5, affection: 0, desire: 0, tension: 0 } });
    const robert = createNpcRecord('Robert', [betty.id]);
    const out = applyFlorisReadout([betty, robert], parseFlorisReadout(REPLY, { userName: 'Kai' }), { turn: 7, sourceMessageId: 14 });
    assert.equal(out.applied, 3, 'Ghost has no dossier');
    const read = out.npcs[0];
    assert.equal(read.floris.bond.values.trust, 40);
    assert.equal(read.relationship.trust, 5, 'the readout never overwrites NPC Codex relationship numbers');
    assert.equal(renderFlorisReadout(read), 'Floris readout (a hint, not fact): stage Wary Allies; affection 55%, fear 10%, trust 40%, yearning 30%; fury low, dread high, yearning very high; hides (do not reveal directly): terror of rejection masked by aggression');
    assert.match(buildInjection([{ ...normalizeNpcRecord(read), present: true }], 'Betty', 8), /Floris readout \(a hint, not fact\)/);
    assert.match(buildCastShortlist({ npcs: [read], transcript: 'Betty Moore frowns.' })[0].floris, /stage Wary Allies/);
});

test('the <log> block is not story evidence', () => {
    assert.equal(stripFlorisLog(REPLY), 'Betty slams the door behind her.');
    const robert = { ...createNpcRecord('Robert'), present: false };
    const guarded = presenceGuard([robert], [{ ...robert, present: true }], stripFlorisLog(REPLY));
    assert.deepEqual(guarded.reverted, [robert.id], 'named only in the readout, so not brought into the scene');
});
