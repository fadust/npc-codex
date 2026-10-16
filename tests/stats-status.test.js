import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord, buildInjection } from '../core.js';
import { applySheetDelta, emptySheet, renderSheetInjection } from '../sheet.js';
import { abilityFlavour, clashComparison, deriveSheet, parseProfessionProfile, parseRaceProfile, rankTier, HUMAN_BASELINE } from '../derive.js';
import { parseDuration, renderStatusInjection, scheduleStatuses, tickStatuses, sappingStatus } from '../status.js';

const value = (sheet, name) => Number(sheet.attributes.find(item => item.name === name).value);

test('an untrained human is 30 across; a race is bounded against that human', () => {
    const human = deriveSheet({});
    assert.ok(human.attributes.every(item => Number(item.value) === HUMAN_BASELINE));
    assert.equal(human.derivation.race, 'human');
    const orc = parseRaceProfile({ attributes: { Strength: 48, Endurance: 45, Agility: 30, Intelligence: 22, Wisdom: 24, Charisma: 16, Luck: 30 }, hp: 1.4, stamina: 1.3, magic: 'weak' });
    const sheet = deriveSheet({ race: orc, raceName: 'orc' });
    assert.ok(value(sheet, 'Strength') > value(human, 'Strength'));
    assert.ok(value(sheet, 'Charisma') < value(human, 'Charisma'));
    assert.ok(sheet.pools.find(pool => pool.name === 'HP').max > human.pools.find(pool => pool.name === 'HP').max);
    const absurd = parseRaceProfile({ attributes: { Strength: 100, Agility: 100, Endurance: 100, Intelligence: 100, Wisdom: 100, Charisma: 100, Luck: 100 } });
    assert.ok(Object.values(absurd.attributes).every(item => item <= 60), 'untrained race values stay under 60');
    assert.ok(Object.values(absurd.attributes).reduce((sum, item) => sum + item, 0) <= HUMAN_BASELINE * 7 * 1.35 + 7);
});

test('profession alters; rank adds a budget spread by emphasis; no-magic professions get no MP', () => {
    const smith = parseProfessionProfile({ modifiers: { Strength: 10, Endurance: 8, Agility: -2 }, focus: ['Strength', 'Endurance'] });
    const grukk = deriveSheet({ profession: smith, professionName: 'blacksmith' });
    assert.equal(value(grukk, 'Strength'), 40);
    const swords = parseProfessionProfile({ modifiers: { Strength: 6, Agility: 6 }, focus: ['Strength', 'Agility'] });
    const heavy = deriveSheet({ profession: swords, tier: 'B', emphasis: { dominant: ['Strength'] } });
    const quick = deriveSheet({ profession: swords, tier: 'B', emphasis: { dominant: ['Agility'] } });
    assert.ok(value(heavy, 'Strength') > value(quick, 'Strength') + 15);
    assert.ok(value(quick, 'Agility') > value(heavy, 'Agility') + 15);
    const total = sheet => sheet.attributes.reduce((sum, item) => sum + Number(item.value), 0);
    assert.ok(Math.abs(total(heavy) - total(quick)) <= 3, 'same rank, same budget');
    const barbarian = deriveSheet({ profession: parseProfessionProfile({ modifiers: { Strength: 12 }, magic: 'none' }, 'barbarian') });
    assert.equal(parseProfessionProfile({ magic: 'none' }, 'messenger').magic, 'keep', 'only work that rules magic out removes it (live: messenger)');
    assert.deepEqual(barbarian.restrictions, ['no magic']);
    assert.equal(barbarian.pools.some(pool => pool.name === 'MP'), false);
    assert.equal(rankTier('a B-class swordsman'), 'B');
    assert.equal(rankTier('Rank: S'), 'S');
    assert.equal(rankTier('Bronze', ['Iron', 'Bronze', 'Silver', 'Gold', 'Mithril', 'Adamant']), 'D');
});

test('flavour: words, not numbers; clash comparisons; a status saps it', () => {
    const heavy = { attributes: [{ name: 'Strength', value: '78' }, { name: 'Agility', value: '40' }], restrictions: ['no magic'] };
    const quick = { attributes: [{ name: 'Strength', value: '45' }, { name: 'Agility', value: '80' }] };
    assert.equal(abilityFlavour(heavy), 'heavy-handed; blows land with crushing, armour-shaking force; cannot use magic');
    assert.match(abilityFlavour(heavy, { sappedBy: 'spider venom' }), /^normally heavy-handed.*now weakened by spider venom/);
    assert.equal(clashComparison(heavy, [{ name: 'Kael', sheet: quick }]), 'Kael is quicker; hits harder than Kael');
    assert.doesNotMatch(renderSheetInjection({ ...heavy, keyItems: [{ item: 'axe' }] }), /\d/, 'the prompt never gets stat numbers');
});

test('ability lines appear only in action scenes, without numbers', () => {
    const brann = { ...createNpcRecord('Brann'), present: true, sheet: { attributes: [{ name: 'Strength', value: '78' }] } };
    const kael = { ...createNpcRecord('Kael', [brann.id]), present: true, sheet: { attributes: [{ name: 'Strength', value: '45' }, { name: 'Agility', value: '80' }] } };
    assert.doesNotMatch(buildInjection([brann, kael], 'Brann and Kael share a drink.', 5), /ABILITY/);
    const fight = buildInjection([brann, kael], 'Kael draws his sword and attacks Brann.', 5);
    assert.match(fight, /ABILITY \(flavour, not rules; never numbers, dice or set outcomes\): heavy-handed.*in a clash: hits harder than Kael/);
    assert.doesNotMatch(fight, /STAT SHEET \(established\): $/m, 'no empty sheet line');
    assert.doesNotMatch(fight.split('\n').filter(line => line.includes('ABILITY')).join(' '), /\b(78|45|80)\b/);
});

test('afflictions escalate past their window and never past dying; treatment steps down', () => {
    let sheet = applySheetDelta(emptySheet(), { conditions: [{ op: 'add', name: 'spider venom', kind: 'poison', severity: 'mild', until: 'until treated', effect: 'sweating, shaky hands', aware: false }] });
    let conditions = scheduleStatuses(sheet.conditions, { turn: 1, day: 1 });
    assert.deepEqual(conditions[0].deadline, { day: 2, turn: 7 });
    let ticked = tickStatuses(conditions, { turn: 3, day: 2 });
    assert.equal(ticked.conditions[0].severity, 'moderate');
    assert.deepEqual(ticked.events, [{ op: 'escalated', item: 'spider venom (moderate)' }]);
    for (let day = 3; day <= 6; day += 1) ticked = tickStatuses(ticked.conditions, { turn: day * 3, day });
    assert.equal(ticked.conditions[0].severity, 'dying');
    assert.equal(ticked.conditions.length, 1, 'code never kills');
    assert.match(renderStatusInjection(ticked.conditions, { turn: 20, day: 6 }), /CONDITION \(shapes behaviour now\): spider venom \(dying, untreated 5 days\): sweating, shaky hands; does not know the cause/);
    sheet = applySheetDelta({ ...sheet, conditions: ticked.conditions }, { conditions: [{ op: 'treat', name: 'spider venom' }] });
    assert.equal(sheet.conditions[0].severity, 'severe');
    assert.equal(sappingStatus(sheet.conditions), 'spider venom');
});

test('buffs fade for one turn, then expire; a re-mention keeps the clock', () => {
    let conditions = scheduleStatuses([{ name: 'Blessing of Dawn', kind: 'buff', until: 'until dawn', effect: 'fearless in the dark' }], { turn: 4, day: 3 });
    assert.deepEqual(parseDuration('for three hours'), { days: 0, turns: 2 });
    let step = tickStatuses(conditions, { turn: 5, day: 4 });
    assert.equal(step.conditions[0].fading, true);
    assert.match(renderStatusInjection(step.conditions), /Blessing of Dawn is wearing off/);
    step = tickStatuses(step.conditions, { turn: 6, day: 4 });
    assert.equal(step.conditions.length, 0);
    assert.deepEqual(step.events, [{ op: 'expired', item: 'Blessing of Dawn' }]);
    const kept = applySheetDelta({ conditions: scheduleStatuses([{ name: 'venom', kind: 'poison' }], { turn: 1 }) }, { conditions: [{ op: 'add', name: 'venom', kind: 'poison', effect: 'worse' }] });
    assert.equal(kept.conditions[0].onset.turn, 1);
});

test('simulation fixes: calm craft and retold fights are not action; treated afflictions recover; B stays under S', () => {
    const brann = { ...createNpcRecord('Brann'), present: true, sheet: { attributes: [{ name: 'Strength', value: '78' }] } };
    assert.doesNotMatch(buildInjection([brann], 'Grukk hammers a blade at the forge.', 1), /ABILITY/);
    assert.doesNotMatch(buildInjection([brann], 'Lyra tells Mira that Brann attacked Grukk at the forge.', 1), /ABILITY/);
    assert.match(buildInjection([brann], 'Bandits ambush the road; Brann draws his sword.', 1), /ABILITY/);
    let conditions = scheduleStatuses([{ name: 'venom', kind: 'poison', severity: 'dying' }], { turn: 1, day: 1 });
    let sheet = applySheetDelta({ conditions }, { conditions: [{ op: 'treat', name: 'venom' }] });
    assert.equal(sheet.conditions[0].treated, true);
    conditions = scheduleStatuses(sheet.conditions, { turn: 2, day: 1 });
    let step = tickStatuses(conditions, { turn: 9, day: 2 });
    assert.equal(step.conditions[0].severity, 'moderate', 'a treated affliction eases, never worsens');
    step = tickStatuses(step.conditions, { turn: 12, day: 3 });
    step = tickStatuses(step.conditions, { turn: 15, day: 4 });
    assert.equal(step.conditions.length, 0);
    assert.deepEqual(step.events, [{ op: 'recovered', item: 'venom' }]);
    const sword = parseProfessionProfile({ modifiers: { Agility: 6 }, focus: ['Agility'] });
    const b = value(deriveSheet({ profession: sword, tier: 'B', emphasis: { dominant: ['Agility'] } }), 'Agility');
    const s = value(deriveSheet({ profession: sword, tier: 'S', emphasis: { dominant: ['Agility'] } }), 'Agility');
    assert.ok(b < 90 && s > b, `B ${b}, S ${s}`);
});
