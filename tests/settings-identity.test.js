import test from 'node:test';
import assert from 'node:assert/strict';
import { codexSettings } from '../settings-identity.js';
import { selectedScannerProfileId } from '../scanner-routing.js';
import { decodeStateFilePayload, encodeStateFilePayload } from '../storage.js';
import { decodeNpcStateBundle, encodeNpcStateBundle } from '../bundle.js';

test('renamed settings retain saved values and old bridge readers without duplicate serialization', () => {
    const saved = { scannerConnectionProfile: 'my-profile', dataFiles: { chat: 'saved-path' }, inject: false };
    const root = { npc_state_delta: saved };
    assert.equal(codexSettings(root), saved);
    assert.equal(root.npc_state_delta, root.npc_codex);
    assert.equal(selectedScannerProfileId({ extensionSettings: root }), 'my-profile');
    assert.deepEqual(JSON.parse(JSON.stringify(root)), { npc_codex: saved });
    const reloaded = JSON.parse(JSON.stringify(root));
    codexSettings(reloaded);
    assert.deepEqual(reloaded.npc_state_delta, saved);
    const updated = { inject: true };
    reloaded.npc_state_delta = updated;
    assert.equal(reloaded.npc_codex, updated);
});

test('existing Codex settings take priority and repeated reads keep one owner', () => {
    const current = { inject: false };
    const root = { npc_codex: current, npc_state_delta: { inject: true } };
    assert.equal(codexSettings(root), current);
    assert.equal(codexSettings(root), current);
    assert.equal(root.npc_state_delta, current);
});

test('saved pre-rename sidecars remain readable', () => {
    const old = JSON.parse(encodeStateFilePayload('chat:test', { npcs: [{ name: 'Ari' }] }, '2.0.2'));
    old.format = 'npc_state_delta_chat_data';
    assert.deepEqual(decodeStateFilePayload(JSON.stringify(old)).state, old.state);
});

test('saved pre-rename native bundles remain readable', () => {
    const bytes = encodeNpcStateBundle({ npcs: [], dismissed: [] });
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
    const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + size)));
    manifest.format = 'npc_state_delta_bundle';
    const oldManifest = new TextEncoder().encode(JSON.stringify(manifest));
    const old = new Uint8Array(12 + oldManifest.length + bytes.length - 12 - size);
    old.set(bytes.subarray(0, 12));
    new DataView(old.buffer).setUint32(8, oldManifest.length, true);
    old.set(oldManifest, 12);
    old.set(bytes.subarray(12 + size), 12 + oldManifest.length);
    assert.doesNotThrow(() => decodeNpcStateBundle(old));
});
