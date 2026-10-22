import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBaiBaiPortrait } from '../portrait-tools.js';
import { originalPortraitSource } from '../dossier-tools-core.js';

test('BaiBai portrait uses explicit accepted prompt, existing backend, original gallery image and actual seed', async () => {
    let request;
    const bridge = { apiVersion: 1, getBackendStatus: () => ({ configured: true }), generate: async value => {
        request = value;
        return { dataUrl: 'data:image/png;base64,AAAA', path: '/user/images/Ari/original.png', seed: 42 };
    } };
    assert.deepEqual(await generateBaiBaiPortrait({ positive: 'full body, copper hair', negative: 'blur', seed: 0, name: 'Ari' }, bridge), { url: '/user/images/Ari/original.png', seed: 42 });
    assert.deepEqual(request, { prompt: 'full body, copper hair', nl: 'full body, copper hair', negative: 'blur', seed: 0, size: 'portrait', character: 'Ari', save: true });
});

test('BaiBai unavailability and invalid output fail without fallback or dossier mutation', async () => {
    await assert.rejects(generateBaiBaiPortrait({ positive: 'Ari' }, {}), /API v1/);
    await assert.rejects(generateBaiBaiPortrait({ positive: 'Ari' }, { apiVersion: 1, generate() { assert.fail('must not dispatch'); }, getBackendStatus: () => ({ configured: false, reason: 'No backend' }) }), /No backend/);
    await assert.rejects(generateBaiBaiPortrait({ positive: 'Ari' }, { apiVersion: 1, generate: async () => ({ dataUrl: 'javascript:bad' }), getBackendStatus: () => ({ configured: true }) }), /supported image/);
});

test('original viewer prefers saved local original and rejects unsafe or external original links', () => {
    assert.equal(originalPortraitSource({ generatedFrom: '/user/images/Ari/full.png', dataUrl: 'thumb' }), '/user/images/Ari/full.png');
    for (const generatedFrom of ['javascript:bad', 'https://unknown.example/a.png', '//unknown/a.png']) assert.equal(originalPortraitSource({ generatedFrom, dataUrl: 'thumb' }), 'thumb');
});

import { createNpcRecord, replacePortraitImage, normalizeFormPortraitAssets } from '../core.js';
import { dossierDetailProjection, appearanceDetailSections, presentationDetails, appearanceFormsHtml } from '../dossier-ui.js';
import { encodeNpcStateBundle, decodeNpcStateBundle } from '../bundle.js';
import { prunePortraitAssetsForState, pruneFormPortraitAssetsForState } from '../storage.js';

const face = { dataUrl: 'data:image/png;base64,AAAA', generatedFrom: '/user/images/Ari/face.png' };
const body = { dataUrl: 'data:image/png;base64,AQID', generatedFrom: '/user/images/Ari/body.png' };
test('face and full-body assets replace and remove independently, including body-first creation', () => {
    const both = replacePortraitImage(face, body, 'fullBody');
    assert.deepEqual(both, { ...face, fullBody: body });
    assert.deepEqual(replacePortraitImage(both, null), { fullBody: body });
    assert.deepEqual(replacePortraitImage(both, null, 'fullBody'), face);
    assert.deepEqual(replacePortraitImage({ fullBody: body }, face), both);
    assert.equal(replacePortraitImage({ fullBody: body }, null, 'fullBody'), null);
    assert.throws(() => replacePortraitImage(both, face, '__proto__'), /slot/);
});
test('independent images survive native backup, body-only storage and form selection', () => {
    const npc = { ...createNpcRecord('Ari Vale'), currentForm: 'Human', portrait: { ...face, fullBody: body } };
    const state = { npcs: [npc], portraitAssets: { [npc.id]: { fullBody: body } }, formPortraitAssets: { [npc.id]: { human: { form: 'Human', fullBody: body } } } };
    assert.deepEqual(prunePortraitAssetsForState(state)[npc.id], { fullBody: body });
    assert.deepEqual(pruneFormPortraitAssetsForState(state), state.formPortraitAssets);
    assert.deepEqual(normalizeFormPortraitAssets(state.formPortraitAssets), state.formPortraitAssets);
    const result = decodeNpcStateBundle(encodeNpcStateBundle(state)).state;
    assert.equal(result.npcs[0].portrait.dataUrl, face.dataUrl);
    assert.equal(result.npcs[0].portrait.fullBody.dataUrl, body.dataUrl);
    assert.equal(result.formPortraitAssets[npc.id].human.fullBody.dataUrl, body.dataUrl);
    const shown = dossierDetailProjection(npc, {}, { Human: { fullBody: body } });
    assert.equal(shown.portrait, face.dataUrl);
    assert.equal(shown.fullBody, body.dataUrl);
    assert.equal(shown.fullBodyFromForm, true);
    const old = dossierDetailProjection({ ...npc, portrait: face });
    assert.equal(old.portrait, face.dataUrl);
    assert.equal(old.fullBody, '', 'old face images are not misrepresented as full-body renders');
    const bodyOnly = { ...npc, portrait: { fullBody: body } };
    assert.equal(decodeNpcStateBundle(encodeNpcStateBundle({ npcs: [bodyOnly] })).state.npcs[0].portrait.fullBody.dataUrl, body.dataUrl);
});

test('appearance categories retain supplied details without inventing missing traits', () => {
    const parts = appearanceDetailSections('Face: blue eyes; Body: athletic; Proportions: long legs; Outfit: brown coat; silver aura');
    assert.deepEqual(Object.fromEntries(Object.entries(parts).filter(([, values]) => values.length)), { Face: ['blue eyes'], Body: ['athletic'], Proportions: ['long legs'], Outfit: ['brown coat'], 'Other details': ['silver aura'] });
    assert.deepEqual(appearanceDetailSections('dark hair, blue eyes, brown coat').Proportions, []);
    assert.deepEqual(appearanceDetailSections('dark hair, blue eyes, brown coat').Face, ['blue eyes']);
});

test('appearance shows accepted identity, visual age and distinct hair/skin/accessory details', () => {
    const p = appearanceDetailSections('long black hair; tan skin; trimmed beard; silver earrings; blue eyes', { gender: 'male', species: 'Human', age: '80', apparentAge: '25' });
    assert.deepEqual(p.Gender, ['male']);
    assert.deepEqual(p['Age bracket'], ['Young adult (apparent age 25)']);
    assert.deepEqual(p['Skin color'], ['tan skin']);
    assert.deepEqual(p.Hairstyle, ['long black hair']);
    assert.deepEqual(p['Hair color'], ['long black hair']);
    assert.deepEqual(p['Facial hair'], ['trimmed beard']);
    assert.deepEqual(p.Accessories, ['silver earrings']);
    assert.deepEqual(appearanceDetailSections('', { species: 'Elf', age: '300' })['Age bracket'], ['Age: 300 — bracket unspecified']);
    for (const [age, label] of [[8, 'Kid'], [16, 'Teen'], [20, 'Young adult'], [35, 'Adult'], [55, 'Middle-aged'], [70, 'Old'], [85, 'Very old']]) {
        assert.equal(appearanceDetailSections('', { species: 'Human', age })['Age bracket'][0], `${label} (age ${age})`);
    }
    assert.deepEqual(appearanceDetailSections('').Gender, []);
});

test('Presentations quotes supported impressions and bearing without appearance or personality inference', () => {
    const npc = { ...createNpcRecord('Ari Vale'), appearance: 'Dark hair; brown coat; Impression: quietly imposing; Bearing: stands upright', mannerisms: ['moves with measured grace'], personality: 'Trustworthy and kind', mood: 'Calm' };
    assert.deepEqual(presentationDetails(npc), { impression: ['quietly imposing'], bearing: ['stands upright', 'moves with measured grace'] });
    assert.deepEqual(presentationDetails({ appearance: 'blue eyes; expensive coat', personality: 'Confident', mood: 'Calm' }), { impression: [], bearing: [] });
    assert.deepEqual(presentationDetails({ appearance: 'Impression: imposing in a red coat' }), { impression: [], bearing: [] });
    const html = appearanceFormsHtml(dossierDetailProjection(npc));
    const [appearance, presentation] = html.split('<details class="delta-appearance-form-summary" data-delta-key="presentations">');
    assert.match(appearance, /brown coat/);
    assert.doesNotMatch(appearance, /quietly imposing|stands upright/);
    assert.match(presentation, /quietly imposing/);
    assert.match(presentation, /stands upright/);
    assert.doesNotMatch(presentation, /Dark hair|brown coat|Trustworthy|Calm/);
    assert.match(presentation, /Overall impression &amp; bearing/);
});
