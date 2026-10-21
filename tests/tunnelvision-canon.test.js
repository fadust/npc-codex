import test from 'node:test';
import assert from 'node:assert/strict';
import { sagaCanonBridge, captureCanonRevision, canonRevisionCurrent } from '../saga-canon.js';

test('TunnelVision canon takes ownership without a raw fallback on unavailable evidence', () => {
    const oldSaga = globalThis.Saga, oldTunnel = globalThis.TunnelVision;
    try {
        const saga = { canonStatus: () => ({ enabled: true }), canonRevision: () => 'saga' };
        let revision = 'current', enabled = true;
        const tunnel = { canonStatus: () => ({ enabled }), canonRevision: () => revision, queryCanon: async () => ({ status: 'unavailable', entries: [] }) };
        globalThis.Saga = { bridge: saga }; globalThis.TunnelVision = { bridge: tunnel };
        assert.equal(sagaCanonBridge(), tunnel);
        const token = captureCanonRevision(); assert.equal(canonRevisionCurrent(token), true);
        revision = 'new'; assert.equal(canonRevisionCurrent(token), false);
        const next = captureCanonRevision(); enabled = false;
        assert.equal(canonRevisionCurrent(next), false); assert.equal(sagaCanonBridge(), saga);
    } finally { globalThis.Saga = oldSaga; globalThis.TunnelVision = oldTunnel; }
});
