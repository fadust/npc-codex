import { resolveNpcAppearance } from './appearance.js';
import { presentationDetails, physicalDescription } from './actor-portrayal.js';
import { isTerminalNpcDeath } from './terminal-lifecycle.js';
import { inferNpcIdentityKind } from './core-mechanics.js';
// Fixed ownership contract: this fork is the actor writer, not a second event recorder.
export const ACTOR_OWNERS = Object.freeze({ canon: 'Saga', continuity: 'BaiBai', actor: 'NPC Codex', portrayal: 'NPC Codex / BunnyMo references' });
const norm = value => String(value || '').normalize('NFKC').toLowerCase().trim();
export function resolveActor(npcs, value) {
    const rows = (npcs || []).filter(n => n?.id);
    const byId = rows.find(n => n.id === value);
    if (byId) return byId;
    const matches = rows.filter(n => [n.name, ...(n.aliases || [])].some(label => norm(label) === norm(value)));
    return matches.length === 1 ? matches[0] : null;
}
export function actorProfiles(npcs, revision) {
    return (npcs || []).map(n => ({ id: n.id, name: n.name, aliases: [...(n.aliases || [])], revision,
        present: !!n.present && !n.archived, archived: !!n.archived, lifeState: n.lifeState,
        appearance: physicalDescription(resolveNpcAppearance(n)),
        presentation: presentationDetails({ ...n, appearance: resolveNpcAppearance(n) }),
        role: n.role || '', personality: n.personality || '', speech: n.speech || '',
        provenance: n.canonRef ? { ...n.canonRef } : { source: 'accepted-dossier' } }));
}
export async function readStoryContinuity(api, chatLength, chatId, groupId = null) {
    try {
        const snapshot = await api?.getSnapshot?.();
        if (!snapshot || snapshot.apiVersion !== 1 || snapshot.chat?.length !== chatLength
            || (chatId !== undefined && (snapshot.chat.id !== chatId || (snapshot.chat.groupId || null) !== groupId))) return { status: 'unavailable', npcs: [], location: '' };
        return { status: snapshot.coverage?.complete ? 'complete' : 'partial', revision: snapshot.revision,
            chat: snapshot.chat.id, point: snapshot.point, location: String(snapshot.state?.location || ''),
            npcs: Array.isArray(snapshot.npcs) ? snapshot.npcs : [] };
    } catch { return { status: 'unavailable', npcs: [], location: '' }; }
}

// A reversible prompt projection, never a second writer of canonical actor records.
export function withBaiBaiPresence(npcs, api, { chatId, groupId = null, chatLength, floor } = {}) {
    try {
        if (!chatId || !Number.isInteger(floor) || floor < 0) return npcs;
        const source = api?.getFloor?.(floor);
        if (source?.apiVersion !== 1 || source.floor !== floor || source.role !== 'assistant' || source.omitted
            || source.chat?.id !== chatId || (source.chat.groupId || null) !== groupId || source.chat.length !== chatLength
            || source.memory?.valid !== true || source.memory.presenceSourceValid !== true) return npcs;
        const focus = source.memory.delta?.sceneFocus;
        if (!focus || typeof focus.situation !== 'string' || !focus.situation.trim() || !Array.isArray(focus.participants)) return npcs;
        const present = new Set();
        for (const name of focus.participants) {
            if (typeof name !== 'string' || !norm(name) || inferNpcIdentityKind(name) !== 'proper_name') continue;
            // Match across the whole roster before eligibility filtering: a dead/locked namesake is still ambiguous.
            const matches = npcs.filter(n => [n.name, ...(n.aliases || [])].some(label => norm(label) === norm(name)));
            if (matches.length !== 1) continue;
            const npc = matches[0];
            const locks = npc.manualProfileFields || [];
            if (!npc.id || npc.archived || isTerminalNpcDeath(npc) || locks.includes('present') || locks.includes('worldActive')) continue;
            present.add(npc.id);
        }
        return npcs.map(npc => present.has(npc.id) ? { ...npc, present: true, worldActive: false } : npc);
    } catch { return npcs; }
}
