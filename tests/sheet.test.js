import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInjection, createNpcRecord, mergeScanResult, normalizeNpcRecord } from '../core.js';
import { castDecisionsToScan, castSignals, mergeCastIntoScan } from '../cast.js';
import {
    applySheetDelta,
    emptySheet,
    groundSheetDelta,
    normalizeSheet,
    renderSheetInjection,
    sheetFromEditor,
    sheetIsEmpty,
    sheetToEditor,
} from '../sheet.js';
import { statPaneHtml } from '../stat-sheet-ui.js';

const T1 = 'The courier pressed a brass compass into her hand. She threads its chain through her belt, flicks Ember Lash, a fire cantrip, and draws her notched longsword.';
const T2 = 'The compass was stolen at Hollowmere. A crossbow bolt grazed her shoulder.';

test('items are gained, equipped and really lost; ungrounded proposals are rejected', () => {
    let grounded = groundSheetDelta({
        items: [{ op: 'gained', item: 'scratched brass compass', significance: 'points where you last slept' }, { op: 'drew', item: 'notched longsword', slot: 'back' }, { op: 'gained', item: 'golden crown' }],
        spells: [{ name: 'Ember Lash', school: 'fire', tier: 'cantrip' }],
        rank: 'Iron rank',
    }, T1);
    assert.deepEqual(grounded.rejected, ['item gained: golden crown', 'rank: Iron rank']);
    let sheet = applySheetDelta(emptySheet(), grounded.delta, { turn: 3, sourceMessageId: 4 });
    assert.equal(sheet.keyItems[0].item, 'scratched brass compass');
    assert.equal(sheet.keyItems[0].sourceMessageId, 4);
    assert.deepEqual(sheet.equipped.map(item => [item.slot, item.item]), [['back', 'notched longsword']]);
    assert.equal(sheet.spells[0].name, 'Ember Lash');

    grounded = groundSheetDelta({ items: [{ op: 'stolen', item: 'the compass' }], conditions: [{ name: 'grazed shoulder', kind: 'injury', severity: 'minor' }] }, T2);
    sheet = applySheetDelta(sheet, grounded.delta, { turn: 9, sourceMessageId: 20 });
    assert.deepEqual(sheet.keyItems, [], 'a stolen item leaves the sheet');
    assert.equal(sheet.conditions[0].kind, 'injury');
    assert.deepEqual(sheet.itemLog.map(item => item.op), ['gained', 'equipped', 'lost']);
});

test('conditions clear, equipping a slot replaces what was there, pools merge numbers', () => {
    let sheet = applySheetDelta(emptySheet(), { conditions: [{ name: 'bruised ribs', kind: 'injury' }], items: [{ op: 'equipped', item: 'iron helm', slot: 'head' }], pools: [{ name: 'HP', current: 12, max: 20 }] });
    sheet = applySheetDelta(sheet, { conditions: [{ op: 'clear', name: 'bruised ribs' }], items: [{ op: 'equipped', item: 'kettle helm', slot: 'head' }], pools: [{ name: 'HP', current: 7 }] });
    assert.deepEqual(sheet.conditions, []);
    assert.deepEqual(sheet.equipped.map(item => item.item), ['kettle helm']);
    assert.deepEqual(sheet.pools, [{ name: 'HP', current: 7, max: 20 }]);
});

test('editor round-trip keeps provenance and parses every section', () => {
    const sheet = applySheetDelta(emptySheet(), { archetype: 'tracker', items: [{ op: 'gained', item: 'brass compass', significance: 'from the courier' }], conditions: [{ name: 'grazed shoulder', kind: 'injury', until: 'three days' }] }, { turn: 3, sourceMessageId: 4 });
    const fields = sheetToEditor(sheet);
    assert.equal(fields.keyItems, 'brass compass — from the courier');
    const edited = sheetFromEditor({ ...fields, equipped: 'back: notched longsword', attributes: 'STR: 14\nDEX: 17', pools: 'HP: 9/12', skills: 'Tracking: expert', spells: 'Ember Lash (fire, cantrip)', rank: 'Iron' }, sheet);
    assert.equal(edited.keyItems[0].sourceMessageId, 4, 'unchanged entries keep their source');
    assert.equal(edited.conditions[0].until, 'three days');
    assert.deepEqual(edited.attributes, [{ name: 'STR', value: '14' }, { name: 'DEX', value: '17' }]);
    assert.deepEqual(edited.pools, [{ name: 'HP', current: 9, max: 12 }]);
    assert.equal(edited.skills[0].proficiency, 'expert');
    assert.equal(edited.spells[0].tier, 'cantrip');
    assert.equal(edited.rank, 'Iron');
});

test('the cast pass carries grounded sheet deltas into the merge and the injection', () => {
    assert.ok(castSignals(T1).sheet);
    const sera = { ...createNpcRecord('Sera Vantrell'), present: true, personality: 'Dry.' };
    const cast = castDecisionsToScan({ people: [{ ref: 'her', is: sera.id, present: true, sheet: { items: [{ op: 'gained', item: 'brass compass' }, { op: 'gained', item: 'dragon egg' }] } }] }, { transcript: `Sera smiled at her. ${T1}`, npcs: [sera] });
    assert.ok(cast.report.rejected.some(item => /dragon egg/.test(item.reason)));
    const merged = mergeScanResult({ npcs: [sera], candidates: [], dismissed: [], turn: 3 }, mergeCastIntoScan({ npcs: [] }, cast), { turn: 3, sourceMessageId: 4 });
    const s = merged.state.npcs[0];
    assert.equal(s.sheet.keyItems[0].item, 'brass compass');
    assert.match(buildInjection(merged.state.npcs, 'Sera waits.', 3, 3), /STAT SHEET \(established\): carries: brass compass/);
});

test('a locked sheet ignores scanner deltas; records normalize and survive an empty sheet', () => {
    const npc = { ...createNpcRecord('Pell'), sheet: applySheetDelta(emptySheet(), { items: [{ op: 'gained', item: 'puzzle lock' }] }), manualProfileFields: ['sheet'] };
    const merged = mergeScanResult({ npcs: [npc], candidates: [], dismissed: [], turn: 2 }, { npcs: [{ id: npc.id, name: 'Pell', sheetDelta: { items: [{ op: 'lost', item: 'puzzle lock' }] } }] }, { turn: 2 });
    assert.equal(merged.state.npcs[0].sheet.keyItems[0].item, 'puzzle lock');
    assert.ok(sheetIsEmpty(normalizeNpcRecord(createNpcRecord('Brunna')).sheet));
    assert.deepEqual(normalizeSheet({ keyItems: [{ item: '' }], pools: [{ name: 'MP' }] }), emptySheet());
    assert.equal(renderSheetInjection(emptySheet()), '');
});

test('Stat tab renders every section, escapes text, and explains an empty sheet', () => {
    const sheet = applySheetDelta(emptySheet(), { archetype: 'tracker', rank: 'Iron', items: [{ op: 'gained', item: '<b>compass</b>' }, { op: 'equipped', item: 'longsword', slot: 'back' }], pools: [{ name: 'HP', current: 6, max: 12 }], conditions: [{ name: 'grazed shoulder', kind: 'injury' }] });
    const html = statPaneHtml({ name: 'Sera', sheet });
    assert.match(html, /STAT SHEET/);
    assert.match(html, /tracker · Iron/);
    assert.match(html, /&lt;b&gt;compass&lt;\/b&gt;/);
    assert.match(html, /style="width:50%"/);
    assert.match(html, /data-kind="injury"/);
    assert.match(statPaneHtml({ name: 'Pell', sheet: emptySheet() }), /Nothing established yet/);
    assert.match(statPaneHtml(null), /Select an NPC/);
});

test('removal matches only when one name contains the other; filler values are dropped', () => {
    let sheet = applySheetDelta(emptySheet(), { items: [{ op: 'gained', item: 'iron hammer badge' }, { op: 'gained', item: 'scratched brass compass' }] });
    sheet = applySheetDelta(sheet, { items: [{ op: 'gained', item: 'bronze badge' }, { op: 'lost', item: 'iron hammer badge' }, { op: 'lost', item: 'the compass' }], conditions: [{ name: 'wolf bite', kind: 'injury', until: 'not stated', severity: 'unknown' }] });
    assert.deepEqual(sheet.keyItems.map(item => item.item), ['bronze badge']);
    assert.deepEqual(sheet.conditions, [{ name: 'wolf bite', kind: 'injury' }]);
});

test('paraphrased conditions are grounded by one content word; invented items still need most words', () => {
    const text = 'Her left forearm is wrapped in a stained bandage where a Hollowmere wolf caught her.';
    const grounded = groundSheetDelta({ conditions: [{ name: 'wolf bite wound', kind: 'injury' }, { name: 'dragon fever', kind: 'illness' }], items: [{ op: 'gained', item: 'wolf pelt cloak' }] }, text);
    assert.deepEqual(grounded.delta.conditions.map(item => item.name), ['wolf bite wound']);
    assert.deepEqual(grounded.delta.items, []);
});

test('re-applying the same message does not duplicate item events', () => {
    const delta = { items: [{ op: 'gained', item: 'bronze badge' }, { op: 'lost', item: 'compass' }] };
    let sheet = applySheetDelta(emptySheet(), delta, { turn: 17, sourceMessageId: 34 });
    sheet = applySheetDelta(sheet, delta, { turn: 17, sourceMessageId: 34 });
    assert.equal(sheet.itemLog.length, 2);
    assert.equal(sheet.keyItems.length, 1);
});
