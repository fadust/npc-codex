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
// Conservative clause matching; unfamiliar guidance stays intact for review.
function additionalPortrayal(npc, text) {
    const normalize = value => String(value || '').toLowerCase().replace(/['’]/g, '').replace(/\bspeaks\b/g, 'speak').replace(/\bpauses\b/g, 'pause').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    const cues = presentationDetails(npc);
    const accepted = [npc.speech, ...(npc.mannerisms || []), ...cues.impression, ...cues.bearing, ...physicalDescription(npc.appearance).split(/[.;]/)].map(normalize).filter(fact => !/\b(not|never|avoid|dont)\b/.test(fact));
    const clauses = String(text || '').split(/[.;]/).map(value => value.trim()).filter(Boolean);
    const remaining = clauses.filter(clause => !accepted.some(fact => ` ${fact} `.includes(` ${normalize(clause)} `)));
    return remaining.length === clauses.length ? String(text || '') : remaining.join('; ');
}
export function renderPortrayal(npc) {
    const guide = npc?.portrayal;
    if (!guide || isTerminalNpcDeath(npc) || guide.approval !== 'manual' || guide.kind !== 'portrayal-only'
        || guide.basis !== portrayalBasis(npc) || guide.referenceRevision !== PORTRAYAL_REFERENCES.revision
        || !PORTRAYAL_REFERENCES.entries.some(e => e.uid === guide.reference)) return '';
    const extra = additionalPortrayal(npc, guide.text);
    if (!extra) return '';
    return `PORTRAYAL ONLY (subordinate to accepted facts, knowledge, locks and current scene; establishes no events or new traits; never dictate other characters' feelings or reactions): ${extra.slice(0, 600)}`;
}

// These are quoted accepted cues, not a generated judgment about personality or intent.
function presentationCue(raw = '') {
    const clause = String(raw).trim();
    const labeled = clause.match(/^(overall impression|impression|presence|bearing|demeanou?r)\s*:\s*(.+)$/i);
    const value = labeled ? labeled[2].trim() : clause;
    // Mixed physical descriptions remain in Appearance rather than being repeated here.
    if (/\b(hair|eyes?|skin|complexion|beard|moustache|mustache|outfit|coat|cloak|dress|shirt|boots?|robes?|armou?r|clothing|jewel\w*|earrings?|height|tall|muscular|slender)\b/i.test(value)) return null;
    if (labeled) return { kind: /bearing|demean/i.test(labeled[1]) ? 'bearing' : 'impression', value };
    if (/\b(comes across as|air of|impression of|presence feels|quietly imposing|effortlessly elegant|weathered yet dignified)\b/i.test(value)) return { kind: 'impression', value };
    if (/\b(posture|gait|poise|bearing|stands? (?:upright|erect|relaxed)|carries (?:himself|herself|themselves)|moves? with (?:measured|quiet|relaxed|deliberate|easy))\b/i.test(value)) return { kind: 'bearing', value };
    return null;
}

export function presentationDetails(npc = {}) {
    const result = { impression: [], bearing: [] };
    const clauses = String(npc.appearance || '').split(/;|\n/);
    // Accepted mannerisms may describe visible carriage; personality and mood are not substitutes.
    for (const raw of [...clauses, ...(Array.isArray(npc.mannerisms) ? npc.mannerisms : [])]) {
        const cue = presentationCue(raw);
        if (cue && cue.value && result[cue.kind].length < 3 && !result[cue.kind].includes(cue.value)) result[cue.kind].push(cue.value);
    }
    return result;
}

export function physicalDescription(text = '') {
    const clauses = String(text).split(/;|\n/);
    const physical = clauses.filter(clause => !presentationCue(clause));
    return physical.length === clauses.length ? String(text) : physical.map(clause => clause.trim()).filter(Boolean).join('; ');
}


// One optional actor-prompt line; bearing already supplied by essential mannerisms stays there.
export function renderActorPresence(npc) {
    if (isTerminalNpcDeath(npc) || !npc.present || npc.archived) return '';
    const cues = presentationDetails(npc);
    const norm = value => String(value || '').toLowerCase().replace(/[.;]+$/g, '').trim();
    const represented = new Set((npc.mannerisms || []).map(norm));
    const impression = cues.impression.filter(value => !represented.has(norm(value)));
    const bearing = cues.bearing.filter(value => !represented.has(norm(value)));
    if (!impression.length && !bearing.length && !cues.bearing.length) return '';
    const parts = [impression.length && `impression: ${impression.join('; ')}`, bearing.length && `bearing: ${bearing.join('; ')}`].filter(Boolean);
    return `PRESENCE (portrayal cues, not personality or intent; express through this actor's posture, movement and delivery; never dictate another character's feelings or reactions): ${parts.join(' | ') || 'bearing is in established mannerisms'}`;
}
