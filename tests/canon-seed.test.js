import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord, mergeScanResult, normalizeNpcRecord } from '../core.js';
import { cardCanonEntries } from '../cast.js';
import {
    applyCanonSeed,
    canonSeedTargets,
    canonTextFor,
    enforceCanonLocks,
    parseCanonSeed,
} from '../canon-seed.js';

const DUMBLEDORE = 'Albus Dumbledore is the Headmaster of Hogwarts School of Witchcraft and Wizardry: an elderly wizard, tall and thin, with a long silver beard, half-moon spectacles and a crooked nose. Calm, kind, playful, secretive.';
const ENTRIES = [
    { world: 'HP', uid: 1, comment: 'Albus Dumbledore', key: ['Dumbledore'], content: DUMBLEDORE },
    { world: 'HP', uid: 2, comment: 'Argus Filch', key: ['Filch'], content: 'Argus Filch is the caretaker of Hogwarts, a bitter Squib.' },
];

test('canon text: lorebook entry by uid (checked against the name), card canon gathers every sentence naming the person', () => {
    assert.equal(canonTextFor({ world: 'HP', uid: 1, name: 'Albus Dumbledore' }, { entries: ENTRIES }), DUMBLEDORE);
    assert.match(canonTextFor({ world: 'HP', uid: 1, name: 'Argus Filch' }, { entries: ENTRIES }), /caretaker/, 'a stale uid falls back to the name');
    const card = cardCanonEntries('Miriam Harcourt is the headmistress, with Idris Quill as deputy. The war is history. Miriam Harcourt was a curse-breaker for twenty years before teaching.');
    const text = canonTextFor({ world: 'card', uid: 0, name: 'Miriam Harcourt' }, { cardEntries: card });
    assert.match(text, /headmistress/);
    assert.match(text, /curse-breaker/);
    assert.doesNotMatch(text, /war is history/);
});

test('only grounded fields are kept; species must be fully stated; invented age and speech are dropped', () => {
    const { fields, rejected } = parseCanonSeed({
        species: 'human wizard', gender: 'male', age: '115', speech: 'speaks in riddles',
        overallAppearance: 'Tall and thin elderly wizard; long silver beard, half-moon spectacles, crooked nose.',
        personality: 'Calm, kind, playful, secretive', background: 'Headmaster of Hogwarts School of Witchcraft and Wizardry',
    }, DUMBLEDORE);
    assert.deepEqual(Object.keys(fields).sort(), ['background', 'gender', 'overallAppearance', 'personality']);
    assert.deepEqual(rejected.sort(), ['age', 'species', 'speech']);
});

test('a new dossier takes canon as its base; an older one only fills empty fields; manual fields are untouched', () => {
    const fields = { overallAppearance: 'Tall, thin, long silver beard.', background: 'Headmaster of Hogwarts.', personality: 'Calm, kind.' };
    const fresh = applyCanonSeed({ ...createNpcRecord('Albus Dumbledore'), background: 'Old man at the high table.' }, fields, { canonRef: { world: 'HP', uid: 1, name: 'Albus Dumbledore' }, turn: 3, isNew: true });
    assert.equal(fresh.npc.background, 'Headmaster of Hogwarts.');
    assert.equal(fresh.npc.appearance, 'Tall, thin, long silver beard.', 'outfit borrows canon look only while empty');
    assert.deepEqual(fresh.npc.canonLocked.sort(), ['background', 'overallAppearance', 'personality']);
    assert.deepEqual(fresh.npc.canonSeed, { entry: 'Albus Dumbledore', world: 'HP', fields: ['overallAppearance', 'personality', 'background'], turn: 3 });

    const old = applyCanonSeed({ ...createNpcRecord('Albus Dumbledore'), background: 'Story history.', personality: 'Grieving.', manualProfileFields: ['personality'] }, fields, { isNew: false });
    assert.equal(old.npc.background, 'Story history.');
    assert.equal(old.npc.personality, 'Grieving.');
    assert.deepEqual(old.seeded, ['overallAppearance']);
});

test('seed targets: first canon link only, by id or name, de-duplicated', () => {
    const seeded = { ...createNpcRecord('Argus Filch'), canonSeed: { fields: [] } };
    const targets = canonSeedTargets([
        { name: 'Albus Dumbledore', canonRef: { world: 'HP', uid: 1 } },
        { name: 'Albus Dumbledore', canonRef: { world: 'HP', uid: 1 } },
        { id: seeded.id, name: 'Argus Filch', canonRef: { world: 'HP', uid: 2 } },
        { name: 'Priya Nair' },
    ], [seeded]);
    assert.deepEqual(targets.map(item => item.name), ['Albus Dumbledore']);
});

test('S7.2 lock: ordinary scans may add but not overwrite; an explicit event may change; records keep the lock', () => {
    const base = normalizeNpcRecord({ ...createNpcRecord('Albus Dumbledore'), background: 'Headmaster of Hogwarts.', personality: 'Calm, kind.', canonLocked: ['background', 'personality'], canonSeed: { entry: 'Albus Dumbledore', fields: ['background', 'personality'] } });
    assert.deepEqual(base.canonLocked, ['background', 'personality']);
    const overwrite = { ...base, background: 'A retired grocer.', personality: 'Calm, kind. Lately grieving.' };
    const guarded = enforceCanonLocks([base], [overwrite], { npcs: [{ id: base.id }] });
    assert.equal(guarded.npcs[0].background, 'Headmaster of Hogwarts.');
    assert.equal(guarded.npcs[0].personality, 'Calm, kind. Lately grieving.');
    assert.deepEqual(guarded.reverted, [{ npcId: base.id, field: 'background' }]);
    const explicit = enforceCanonLocks([base], [overwrite], { npcs: [{ id: base.id, developmentScale: 'explicit' }] });
    assert.equal(explicit.npcs[0].background, 'A retired grocer.');

    // Through the real merge: a scanner rewrite of a canon-locked background is reverted.
    const merged = mergeScanResult({ npcs: [base], candidates: [], dismissed: [], turn: 4 }, { npcs: [{ id: base.id, name: 'Albus Dumbledore', present: true, background: 'A retired grocer from Leeds.', developmentScale: 'gradual' }] }, { turn: 4 });
    assert.equal(merged.state.npcs[0].background, 'Headmaster of Hogwarts.');
});

test('a seeded field that hands this person a gendered title of the other gender is dropped', () => {
    const quill = { ...createNpcRecord('Idris Quill'), gender: 'male' };
    const applied = applyCanonSeed(quill, { background: 'Deputy headmistress to Miriam Harcourt.', personality: 'Dry wit.' }, { isNew: true });
    assert.deepEqual(applied.dropped, ['background']);
    assert.deepEqual(applied.seeded, ['personality']);
    assert.equal(applied.npc.background, '');
    // Kin words are not titles: a man's background may name his daughter.
    const father = applyCanonSeed({ ...createNpcRecord('Tom'), gender: 'male' }, { background: 'Widowed blacksmith; raises his daughter alone.' }, { isNew: true });
    assert.deepEqual(father.seeded, ['background']);
});

test('S8.5: the cast call carries the seed for a canon-resolved person; the shortlist marks seeded dossiers', async () => {
    const { castDecisionsToScan, buildCastPassPrompt, buildCastShortlist } = await import('../cast.js');
    const canon = [{ id: 'canon:HP#1', world: 'HP', uid: 1, name: 'Albus Dumbledore', keys: ['Dumbledore'], snippet: DUMBLEDORE }];
    const out = castDecisionsToScan({ people: [{ ref: 'the headmaster', is: 'canon:HP#1', name: 'Albus Dumbledore', present: true,
        seed: { gender: 'male', overallAppearance: 'tall and thin, long silver beard, half-moon spectacles', species: 'human wizard' } }] },
        { transcript: 'At the high table the headmaster rises.', canon });
    const row = out.npcs[0];
    assert.equal(row.canonSeedRaw.gender, 'male');
    const { fields, rejected } = parseCanonSeed(row.canonSeedRaw, DUMBLEDORE);
    assert.deepEqual(Object.keys(fields).sort(), ['gender', 'overallAppearance']);
    assert.deepEqual(rejected, ['species']);
    assert.match(buildCastPassPrompt({ transcript: 'x' }), /TASK F \(in a person object resolved to canon, unless the candidate is "seeded"\)/);
    const seeded = { ...createNpcRecord('Albus Dumbledore'), canonSeed: { fields: ['background'] } };
    assert.equal(buildCastShortlist({ npcs: [seeded], transcript: 'Albus Dumbledore smiles.' })[0].seeded, true);
});

test('S3.3: canon gender needs gendered words in the canon text (live: Idris Quill got "male" from a sentence that never says it)', () => {
    const quill = parseCanonSeed({ gender: 'male', background: 'Deputy to Miriam Harcourt' }, 'Miriam Harcourt is the headmistress, with Idris Quill as deputy.');
    assert.equal(quill.fields.gender, undefined);
    assert.ok(quill.rejected.includes('gender'));
    assert.equal(parseCanonSeed({ gender: 'female' }, 'Minerva McGonagall is a stern witch; she teaches Transfiguration.').fields.gender, 'female');
    assert.equal(parseCanonSeed({ gender: 'male' }, 'He married her in the spring.').fields.gender, undefined, 'conflicting cues drop it');
});
