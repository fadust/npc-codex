import { PORTRAYAL_REFERENCES } from './portrayal-references.js';
import { isTerminalNpcDeath } from './terminal-lifecycle.js';
export { PORTRAYAL_REFERENCES };
export function portrayalBasis(npc) {
    return JSON.stringify(['name', 'age', 'role', 'species', 'gender', 'appearance', 'background', 'customFields', 'keyRelationships', 'knowledge', 'relationship', 'canonLocked', 'personality', 'speech', 'behaviorProfile', 'mannerisms', 'relationshipSummary', 'canonRef', 'manualProfileFields']
        .map(key => [key, npc?.[key] ?? null]));
}
export function acceptPortrayal(npc, { reference, text }) {
    const entry = PORTRAYAL_REFERENCES.entries.find(e => String(e.uid) === String(reference));
    if (!entry || typeof text !== 'string' || !text.trim() || text.length > 600) throw new Error('Select a reference and approve at most 600 characters of portrayal guidance.');
    if (isTerminalNpcDeath(npc)) throw new Error('A deceased actor cannot receive an active portrayal guide.');
    return { reference: entry.uid, referenceRevision: PORTRAYAL_REFERENCES.revision,
        source: PORTRAYAL_REFERENCES.source, basis: portrayalBasis(npc), text: text.trim(), approval: 'manual', kind: 'portrayal-only' };
}
export function renderPortrayal(npc) {
    const guide = npc?.portrayal;
    if (!guide || isTerminalNpcDeath(npc) || guide.approval !== 'manual' || guide.kind !== 'portrayal-only'
        || guide.basis !== portrayalBasis(npc) || guide.referenceRevision !== PORTRAYAL_REFERENCES.revision
        || !PORTRAYAL_REFERENCES.entries.some(e => e.uid === guide.reference)) return '';
    return `PORTRAYAL ONLY (subordinate to accepted facts, knowledge, locks and current scene; establishes no events or new traits): ${String(guide.text).slice(0, 600)}`;
}
