/* NPC Codex: reflection (memory Phase C, fadust fork).
 *
 * Every so often, one NPC's accumulated episodes are distilled into BELIEFS ("Kai keeps his word
 * under pressure", about a person or the world) and into LIKES / DISLIKES. This is the
 * "compression into impressions" step: a belief stands for many episodes, and reflected minor
 * episodes then only surface when the scene calls for them. One extra model call, rarely: only
 * when an NPC has gathered REFLECT_MIN_NEW unreflected episodes, one NPC per scan.
 *
 * Every belief must cite episodes the NPC actually holds (witness gating carries over), and must
 * be about someone in those episodes (or the world). Likes/dislikes must be grounded in the
 * NPC's own memories or established personality/background.
 *
 * Pure module: no host, DOM or storage access. */

import { groundedIn } from './sheet.js';

export const REFLECTION_SYSTEM_PROMPT = "You are NPC Codex's isolated reflection step. Use only the supplied memories and traits. Return only the requested JSON object.";
export const REFLECT_MIN_NEW = 4;
export const BELIEF_LIMIT = 8;
export const PREFERENCE_LIMIT = 8;
const LIMITS = { about: 80, belief: 180, preference: 80 };

function cleanText(value, max) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (/^(?:unknown|not stated|none|n\/?a|null|-+)$/i.test(text)) return '';
    return text.slice(0, max);
}

function norm(value) {
    return cleanText(value, 400).toLowerCase();
}

function nextId(list, prefix) {
    const max = list.reduce((top, item) => Math.max(top, Number(String(item?.id || '').slice(prefix.length)) || 0), 0);
    return `${prefix}${max + 1}`;
}

/* ---------- Records ---------- */

export function normalizeBeliefs(raw) {
    const out = [];
    for (const item of Array.isArray(raw) ? raw : []) {
        const belief = cleanText(item?.belief, LIMITS.belief);
        if (!belief) continue;
        const entry = {
            id: /^b\d+$/.test(String(item?.id || '')) && !out.some(other => other.id === item.id) ? item.id : '',
            about: cleanText(item?.about, LIMITS.about) || 'world',
            belief,
            basis: [...new Set((Array.isArray(item?.basis) ? item.basis : []).map(id => cleanText(id, 16)).filter(Boolean))].slice(0, 8),
            ...(Number.isInteger(item?.turn) ? { turn: item.turn } : {}),
        };
        if (!entry.id) entry.id = nextId(out, 'b');
        out.push(entry);
    }
    return out.slice(-BELIEF_LIMIT);
}

export function normalizePreferences(raw) {
    const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(/[;\n]/) : []);
    const out = [];
    for (const item of list) {
        const text = cleanText(item, LIMITS.preference);
        if (text && !out.some(other => norm(other) === norm(text))) out.push(text);
    }
    return out.slice(-PREFERENCE_LIMIT);
}

/* ---------- When and whom ---------- */

function unreflected(npc) {
    return (Array.isArray(npc?.episodes) ? npc.episodes : []).filter(item => item && item.event && item.reflected !== true);
}

// The NPC most in need of reflection, or null. Locked memories are the player's.
export function reflectionTarget(npcs) {
    let best = null;
    for (const npc of Array.isArray(npcs) ? npcs : []) {
        if (!npc || npc.archived) continue;
        if (Array.isArray(npc.manualProfileFields) && npc.manualProfileFields.includes('memories')) continue;
        const count = unreflected(npc).length;
        if (count >= REFLECT_MIN_NEW && (!best || count > best.count)) best = { npc, count };
    }
    return best?.npc || null;
}

/* ---------- Request ---------- */

export function buildReflectionPrompt(npc, { userName = 'User' } = {}) {
    const episodes = (Array.isArray(npc?.episodes) ? npc.episodes : []).filter(item => item?.event).slice(-16)
        .map(item => `${item.id} [${item.level || 'significant'}${item.toldBy ? `, heard from ${item.toldBy}` : ''}] ${item.event}${item.effect ? ` -> ${item.effect}` : ''}`);
    const beliefs = normalizeBeliefs(npc?.beliefs).map(item => `${item.id} about ${item.about}: ${item.belief}`);
    return `Private reflection for ${npc?.name}.
From THEIR memories below, distil what they have come to believe and what they like or dislike. A belief is a lasting conclusion drawn from several memories (or one defining one) about a person (including ${userName}) or about the world, in their own outlook: "Kai keeps his word under pressure", "the Guild cannot be trusted". Not a restatement of one event. Revise their existing beliefs instead of repeating them: "update" an id when memories change it, "drop" one the memories now contradict.
Likes/dislikes: lasting preferences their memories or traits show (people, things, places, habits). Short phrases.
Personality: ${cleanText(npc?.personality, 280) || 'not established'}
Background: ${cleanText(npc?.background, 320) || 'not established'}
Current likes: ${normalizePreferences(npc?.likes).join('; ') || 'none'} | dislikes: ${normalizePreferences(npc?.dislikes).join('; ') || 'none'}
EXISTING BELIEFS:
${beliefs.join('\n') || 'none'}
MEMORIES (id [level] event -> effect):
${episodes.join('\n')}
JSON only: {"beliefs":[{"op":"add|update|drop","id":"","about":"","belief":"","basis":["memory ids"]}],"likes":[],"dislikes":[]}. Max 2 new beliefs, 3 likes, 3 dislikes. Empty arrays when nothing new.`;
}

/* ---------- Validation and applying ---------- */

// Returns { npc, added, updated, dropped, rejected[] }. Marks the episodes shown as reflected.
export function applyReflection(npc, parsed, { turn = null, userName = '' } = {}) {
    const rejected = [];
    const episodes = Array.isArray(npc?.episodes) ? npc.episodes : [];
    const shown = episodes.filter(item => item?.event).slice(-16);
    const byId = new Map();
    for (const item of episodes) { if (item?.id) byId.set(item.id, item); if (item?.eventId) byId.set(item.eventId, item); }
    const people = new Set([norm(userName), 'world'].filter(Boolean));
    for (const item of episodes) for (const who of [...(item.witnesses || []), ...(item.with || []), item.toldBy]) if (who) people.add(norm(who));
    const memoryText = [...episodes.map(item => `${item.event} ${item.effect || ''}`), npc?.personality, npc?.background].join(' ');
    let beliefs = normalizeBeliefs(npc?.beliefs);
    let added = 0;
    let updated = 0;
    let dropped = 0;
    for (const raw of (Array.isArray(parsed?.beliefs) ? parsed.beliefs : []).slice(0, 6)) {
        const op = String(raw?.op || 'add').toLowerCase();
        if (op === 'drop') {
            const before = beliefs.length;
            beliefs = beliefs.filter(item => item.id !== raw?.id);
            dropped += before - beliefs.length;
            continue;
        }
        const belief = cleanText(raw?.belief, LIMITS.belief);
        const about = cleanText(raw?.about, LIMITS.about) || 'world';
        const basis = [...new Set((Array.isArray(raw?.basis) ? raw.basis : []).map(id => cleanText(id, 16)).filter(id => byId.has(id)))];
        if (!belief) continue;
        const defining = basis.some(id => byId.get(id)?.level === 'defining');
        if (basis.length < (defining ? 1 : 2)) { rejected.push(`belief without enough memories: ${belief}`); continue; }
        // About someone in those memories (or the world): no beliefs about strangers.
        const aboutKey = norm(about);
        const aboutKnown = people.has(aboutKey) || [...people].some(person => person && (person.includes(aboutKey) || aboutKey.includes(person)))
            || basis.some(id => norm(byId.get(id)?.event).includes(aboutKey));
        if (!aboutKnown) { rejected.push(`belief about someone not in their memories: ${about}`); continue; }
        if (op === 'update' && beliefs.some(item => item.id === raw?.id)) {
            beliefs = beliefs.map(item => item.id === raw.id ? { ...item, about, belief, basis, ...(Number.isInteger(turn) ? { turn } : {}) } : item);
            updated += 1;
            continue;
        }
        if (beliefs.some(item => groundedIn(item.belief, belief, { minRatio: 0.75 }))) continue;
        if (added >= 2) continue;
        beliefs.push({ id: nextId(beliefs, 'b'), about, belief, basis, ...(Number.isInteger(turn) ? { turn } : {}) });
        added += 1;
    }
    const preferences = (key, current) => {
        const kept = normalizePreferences(current);
        for (const item of normalizePreferences(parsed?.[key]).slice(0, 3)) {
            if (!groundedIn(memoryText, item, { minRatio: 0.5 })) { rejected.push(`${key} not in their memories or traits: ${item}`); continue; }
            if (!kept.some(other => norm(other) === norm(item))) kept.push(item);
        }
        return kept.slice(-PREFERENCE_LIMIT);
    };
    const shownIds = new Set(shown.map(item => item.id));
    const next = {
        ...npc,
        beliefs: beliefs.slice(-BELIEF_LIMIT),
        likes: preferences('likes', npc?.likes),
        dislikes: preferences('dislikes', npc?.dislikes),
        episodes: episodes.map(item => shownIds.has(item?.id) ? { ...item, reflected: true } : item),
        ...(Number.isInteger(turn) ? { lastReflectionTurn: turn } : {}),
    };
    return { npc: next, added, updated, dropped, rejected };
}

/* ---------- Injection and editor ---------- */

// Beliefs about people in the scene first; preferences always (they are short and timeless).
export function renderReflectionInjection(npc, { text = '' } = {}) {
    const scene = norm(text);
    const beliefs = normalizeBeliefs(npc?.beliefs)
        .map(item => ({ item, here: item.about !== 'world' && scene.includes(norm(item.about)) }))
        .sort((a, b) => Number(b.here) - Number(a.here))
        .slice(0, 3)
        .map(({ item }) => (item.about === 'world' ? item.belief : `about ${item.about}: ${item.belief}`));
    const likes = normalizePreferences(npc?.likes);
    const dislikes = normalizePreferences(npc?.dislikes);
    return [
        beliefs.length && `has come to believe: ${beliefs.join(' | ')}`,
        likes.length && `likes: ${likes.join(', ')}`,
        dislikes.length && `dislikes: ${dislikes.join(', ')}`,
    ].filter(Boolean).join('; ');
}

export function beliefsToEditorText(npc) {
    return normalizeBeliefs(npc?.beliefs).map(item => `${item.about}: ${item.belief}`).join('\n');
}

export function beliefsFromEditorText(text, previous = []) {
    const prior = normalizeBeliefs(previous);
    return normalizeBeliefs(String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
        const index = line.indexOf(':');
        const about = index > 0 ? line.slice(0, index).trim() : 'world';
        const belief = index > 0 ? line.slice(index + 1).trim() : line;
        const old = prior.find(item => norm(item.belief) === norm(belief));
        return { ...(old || {}), about, belief };
    }));
}
