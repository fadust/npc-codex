import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createNpcRecord, mergeScanResult, buildInjection } from '../core.js';
import { resolveSagaAdmissions } from '../saga-canon.js';
import { captureCanonRevision, canonRevisionCurrent } from '../saga-canon.js';
import { buildCastShortlist } from '../cast.js';
import { actorProfiles, resolveActor, readStoryContinuity } from '../actor-stack.js';
import { acceptPortrayal, renderPortrayal, PORTRAYAL_REFERENCES } from '../actor-portrayal.js';
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/layer1-ari.json', import.meta.url)));
const ari = () => ({ ...createNpcRecord(fixture.card.name), id: 'ari', personality: 'deliberate', speech: 'speaks softly', present: true });
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
