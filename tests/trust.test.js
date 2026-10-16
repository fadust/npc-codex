import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord, normalizeNpcRecord } from '../core.js';
import { setBirthdayFallback } from '../birthday.js';
import { capPoolChanges, presenceGuard, provenanceLines, provenanceOf } from '../trust.js';

test('S3.1 provenance: edited, canon (until the story changes it), generated, story', () => {
    const npc = {
        ...createNpcRecord('Argus Filch'),
        background: 'Caretaker of Hogwarts.',
        personality: 'bitter',
        speech: 'Wheezing mutter.',
        mood: 'sour',
        canonSeed: { entry: 'Argus Filch', world: 'HP', fields: ['background', 'personality'], turn: 2 },
        fieldChanges: { background: 2, personality: 5, speech: 4 },
        manualProfileFields: ['speech'],
        birthDate: '03-01',
        birthDateSource: 'generated',
    };
    assert.deepEqual(provenanceOf(npc, 'background'), { origin: 'canon', detail: 'lorebook: Argus Filch' });
    assert.deepEqual(provenanceOf(npc, 'personality'), { origin: 'story', detail: 'turn 5' }, 'the story changed it after the seed');
    assert.deepEqual(provenanceOf(npc, 'speech'), { origin: 'edited', detail: 'set by you' });
    assert.deepEqual(provenanceOf(npc, 'birthDate'), { origin: 'generated', detail: 'local fallback' });
    assert.equal(provenanceOf(npc, 'species'), null, 'empty fields have no source');
    assert.ok(provenanceLines(npc).includes('background: canon (lorebook: Argus Filch)'));
});

test('S3.3: with the fallback off, unknown birthdays stay empty and generated ones are cleared', () => {
    try {
        setBirthdayFallback(false);
        const fresh = normalizeNpcRecord(createNpcRecord('Priya Nair'));
        assert.equal(fresh.birthDate, '');
        const old = normalizeNpcRecord({ ...createNpcRecord('Old'), birthDate: '03-01', birthDateSource: 'generated' });
        assert.equal(old.birthDate, '');
        const stated = normalizeNpcRecord({ ...createNpcRecord('Stated'), birthDate: '07-31', birthDateSource: 'established' });
        assert.equal(stated.birthDate?.month, '07', 'a story-established birthday is kept');
        assert.equal(stated.birthDateSource, 'established');
    } finally {
        setBirthdayFallback(true);
    }
    assert.notEqual(normalizeNpcRecord(createNpcRecord('Priya Nair')).birthDate, '', 'module default unchanged');
});

test('S3.4: a newly present NPC must be named in the reply itself', () => {
    const sera = { ...createNpcRecord('Sera Duhn'), present: false };
    const brann = { ...createNpcRecord('Brann'), present: true };
    const headmistress = { ...createNpcRecord('Miriam Harcourt'), present: false, roles: [{ title: 'Headmistress', org: 'Hogwarts' }] };
    const after = [{ ...sera, present: true }, brann, { ...headmistress, present: true }];
    const out = presenceGuard([sera, brann, headmistress], after, 'The headmistress rises. Brann grunts and pours the ale.');
    assert.deepEqual(out.reverted, [sera.id], 'the player wishing Sera back does not bring her back');
    assert.equal(out.npcs[0].present, false);
    assert.equal(out.npcs[2].present, true, 'a current title counts as naming');
    assert.equal(presenceGuard([sera], [{ ...sera, present: true }], 'Sera Duhn steps in.').reverted.length, 0);
});

test('S3.6: an unstated pool figure moves at most half its maximum per scan', () => {
    const sheet = { pools: [{ name: 'HP', current: 40, max: 40 }] };
    const out = capPoolChanges({ pools: [{ name: 'HP', current: 2, max: 40 }] }, sheet, 'The wolf mauls her badly.');
    assert.deepEqual(out.delta.pools[0], { name: 'HP', current: 20, max: 40 });
    assert.equal(out.capped.length, 1);
    const stated = capPoolChanges({ pools: [{ name: 'HP', current: 2, max: 40 }] }, sheet, 'She is down to 2 HP.');
    assert.equal(stated.delta.pools[0].current, 2, 'a figure the story states is kept');
    assert.equal(capPoolChanges({ pools: [{ name: 'HP', current: 30, max: 40 }] }, sheet, 'A scratch.').capped.length, 0);
});
