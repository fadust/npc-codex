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
