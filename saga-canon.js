import { scanLabelsMatch } from './core-mechanics.js';
// Saga supplies evidence; canonical dossier admission and persistence remain in NPC Codex.
import { CANON_SEED_FIELDS, parseCanonSeed } from './canon-seed.js';
const norm = value => String(value || '').normalize('NFKC').toLowerCase().trim();
export function sagaCanonBridge() {
    const bridge = globalThis.Saga?.bridge;
    return bridge?.canonStatus?.().enabled ? bridge : null;
}

export function sagaCanonEntries(result) {
    const groups = new Map();
    for (const entry of result?.entries || []) {
        if (!entry.entity || !entry.revision || !entry.text || !Array.isArray(entry.basis)) continue;
        const key = `${entry.entity}@${entry.revision}`;
        const group = groups.get(key) || { world: `Saga:${key}`, uid: 0, comment: entry.title,
            key: [entry.title, ...(entry.aliases || [])], content: '', passages: new Set() };
        if (!group.passages.has(entry.text)) { group.passages.add(entry.text); group.content += `${group.content ? '\n' : ''}${entry.text}`; }
        groups.set(key, group);
    }
    return [...groups.values()].map(({ passages, ...entry }) => entry);
}

export async function readSagaCanon(query, { bridge = sagaCanonBridge(), signal } = {}) {
    if (!bridge) return null;
    try { return await bridge.queryCanon(query, { purpose: 'story', signal }); }
    catch { return { status: 'unavailable', entries: [], text: '' }; }
}

export async function resolveSagaAdmissions(parsed, existing, { bridge = sagaCanonBridge(), signal = AbortSignal.timeout(3000) } = {}) {
    if (!bridge) return parsed;
    const live = Array.isArray(existing) ? existing : [];
    const rows = Array.isArray(parsed?.npcs) ? parsed.npcs : [];
    const lookups = new Map();
    const resolved = await Promise.all(rows.map(async row => {
        const known = live.filter(npc => (row.id && npc.id === row.id)
            || scanLabelsMatch(npc, row));
        if (known.length === 1) return { ...row, id: known[0].id };
        if (known.length > 1 || !row.name) return null;
        try {
            const key = norm(row.name);
            if (!lookups.has(key)) lookups.set(key, bridge.queryCanon(row.name, { purpose: 'identity', signal }));
            const result = await lookups.get(key); signal.throwIfAborted();
            if (result.status === 'no-match') return row;
            if (result.status !== 'matched' || result.candidates?.length !== 1) return null;
            const name = result.candidates[0];
            const canonical = live.filter(npc => [npc.name, ...(npc.aliases || [])].some(label => norm(label) === norm(name)));
            if (canonical.length > 1) return null;
            const evidence = sagaCanonEntries(result).find(entry => norm(entry.comment) === norm(name));
            if (!evidence) return null;
            const grounded = { ...row };
            if (!canonical[0]) {
                const { fields } = parseCanonSeed(row, evidence.content, { strict: true });
                for (const field of CANON_SEED_FIELDS) delete grounded[field];
                Object.assign(grounded, fields);
            }
            return { ...grounded, ...(canonical[0] ? { id: canonical[0].id } : {}), name,
                canonRef: { world: evidence.world, uid: evidence.uid, name },
                aliases: [...new Set([...(row.aliases || []), ...(norm(row.name) !== norm(name) ? [row.name] : [])])] };
        } catch { return null; }
    }));
    const admitted = resolved.filter(Boolean);
    const allowed = row => live.some(npc => npc.id === row.id || norm(npc.name) === norm(row.name))
        || admitted.some(npc => (row.id && npc.id === row.id) || norm(npc.name) === norm(row.name));
    return { ...parsed, npcs: admitted,
        ...(Array.isArray(parsed.profileUpdates) ? { profileUpdates: parsed.profileUpdates.filter(allowed) } : {}),
        ...(Array.isArray(parsed.profile_updates) ? { profile_updates: parsed.profile_updates.filter(allowed) } : {}) };
}

export function captureCanonRevision(bridge = sagaCanonBridge()) {
    if (!bridge) return null;
    return typeof bridge.canonRevision === 'function' ? { bridge, revision: bridge.canonRevision() } : { bridge, revision: undefined };
}
export function canonRevisionCurrent(token) {
    if (!token) return !sagaCanonBridge();
    return token.revision !== undefined && sagaCanonBridge() === token.bridge && token.bridge.canonRevision() === token.revision;
}
