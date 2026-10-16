/* NPC Codex: relationship through temperament (S2.9) and NPC-to-NPC stances (fadust fork).
 *
 * The same relationship reads differently through different temperaments: a calm NPC at deep
 * dislike turns cold and clipped, a fiery one confronts. Code detects the temperament from the
 * dossier (personality + behaviour levers) and the stance band from the numbers, and injects the
 * concrete expression, so the roleplay model does not fall back to generic hostility or warmth.
 *
 * NPC-to-NPC stances: each NPC keeps {trust, affection, tension, note} toward other NPCs, moved in
 * small steps by the cast pass when two NPCs interact on-page. Only stances toward others in the
 * scene are injected.
 *
 * Pure module: no host, DOM or storage access. */

// Ordered: the first family with the most matches wins.
const TEMPERAMENTS = [
    ['fiery', /\b(hot-?tempered|fiery|volatile|impulsive|brash|quick to anger|explosive|hot-?headed|passionate|fierce)\b/gi],
    ['timid', /\b(shy|timid|anxious|nervous|meek|skittish|soft-?spoken|insecure)\b/gi],
    ['proud', /\b(proud|haughty|arrogant|formal|dignified|aloof|imperious|stern|cold)\b/gi],
    ['playful', /\b(playful|teasing|cheerful|mischievous|witty|jovial|bubbly|cheeky|flirtatious)\b/gi],
    ['calm', /\b(calm|measured|reserved|stoic|composed|quiet|level-?headed|patient|serene|controlled|dry)\b/gi],
    ['warm', /\b(kind|gentle|warm|nurturing|caring|compassionate|sweet|motherly|fatherly|soft-?hearted)\b/gi],
];

const EXPRESSION = {
    calm: { hostile: 'cold, clipped, controlled distance; never loud', wary: 'polite but closed; watches before answering', warm: 'quiet steadiness and small attentive gestures', devoted: 'steady unspoken loyalty; calm protectiveness' },
    fiery: { hostile: 'sharp open anger; quick to confront', wary: 'short fuse; tests and challenges them', warm: 'loud enthusiasm and blunt teasing', devoted: 'fierce protectiveness; quick to fight for them' },
    warm: { hostile: 'hurt more than angry; withdraws warmth', wary: 'kind but careful; holds back trust', warm: 'open warmth and easy care', devoted: 'tender; puts them first' },
    playful: { hostile: 'barbed jokes and mockery', wary: 'deflects with humour; keeps it light', warm: 'teasing and inside jokes', devoted: 'affectionate teasing; lights up around them' },
    proud: { hostile: 'icy disdain; formal contempt', wary: 'formal; keeps rank and distance', warm: 'dignified approval; rare praise', devoted: 'proud loyalty; defends their honour' },
    timid: { hostile: 'avoids them; nervous and curt', wary: 'hesitant; keeps distance', warm: 'shy warmth; small brave gestures', devoted: 'quietly brave for them' },
};

export function temperamentOf(npc) {
    const text = [npc?.personality, ...(Array.isArray(npc?.behaviorProfile) ? npc.behaviorProfile : [])].filter(Boolean).join(' ');
    if (!text) return '';
    let best = '';
    let bestCount = 0;
    for (const [name, pattern] of TEMPERAMENTS) {
        const count = (text.match(pattern) || []).length;
        if (count > bestCount) { best = name; bestCount = count; }
    }
    return best;
}

export function stanceBand(rel = {}) {
    const trust = Number(rel.trust) || 0;
    const affection = Number(rel.affection) || 0;
    const tension = Number(rel.tension) || 0;
    if (affection <= -40 || (trust <= -40 && tension >= 40)) return 'hostile';
    if (affection >= 70 && trust >= 60) return 'devoted';
    if (affection >= 30 && tension < 50) return 'warm';
    if (trust <= -15 || tension >= 30 || affection <= -15) return 'wary';
    return 'neutral';
}

// "calm temperament, dislike: cold, clipped, controlled distance; never loud", or ''.
export function temperamentExpression(npc, rel) {
    const temperament = temperamentOf(npc);
    const band = stanceBand(rel);
    const phrase = EXPRESSION[temperament]?.[band];
    return phrase ? `through a ${temperament} temperament this shows as ${phrase}` : '';
}

/* ---------- NPC-to-NPC stances ---------- */

export const STANCE_LIMIT = 12;
const STEP = 8;
const AXES = ['trust', 'affection', 'tension'];

function cleanText(value, max) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function norm(value) {
    return cleanText(value, 200).toLowerCase();
}

function clamp(value) {
    return Math.max(-100, Math.min(100, Math.round(Number(value) || 0)));
}

export function normalizeStances(raw) {
    const out = [];
    for (const item of Array.isArray(raw) ? raw : []) {
        const toward = cleanText(item?.toward, 120);
        if (!toward || out.some(other => norm(other.toward) === norm(toward))) continue;
        out.push({
            toward,
            ...Object.fromEntries(AXES.map(axis => [axis, clamp(item?.[axis])])),
            ...(cleanText(item?.note, 140) ? { note: cleanText(item.note, 140) } : {}),
            ...(Number.isInteger(item?.turn) ? { turn: item.turn } : {}),
        });
    }
    return out.slice(-STANCE_LIMIT);
}

// From the cast pass: person.stances=[{toward, trust, affection, tension (-2..2), note}].
// Both must be present in the exchange; never toward the player (that is the main relationship).
export function readStanceDecisions(who, raw, { present = [], userName = '' } = {}) {
    const here = new Set(present.map(norm));
    const out = [];
    for (const item of (Array.isArray(raw) ? raw : []).slice(0, 3)) {
        const toward = cleanText(item?.toward, 120);
        if (!toward || norm(toward) === norm(who) || (userName && norm(toward) === norm(userName))) continue;
        if (!here.has(norm(toward)) || !here.has(norm(who))) continue;
        const deltas = Object.fromEntries(AXES.map(axis => [axis, Math.max(-2, Math.min(2, Math.round(Number(item?.[axis]) || 0)))]));
        const note = cleanText(item?.note, 140);
        if (!AXES.some(axis => deltas[axis]) && !note) continue;
        out.push({ who, toward, ...deltas, ...(note ? { note } : {}) });
    }
    return out;
}

function findNpc(npcs, label) {
    const key = norm(label);
    return (npcs || []).find(npc => npc && !npc.archived && [npc.id, npc.name, ...(npc.aliases || [])].some(item => norm(item) === key));
}

export function applyStanceDecisions(npcs, decisions, { turn = null } = {}) {
    let list = Array.isArray(npcs) ? [...npcs] : [];
    let applied = 0;
    for (const decision of decisions || []) {
        const npc = findNpc(list, decision.who);
        const other = findNpc(list, decision.toward);
        if (!npc || !other || npc === other) continue;
        const stances = normalizeStances(npc.stances);
        const current = stances.find(item => norm(item.toward) === norm(other.name)) || { toward: other.name, trust: 0, affection: 0, tension: 0 };
        const next = {
            ...current,
            toward: other.name,
            ...Object.fromEntries(AXES.map(axis => [axis, clamp(current[axis] + STEP * (decision[axis] || 0))])),
            ...(decision.note ? { note: decision.note } : {}),
            ...(Number.isInteger(turn) ? { turn } : {}),
        };
        const updated = [...stances.filter(item => item !== current), next];
        list = list.map(item => item === npc ? { ...npc, stances: normalizeStances(updated) } : item);
        applied += 1;
    }
    return { npcs: list, applied };
}

const BAND_WORD = { hostile: 'hostile', wary: 'wary', neutral: 'neutral', warm: 'warm', devoted: 'devoted' };

// Stances toward the other people in this scene, read through the NPC's temperament.
export function renderStanceInjection(npc, { presentNames = [] } = {}) {
    const here = new Set(presentNames.map(norm));
    const lines = normalizeStances(npc?.stances)
        .filter(item => here.has(norm(item.toward)))
        .slice(-3)
        .map(item => {
            const band = stanceBand(item);
            const expression = EXPRESSION[temperamentOf(npc)]?.[band];
            // A first small shift stays in the neutral band: then the note alone says it.
            const label = band === 'neutral' && item.note ? item.note : `${BAND_WORD[band]}${item.note ? ` (${item.note})` : ''}`;
            return `${item.toward}: ${label}${expression ? `, shows as ${expression}` : ''}`;
        });
    return lines.length ? `toward others here: ${lines.join(' | ')}` : '';
}

export function stancesForView(npc) {
    return normalizeStances(npc?.stances).map(item => `${item.toward}: ${BAND_WORD[stanceBand(item)]} (trust ${item.trust}, affection ${item.affection}, tension ${item.tension})${item.note ? ` - ${item.note}` : ''}`);
}
