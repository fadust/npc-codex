import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNpcRecord, mergeScanResult, buildInjection } from '../core.js';
import { resolveSagaAdmissions } from '../saga-canon.js';
import { captureCanonRevision, canonRevisionCurrent } from '../saga-canon.js';
import { buildCastShortlist, mergeCastIntoScan, resolveKnowledgeKeys, castDecisionsToScan } from '../cast.js';
import { canonSeedTargets } from '../canon-seed.js';
import { actorProfiles, resolveActor, readStoryContinuity } from '../actor-stack.js';
import { acceptPortrayal, renderPortrayal, PORTRAYAL_REFERENCES } from '../actor-portrayal.js';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/layer1-ari.json', import.meta.url)));
const ari = () => ({ ...createNpcRecord(fixture.card.name), id: 'ari', personality: 'deliberate', speech: 'speaks softly', present: true });
test('Ari live regression: a shared alias never transfers Senn death to Vale', async () => {
    const vale = { ...ari(), id: 'npc_ari-vale', aliases: ['Ari'], canonRef: { world: 'Saga:vale@r1', uid: 0, name: 'Ari Vale' } };
    const senn = { name: 'Ari Senn', aliases: ['Ari'], present: true, identityKind: 'proper_name', dossierSignal: 'persistent', canonRef: { world: 'Saga:senn@r1', uid: 0, name: 'Ari Senn' } };
    const folded = mergeCastIntoScan({ npcs: [{ id: vale.id, name: vale.name, aliases: ['Ari'] }] }, { npcs: [{ ...senn, matchLabels: ['Ari'] }] });
    assert.equal(folded.npcs.length, 2);
    const state = mergeScanResult({ npcs: [vale] }, { npcs: [senn] }, { turn: 1 }).state;
    assert.equal(state.npcs.length, 2);
    const dead = { ...senn, id: state.npcs.find(n => n.name === senn.name).id, lifeState: 'deceased', lifeStateCertainty: 'explicit', lifeStateReason: 'Ari Senn died under the arch.' };
    const next = mergeScanResult(state, { npcs: [dead] }, { turn: 2, developmentContext: dead.lifeStateReason }).state;
    assert.notEqual(next.npcs.find(n => n.name === vale.name).lifeState, 'deceased');
    assert.equal(next.npcs.find(n => n.name === senn.name).lifeState, 'deceased');
    const wrongId = { ...dead, id: vale.id };
    assert.equal((await resolveSagaAdmissions({ npcs: [wrongId] }, [vale], { bridge: {} })).npcs.length, 0);
    assert.notEqual(mergeScanResult({ npcs: [vale] }, { npcs: [wrongId] }).state.npcs[0].lifeState, 'deceased');
    assert.equal(resolveKnowledgeKeys(new Map([['name:ari', [{ fact: 'private phrase' }]]]), state.npcs).size, 0);
    assert.equal(resolveKnowledgeKeys(new Map([['name:ari vale', [{ fact: 'private phrase' }]]]), state.npcs).size, 1);
});
test('Ari: custom facts require this actor, this field and this whole value', () => {
    const base = { npcs: [{ ...ari(), customFields: { Level: '3' } }], candidates: [], turn: 1 };
    const scan = context => mergeScanResult(base, { npcs: [{ id: 'ari', name: fixture.card.name, customFields: { Level: '5' }, customFieldsReason: 'reached level 5' }] }, { turn: 2, customFieldNames: ['Level'], developmentContext: context }).state.npcs[0];
    for (const context of ['Cato Vale reaches level 5. Ari Vale watches.', 'Ari Vale pays 50 coins.', '', 'Ari Vale is not level 5.']) assert.equal(scan(context).customFields.Level, '3');
    assert.equal(scan('Ari Vale reached Level 5.').customFields.Level, '5');
});
test('Ari: pre-scan presence survives controller reset without merging an unrelated healer', () => {
    const npc = { ...ari(), aliases: ['Healer'], present: false };
    const scan = priorPresentIds => mergeScanResult({ npcs: [npc], candidates: [], turn: 1 }, { npcs: [{ name: 'Healer', identityKind: 'role_label', present: true }] }, { turn: 2, priorPresentIds, developmentContext: 'The healer speaks softly.' });
    assert.equal(scan(['ari']).state.npcs[0].present, true);
    assert.equal(scan([]).state.npcs[0].present, false);
});
test('Ari: source revision, disable and bridge replacement reject in-flight results', () => {
    const prior = globalThis.Saga;
    let revision = 'old';
    globalThis.Saga = { bridge: { canonStatus: () => ({ enabled: true }), canonRevision: () => revision } };
    try {
        const token = captureCanonRevision();
        assert.equal(canonRevisionCurrent(token), true);
        revision = 'new'; assert.equal(canonRevisionCurrent(token), false);
        globalThis.Saga = null; assert.equal(canonRevisionCurrent(token), false);
    } finally { globalThis.Saga = prior; }
});
test('Ari: changed canon revision requests gap filling; profiles expose no secrets', () => {
    const npc = { ...ari(), canonSeed: { world: 'Saga:ari@old', fields: ['age'] }, knowledge: [{ fact: 'Hidden vault', kind: 'secret' }] };
    const shortlist = buildCastShortlist({ npcs: [npc], transcript: 'Ari Vale enters.', canonEntries: [{ world: 'Saga:ari@new' }] });
    assert.equal(shortlist[0].seeded, undefined);
    assert.doesNotMatch(JSON.stringify(actorProfiles([npc], 4)), /Hidden vault/);
    assert.equal(resolveActor([npc, { ...ari(), id: 'other' }], fixture.card.name), null);
});

test('Ari: an age-only Saga seed does not suppress personality and speech gap filling', () => {
    const npc = { ...ari(), personality: '', speech: '', canonRef: { world: 'Saga:ari@r1', uid: 0 }, canonSeed: { world: 'Saga:ari@r1', fields: ['age'] } };
    assert.equal(buildCastShortlist({ npcs: [npc], transcript: 'Ari Vale enters.', canonEntries: [{ world: npc.canonRef.world }] })[0].seeded, undefined);
    assert.equal(canonSeedTargets([{ id: npc.id, name: npc.name, canonRef: npc.canonRef }], [npc]).length, 1);
});
test('Ari: approved portrayal shares the actor budget, cannot change facts, and invalidates on changes', () => {
    const npc = ari(); const original = structuredClone(npc);
    const guide = acceptPortrayal(npc, { reference: PORTRAYAL_REFERENCES.entries[0].uid, text: 'Speak softly; pause before answering.' });
    assert.deepEqual(npc, original);
    npc.portrayal = guide;
    assert.match(buildInjection([npc], 'Ari Vale speaks.', 1), /PORTRAYAL ONLY/);
    assert.equal(renderPortrayal({ ...npc, speech: 'accepted louder voice' }), '');
    assert.equal(renderPortrayal({ ...npc, portrayal: { ...guide, referenceRevision: 'changed' } }), '');
    assert.equal(renderPortrayal({ ...npc, lifeState: 'deceased', lifeStateCertainty: 'explicit' }), '');
    assert.ok(buildInjection([npc], 'Ari Vale speaks.', 1, 3, undefined, 512).length <= 512 * 4);
});
test('BaiBai snapshots remain continuity hints with revision and coverage, never canon', async () => {
    const snapshot = { apiVersion: 1, chat: { id: 'trial', length: 3 }, coverage: { complete: false }, revision: 7, npcs: [{ name: fixture.card.name }], state: { location: 'Tower' } };
    const result = await readStoryContinuity({ getSnapshot: () => snapshot }, 3);
    assert.equal(result.status, 'partial'); assert.equal(result.revision, 7);
    assert.equal((await readStoryContinuity({ getSnapshot: () => snapshot }, 4)).status, 'unavailable');
});
test('Ari: generic aliases do not bypass Saga identity checks', async () => {
    const npc = { ...ari(), aliases: ['Healer'], present: false, location: 'North tower' };
    const result = await resolveSagaAdmissions({ npcs: [{ name: 'Healer', location: 'South port' }] }, [npc], { bridge: { queryCanon: async () => ({ status: 'ambiguous' }) } });
    assert.deepEqual(result.npcs, []);
});
test('Ari: mentioned actors remain off-screen and confirmed deaths remain references', () => {
    const npc = { ...ari(), present: false };
    assert.match(buildInjection([npc], 'We remember Ari Vale.', 1), /MENTIONED, NOT PRESENT/);
    const dead = { ...npc, lifeState: 'deceased', lifeStateCertainty: 'explicit', archived: true, archiveReason: 'deceased', lifeStateReason: 'Died in the flood.' };
    assert.match(buildInjection([dead], 'We remember Ari Vale.', 1), /DECEASED, REFERENCED ONLY/);
});

test('Ari: canon family ties fill bonds without admitting the mentioned relative', () => {
    const npc = ari();
    const cast = castDecisionsToScan({ people: [{ ref: 'Mira Vale', is: 'canon:mira', name: 'Mira Vale', present: false, ties: [{ is: 'mother', of: npc.name }] }] }, {
        transcript: 'Ari Vale mentions his mother Mira Vale.', npcs: [npc], canon: [{ id: 'canon:mira', world: 'Saga:mira@r1', uid: 0, name: 'Mira Vale', keys: ['Mira Vale'], snippet: "Mira Vale is Ari Vale's mother." }],
    });
    assert.equal(cast.npcs.length, 0);
    const result = mergeScanResult({ npcs: [npc] }, cast, { turn: 1, developmentContext: 'Ari Vale mentions his mother Mira Vale.' });
    assert.equal(result.state.npcs.length, 1);
    assert.match(result.state.npcs[0].keyRelationships.join(' '), /Mira Vale.*mother/i);
});

test('portrayal removes redundant speech only, retains distinct guidance and respects negation', () => {
    const npc = { ...ari(), speech: 'Speaks softly with deliberate pauses.' };
    const approve = text => ({ ...npc, portrayal: acceptPortrayal(npc, { reference: PORTRAYAL_REFERENCES.entries[0].uid, text }) });
    assert.equal(renderPortrayal(approve('Speak softly.')), '');
    assert.match(renderPortrayal(approve('Use short sentences when explaining the remedy.')), /PORTRAYAL ONLY/);
    assert.match(renderPortrayal(approve('Pause before answering.')), /PORTRAYAL ONLY/, 'deliberate pauses do not establish timing');
    const negative = { ...npc, speech: "Don't speak softly; never pause before answering." };
    negative.portrayal = acceptPortrayal(negative, { reference: PORTRAYAL_REFERENCES.entries[0].uid, text: 'Speak softly; pause before answering.' });
    assert.match(renderPortrayal(negative), /PORTRAYAL ONLY/, 'a contradiction is not treated as redundant agreement');
});

test('compact default policy preserves custom relationship criteria and knowledge gates', () => {
    const npc = { ...ari(), knowledge: [{ fact: 'Vault location', kind: 'secret', state: 'unknown' }] };
    const standard = buildInjection([npc], 'Ari Vale speaks.', 1);
    assert.doesNotMatch(standard, /RELATIONSHIP-TO-BEHAVIOR RUBRIC:/);
    assert.match(standard, /KNOWLEDGE GATES ARE HARD LIMITS/);
    assert.match(buildInjection([npc], 'Ari Vale speaks.', 1, 3, 'Custom: preserve professional distance.'), /Custom: preserve professional distance/);
});

test('Ari presence shares the BunnyMo actor prompt without duplicate cues or forced reactions', () => {
    const npc = { ...ari(), species: 'Human', age: '20', appearance: 'Dark hair; brown travelling coat; Impression: quietly imposing; Bearing: stands upright', mannerisms: ['stands upright'], knowledge: [{ fact: 'Hidden vault', kind: 'secret' }] };
    npc.portrayal = acceptPortrayal(npc, { reference: PORTRAYAL_REFERENCES.entries[0].uid, text: 'Quietly imposing; pause before answering.' });
    const before = structuredClone(npc);
    const prompt = buildInjection([npc], 'Ari Vale enters.', 1, 3, undefined, 4000);
    for (const cue of ['dark hair', 'brown travelling coat', 'quietly imposing', 'stands upright']) assert.equal(prompt.toLowerCase().split(cue).length - 1, 1, cue);
    assert.match(prompt, /never dictate another character's feelings or reactions/);
    assert.match(prompt, /pause before answering/);
    assert.deepEqual(npc, before, 'portrayal never writes actor or continuity state');
    const profile = actorProfiles([npc], 3)[0];
    assert.equal(profile.appearance, 'Dark hair; brown travelling coat');
    assert.deepEqual(profile.presentation.impression, ['quietly imposing']);
    assert.doesNotMatch(JSON.stringify(profile), /Hidden vault/);
    for (const actor of [{ ...npc, present: false }, { ...npc, lifeState: 'deceased', lifeStateCertainty: 'explicit', archived: true }]) assert.doesNotMatch(buildInjection([actor], 'Remember Ari Vale.', 2), /PRESENCE \(|PORTRAYAL ONLY/);
    assert.ok(buildInjection([npc], 'Ari Vale enters.', 1, 3, undefined, 512).length <= 512 * 4);
});
