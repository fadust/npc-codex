import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord } from '../core.js';
import { renderMemoryInjection } from '../memory.js';
import {
    desiredPoints,
    embedPrefixes,
    normalizeRecallSettings,
    pointId,
    queryRecallScores,
    recallCollection,
    resetRecallSession,
    syncRecallIndex,
} from '../recall-index.js';

function npcs() {
    const aria = { ...createNpcRecord('Aria'), episodes: [
        { id: 'm1', eventId: 'e1', event: 'Kai bribed the gate guard', level: 'significant', turn: 2 },
        { id: 'm2', event: 'shared a joke about the innkeeper goat', level: 'minor', turn: 3 },
    ] };
    const kael = { ...createNpcRecord('Kael', [aria.id]), episodes: [{ id: 'm1', eventId: 'e1', event: 'Kai bribed the gate guard', level: 'minor', turn: 2 }] };
    return [aria, kael];
}

function mockTransport() {
    const calls = [];
    const transport = {
        calls,
        headers: () => ({ 'X-CSRF-Token': 't' }),
        fetch: async (url, init) => {
            const body = JSON.parse(init.body);
            calls.push({ path: url.replace('/api/plugins/similharity', ''), body });
            if (url.endsWith('/chunks/query')) {
                return { ok: true, json: async () => ({ results: transport.hits || [] }) };
            }
            return { ok: true, json: async () => ({ success: true }) };
        },
    };
    return transport;
}

test('one point per shared event or private episode; ids are stable per chat', () => {
    const points = desiredPoints(npcs(), 'chat:A');
    assert.equal(points.size, 2, 'e1 is stored once although two NPCs hold it');
    assert.deepEqual([...points.values()].map(point => point.key).sort(), ['e1', `${npcs()[0].id}:m2`].sort());
    assert.equal(pointId('chat:A', 'e1'), pointId('chat:A', 'e1'));
    assert.notEqual(pointId('chat:A', 'e1'), pointId('chat:B', 'e1'));
    assert.ok(Number.isSafeInteger(pointId('chat:A', 'e1')));
});

test('settings, per-model collections and retrieval prefixes', () => {
    assert.equal(normalizeRecallSettings({}).enabled, false);
    assert.equal(normalizeRecallSettings({}).model, 'text-embedding-embeddinggemma-2');
    assert.equal(recallCollection('text-embedding-embeddinggemma-2'), 'npc_codex_memory_text_embedding_embeddinggemma_2');
    assert.match(embedPrefixes('text-embedding-embeddinggemma-2').query, /^task: search result \| query: /);
    assert.equal(embedPrefixes('text-embedding-nomic-embed-text-v1.5').doc, 'search_document: ');
});

test('sync writes only new/changed memories and deletes rolled-back ones; query maps hits back to keys', async () => {
    resetRecallSession();
    const cfg = normalizeRecallSettings({ enabled: true });
    const transport = mockTransport();
    const cast = npcs();
    assert.deepEqual(await syncRecallIndex(cast, 'chat:A', cfg, transport), { inserted: 2, deleted: 0 });
    assert.deepEqual(transport.calls.map(call => call.path), ['/backend/init/qdrant', '/chunks/insert']);
    assert.match(transport.calls[1].body.items[0].text, /^title: none \| text: /);
    assert.equal(transport.calls[1].body.apiUrl, 'http://127.0.0.1:1234');
    assert.deepEqual(await syncRecallIndex(cast, 'chat:A', cfg, transport), { inserted: 0, deleted: 0 }, 'nothing re-embedded');
    // A swipe removed the goat joke: its point goes.
    cast[0] = { ...cast[0], episodes: cast[0].episodes.slice(0, 1) };
    assert.deepEqual(await syncRecallIndex(cast, 'chat:A', cfg, transport), { inserted: 0, deleted: 1 });

    transport.hits = [{ hash: pointId('chat:A', 'e1'), score: 0.81 }, { hash: 12345, score: 0.9 }, { hash: pointId('chat:A', 'e1'), score: 0.3 }];
    const scores = await queryRecallScores(cast, 'chat:A', 'the guard at the gate', cfg, transport);
    assert.deepEqual([...scores], [['e1', 0.81]], 'unknown points are ignored');
});

test('disabled or empty scene: no requests at all', async () => {
    resetRecallSession();
    const transport = mockTransport();
    await syncRecallIndex(npcs(), 'chat:A', normalizeRecallSettings({ enabled: false }), transport);
    await queryRecallScores(npcs(), 'chat:A', '   ', normalizeRecallSettings({ enabled: true }), transport);
    assert.equal(transport.calls.length, 0);
});

test('vector similarity surfaces a memory the keywords miss', () => {
    const npc = { ...createNpcRecord('Aria'), episodes: [
        { id: 'm1', event: 'shared a joke about the innkeeper goat', level: 'minor', turn: 2 },
        ...['sparred in the yard', 'bought rope', 'cleaned the blades', 'checked the horses', 'mended a cloak'].map((event, i) => ({ id: `m${i + 2}`, event, level: 'minor', turn: 30 + i })),
    ] };
    const scene = 'That smelly animal is chewing the tablecloth again.';
    assert.doesNotMatch(renderMemoryInjection(npc, { turn: 35, text: scene }), /goat/);
    assert.match(renderMemoryInjection(npc, { turn: 35, text: scene, vector: new Map([[`${npc.id}:m1`, 0.72]]) }), /goat/);
});
