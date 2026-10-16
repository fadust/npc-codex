/* NPC Codex: vector recall (memory Phase B2) through the Similharity server plugin and Qdrant.
 *
 * The index is derived and rebuildable; the chat's dossiers stay the source of truth. One point
 * per memory text (a shared event, or a private episode without one), filtered by chat. Qdrant
 * only scores memories by meaning against the current scene; which NPC holds which memory, and
 * so witness gating, stays in NPC Codex. Any failure or timeout falls back to keyword recall.
 *
 * The request transport is injected (index.js passes fetch + SillyTavern's request headers), so
 * the pure parts are testable. */

export const RECALL_DEFAULTS = Object.freeze({
    enabled: false,
    qdrantUrl: 'http://127.0.0.1:6335',
    apiUrl: 'http://127.0.0.1:1234',
    source: 'vllm',
    model: 'text-embedding-embeddinggemma-2',
    topK: 24,
    minScore: 0.3,
    timeoutMs: 8000,
});
const BASE = '/api/plugins/similharity';
// One collection per embedding model: vector sizes differ between models.
export function recallCollection(model) {
    return `npc_codex_memory_${String(model || 'default').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60)}`;
}

// Retrieval prompt formats each embedding family was trained with.
export function embedPrefixes(model) {
    const name = String(model || '').toLowerCase();
    if (name.includes('gemma')) return { doc: 'title: none | text: ', query: 'task: search result | query: ' };
    if (name.includes('nomic')) return { doc: 'search_document: ', query: 'search_query: ' };
    if (name.includes('qwen3')) return { doc: '', query: 'Instruct: Given a roleplay scene, retrieve the character memories it brings to mind\nQuery: ' };
    return { doc: '', query: '' };
}

export function normalizeRecallSettings(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const text = (value, fallback) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);
    const number = (value, fallback, min, max) => (Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback);
    return {
        enabled: source.enabled === true,
        qdrantUrl: text(source.qdrantUrl, RECALL_DEFAULTS.qdrantUrl),
        apiUrl: text(source.apiUrl, RECALL_DEFAULTS.apiUrl),
        source: text(source.source, RECALL_DEFAULTS.source),
        model: text(source.model, RECALL_DEFAULTS.model),
        topK: number(source.topK, RECALL_DEFAULTS.topK, 4, 100),
        minScore: number(source.minScore, RECALL_DEFAULTS.minScore, 0, 1),
        timeoutMs: number(source.timeoutMs, RECALL_DEFAULTS.timeoutMs, 500, 15000),
    };
}

// The recall key an episode is scored under: its shared event, else the NPC's own episode.
export function memoryKey(npcId, episode) {
    return episode?.eventId || `${npcId}:${episode?.id}`;
}

// Stable numeric Qdrant id per chat + key (two FNV-1a halves into a safe integer).
export function pointId(chatKey, key) {
    const fnv = (text, seed) => {
        let hash = seed >>> 0;
        for (let i = 0; i < text.length; i += 1) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619) >>> 0; }
        return hash;
    };
    const text = `${chatKey}|${key}`;
    return fnv(text, 2166136261) * 2 ** 20 + (fnv(text, 33554467) & 0xFFFFF);
}

// What the index should hold for this chat: Map pointId -> { key, text }.
export function desiredPoints(npcs, chatKey) {
    const out = new Map();
    for (const npc of Array.isArray(npcs) ? npcs : []) {
        if (!npc || npc.archived) continue;
        for (const episode of Array.isArray(npc.episodes) ? npc.episodes : []) {
            if (!episode?.event) continue;
            const key = memoryKey(npc.id, episode);
            const id = pointId(chatKey, key);
            if (!out.has(id)) out.set(id, { key, text: episode.event });
        }
    }
    return out;
}

// Session cache of what this tab has written per chat: chatKey -> Map(pointId -> text).
const written = new Map();
let initializedFor = '';

async function call(transport, path, body, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await transport.fetch(`${BASE}${path}`, {
            method: 'POST',
            headers: { ...transport.headers(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error(`${path} ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

async function ensureBackend(transport, cfg) {
    if (initializedFor === cfg.qdrantUrl) return;
    await call(transport, '/backend/init/qdrant', { url: cfg.qdrantUrl }, cfg.timeoutMs);
    initializedFor = cfg.qdrantUrl;
}

function embedOptions(cfg) {
    return { backend: 'qdrant', collectionId: recallCollection(cfg.model), source: cfg.source, model: cfg.model, apiUrl: cfg.apiUrl };
}

// Brings the index in line with the dossiers: new or changed memories are written, memories
// rolled back (swipe/delete/edit) this session are removed. Returns { inserted, deleted }.
export async function syncRecallIndex(npcs, chatKey, cfg, transport) {
    if (!cfg?.enabled || !chatKey) return { inserted: 0, deleted: 0 };
    await ensureBackend(transport, cfg);
    const want = desiredPoints(npcs, chatKey);
    const have = written.get(chatKey) || new Map();
    const items = [...want].filter(([id, point]) => have.get(id) !== point.text)
        .map(([id, point]) => ({ hash: id, text: `${embedPrefixes(cfg.model).doc}${point.text}`, index: 0, metadata: { chatId: chatKey, memoryKey: point.key, type: 'npc_codex_memory' } }));
    const stale = [...have.keys()].filter(id => !want.has(id));
    if (items.length) await call(transport, '/chunks/insert', { ...embedOptions(cfg), items, filters: { chatId: chatKey } }, Math.max(30000, cfg.timeoutMs + items.length * 500));
    if (stale.length) await call(transport, '/chunks/delete', { ...embedOptions(cfg), hashes: stale }, cfg.timeoutMs);
    written.set(chatKey, new Map([...want].map(([id, point]) => [id, point.text])));
    return { inserted: items.length, deleted: stale.length };
}

// Embedding models score everything in one story close together (embeddinggemma, measured live:
// 0.60-0.80 for every memory, an unrelated scene still reaching 0.68). The signal is how far a
// memory stands ABOVE the rest for this scene: relevant ones sat +0.08..0.10 over the median,
// unrelated scenes' best only +0.03..0.04. Relevance = (score - median - margin) / span, 0..1.
export const RELATIVE_MARGIN = 0.03;
export const RELATIVE_SPAN = 0.07;
const SMALL_POOL_BASELINE = 0.65;

export function relativeRelevance(scores) {
    const list = scores.filter(Number.isFinite).sort((a, b) => a - b);
    if (!list.length) return () => 0;
    const mid = Math.floor(list.length / 2);
    const median = list.length >= 3 ? (list.length % 2 ? list[mid] : (list[mid - 1] + list[mid]) / 2) : SMALL_POOL_BASELINE;
    return score => Math.max(0, Math.min(1, (score - median - RELATIVE_MARGIN) / RELATIVE_SPAN));
}

// Relevance of each memory key to the scene: Map key -> 0..1 (only keys above the pack).
export async function queryRecallScores(npcs, chatKey, sceneText, cfg, transport) {
    if (!cfg?.enabled || !chatKey || !String(sceneText || '').trim()) return new Map();
    await ensureBackend(transport, cfg);
    const want = desiredPoints(npcs, chatKey);
    if (!want.size) return new Map();
    const result = await call(transport, '/chunks/query', {
        ...embedOptions(cfg),
        searchText: `${embedPrefixes(cfg.model).query}${String(sceneText).slice(-1500)}`,
        topK: cfg.topK,
        threshold: cfg.minScore,
        filters: { chatId: chatKey },
    }, cfg.timeoutMs);
    const hits = (Array.isArray(result?.results) ? result.results : [])
        .map(hit => ({ point: want.get(Number(hit?.hash)), score: Number(hit?.score) }))
        .filter(hit => hit.point && Number.isFinite(hit.score) && hit.score >= cfg.minScore);
    const relevance = relativeRelevance(hits.map(hit => hit.score));
    const scores = new Map();
    for (const hit of hits) {
        const value = relevance(hit.score);
        if (value > 0) scores.set(hit.point.key, Math.max(scores.get(hit.point.key) || 0, value));
    }
    return scores;
}

export function resetRecallSession() {
    written.clear();
    initializedFor = '';
}
