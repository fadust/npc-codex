/* NPC Codex: trust rules (spec S3, fadust fork).
 *
 * S3.1 provenance: where each dossier value came from - edited (the player), canon (seeded from a
 *      lorebook/card entry and unchanged since), generated (a local fallback), or story (the turn
 *      that last changed it).
 * S3.4 evidence-first presence: an NPC newly marked present must be named in the reply itself, not
 *      only in the player's message or a system notice (the player wishing Sera back does not
 *      bring her back).
 * S3.6 capped deltas for numbers the story did not state: a resource pool moves at most half its
 *      maximum per scan unless the exchange gives the new figure.
 *
 * Pure module: no host, DOM or storage access. */

export const PROVENANCE_FIELDS = Object.freeze(['species', 'gender', 'age', 'apparentAge', 'overallAppearance', 'appearance', 'personality', 'speech', 'background', 'homeBase', 'role', 'likes', 'dislikes', 'birthDate']);

function filled(value) {
    if (Array.isArray(value)) return value.length > 0;
    return String(value ?? '').trim() !== '';
}

// { origin: 'edited'|'canon'|'generated'|'story'|'unknown', detail }
export function provenanceOf(npc, field) {
    if (!filled(npc?.[field])) return null;
    const manual = Array.isArray(npc?.manualProfileFields) ? npc.manualProfileFields : [];
    if (manual.includes(field)) return { origin: 'edited', detail: 'set by you' };
    if (field === 'birthDate' && npc?.birthDateSource === 'generated') return { origin: 'generated', detail: 'local fallback' };
    const seed = npc?.canonSeed;
    const changed = Number.isInteger(npc?.fieldChanges?.[field]) ? npc.fieldChanges[field] : null;
    if (seed && Array.isArray(seed.fields) && seed.fields.includes(field) && (changed === null || changed === seed.turn)) {
        return { origin: 'canon', detail: `${seed.world === 'card' ? 'card' : 'lorebook'}: ${seed.entry || 'entry'}` };
    }
    if (changed !== null) return { origin: 'story', detail: `turn ${changed}` };
    return { origin: 'unknown', detail: '' };
}

export function provenanceLines(npc) {
    return PROVENANCE_FIELDS.map(field => ({ field, source: provenanceOf(npc, field) }))
        .filter(item => item.source)
        .map(item => `${item.field}: ${item.source.origin}${item.source.detail ? ` (${item.source.detail})` : ''}`);
}

function labelsOf(npc) {
    const roles = (Array.isArray(npc?.roles) ? npc.roles : []).filter(role => !role?.until).map(role => role?.title);
    return [npc?.name, ...(Array.isArray(npc?.aliases) ? npc.aliases : []), ...roles]
        .map(label => String(label || '').trim().toLowerCase())
        .filter(label => label.length > 2);
}

// Returns { npcs, reverted[] }: newly present NPCs the reply never names are set back to absent.
export function presenceGuard(beforeNpcs, afterNpcs, replyText) {
    const reply = String(replyText || '').toLowerCase();
    if (!reply.trim()) return { npcs: afterNpcs, reverted: [] };
    const wasPresent = new Set((Array.isArray(beforeNpcs) ? beforeNpcs : []).filter(npc => npc?.present).map(npc => npc.id));
    const reverted = [];
    const npcs = (Array.isArray(afterNpcs) ? afterNpcs : []).map(npc => {
        if (!npc?.present || wasPresent.has(npc.id)) return npc;
        if (labelsOf(npc).some(label => reply.includes(label))) return npc;
        reverted.push(npc.id);
        return { ...npc, present: false };
    });
    return { npcs, reverted };
}

// Pools whose new figure the exchange does not state move at most half the maximum per scan.
export function capPoolChanges(delta, sheet, transcript) {
    if (!delta || !Array.isArray(delta.pools) || !delta.pools.length) return { delta, capped: [] };
    const text = String(transcript || '');
    const previous = new Map((Array.isArray(sheet?.pools) ? sheet.pools : []).map(pool => [String(pool?.name || '').toLowerCase(), pool]));
    const capped = [];
    const pools = delta.pools.map(pool => {
        const before = previous.get(String(pool?.name || '').toLowerCase());
        const current = Number(pool?.current);
        const max = Number(pool?.max) || Number(before?.max) || 0;
        if (!before || !Number.isFinite(current) || !(max > 0)) return pool;
        if (new RegExp(`(^|[^0-9])${current}([^0-9]|$)`).test(text)) return pool;
        const was = Number(before.current) || 0;
        const limit = Math.ceil(max / 2);
        if (Math.abs(current - was) <= limit) return pool;
        const bounded = current > was ? Math.min(max, was + limit) : Math.max(0, was - limit);
        capped.push(`${pool.name}: ${was} -> ${current} capped to ${bounded}`);
        return { ...pool, current: bounded };
    });
    return { delta: { ...delta, pools }, capped };
}
