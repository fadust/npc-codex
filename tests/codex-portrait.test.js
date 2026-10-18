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
    assert.deepEqual(request, { prompt: 'full body, copper hair', negative: 'blur', seed: 0, size: 'portrait', character: 'Ari', save: true });
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
