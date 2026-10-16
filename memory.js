/* NPC Codex: episodic memory and intentions (memory Phase A, fadust fork).
 *
 * An episode is something the NPC lived through, from THEIR viewpoint: the event plus its effect
 * on them (feeling, belief, stance). Levels are coarse on purpose (defining / significant / minor):
 * models rate everything 6-8 on a 1-10 scale. The cast pass returns operations against stored ids
 * (add / update / delete), so memories are revised instead of duplicated. Intentions are what the
 * NPC still means to do or has left unresolved.
 *
 * Gating: an NPC only gains an episode they witnessed (present in the exchange) and never one
 * built on a fact their knowledge ledger says they do not know.
 *
 * Pure module: no host, DOM or storage access. */

import { groundedIn } from './sheet.js';

export const MEMORY_LEVELS = Object.freeze(['defining', 'significant', 'minor']);
const LEVEL_WEIGHT = { defining: 3, significant: 2, minor: 1 };
const FITS = ['matches', 'contradicts'];
export const EPISODE_LIMIT = 40;
export const INTENTION_LIMIT = 8;
export const MEMORY_NEW_PER_SCAN = 2;
const LIMITS = { event: 220, effect: 160, what: 180, due: 60, with: 80 };

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

export function normalizeEpisode(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const event = cleanText(raw.event, LIMITS.event);
    if (!event) return null;
    const level = MEMORY_LEVELS.includes(raw.level) ? raw.level : 'significant';
    return {
        id: cleanText(raw.id, 12),
        event,
        ...(cleanText(raw.effect, LIMITS.effect) ? { effect: cleanText(raw.effect, LIMITS.effect) } : {}),
        level,
        ...(FITS.includes(raw.fit) ? { fit: raw.fit } : {}),
        ...(Array.isArray(raw.with) && raw.with.length ? { with: [...new Set(raw.with.map(item => cleanText(item, LIMITS.with)).filter(Boolean))].slice(0, 4) } : {}),
        ...(Number.isInteger(raw.turn) ? { turn: raw.turn } : {}),
        ...(Number.isInteger(raw.sourceMessageId) ? { sourceMessageId: raw.sourceMessageId } : {}),
        ...(raw.pinned === true ? { pinned: true } : {}),
    };
}

export function normalizeIntention(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const what = cleanText(raw.what, LIMITS.what);
    if (!what) return null;
    return {
        id: cleanText(raw.id, 12),
        what,
        ...(cleanText(raw.due, LIMITS.due) ? { due: cleanText(raw.due, LIMITS.due) } : {}),
        status: ['open', 'done', 'dropped'].includes(raw.status) ? raw.status : 'open',
        ...(Number.isInteger(raw.turn) ? { turn: raw.turn } : {}),
        ...(Number.isInteger(raw.closedTurn) ? { closedTurn: raw.closedTurn } : {}),
    };
}

function withIds(list, prefix) {
    const out = [];
    for (const item of list) {
        if (!item) continue;
        if (!item.id || out.some(other => other.id === item.id)) item.id = nextId(out, prefix);
        out.push(item);
    }
    return out;
}

// Older dossiers carry plain memory strings: they become significant episodes once.
export function normalizeEpisodes(raw, legacyMemories) {
    const source = Array.isArray(raw) && raw.length ? raw : (Array.isArray(legacyMemories) ? legacyMemories.map(text => ({ event: text })) : []);
    return withIds(source.map(normalizeEpisode), 'm').slice(-EPISODE_LIMIT);
}

export function normalizeIntentions(raw) {
    return withIds((Array.isArray(raw) ? raw : []).map(normalizeIntention), 'i').slice(-INTENTION_LIMIT * 2);
}

/* ---------- Reading and validating the cast pass ---------- */

// person.memory = {ops:[{op,id,event,effect,level,fit,with}], intents:[{op,id,what,due}]}
export function readMemoryDecision(person, { transcript = '', npc = null } = {}) {
    const memory = person?.memory && typeof person.memory === 'object' ? person.memory : {};
    const episodes = Array.isArray(npc?.episodes) ? npc.episodes : [];
    const intentions = Array.isArray(npc?.intentions) ? npc.intentions : [];
    const hidden = (Array.isArray(npc?.knowledge) ? npc.knowledge : []).filter(entry => entry?.kind === 'unaware').map(entry => entry.fact);
    const rejected = [];
    const ops = [];
    let added = 0;
    for (const raw of (Array.isArray(memory.ops) ? memory.ops : []).slice(0, 6)) {
        const op = String(raw?.op || 'add').toLowerCase();
        if (op === 'delete') {
            if (episodes.some(item => item.id === raw.id)) ops.push({ op, id: raw.id });
            else rejected.push('delete: unknown id');
            continue;
        }
        const episode = normalizeEpisode(raw);
        if (!episode) continue;
        if (!groundedIn(transcript, episode.event, { minRatio: 0.5 })) { rejected.push(`not in exchange: ${episode.event}`); continue; }
        if (hidden.some(fact => groundedIn(episode.event, fact, { minRatio: 0.6 }))) { rejected.push(`hidden from them: ${episode.event}`); continue; }
        if (op === 'update') {
            if (episodes.some(item => item.id === raw.id)) ops.push({ op, id: raw.id, episode });
            else rejected.push('update: unknown id');
            continue;
        }
        // Only witnesses gain new memories.
        if (person?.present !== true) { rejected.push(`not present: ${episode.event}`); continue; }
        if (added >= MEMORY_NEW_PER_SCAN) { rejected.push('over the per-turn limit'); continue; }
        added += 1;
        ops.push({ op: 'add', episode });
    }
    const intents = [];
    for (const raw of (Array.isArray(memory.intents) ? memory.intents : []).slice(0, 4)) {
        const op = String(raw?.op || 'add').toLowerCase();
        if (op === 'done' || op === 'drop') {
            if (intentions.some(item => item.id === raw.id && item.status === 'open')) intents.push({ op, id: raw.id });
            continue;
        }
        const intention = normalizeIntention(raw);
        if (intention && groundedIn(transcript, intention.what, { minRatio: 0.4 })) intents.push({ op: 'add', intention });
        else if (intention) rejected.push(`intention not in exchange: ${intention.what}`);
    }
    return { ops, intents, rejected };
}

/* ---------- Applying ---------- */

function weight(episode, turn) {
    const age = Number.isInteger(turn) && Number.isInteger(episode.turn) ? Math.max(0, turn - episode.turn) : 0;
    return (LEVEL_WEIGHT[episode.level] || 1) / (1 + age / 20);
}

function sameEvent(a, b) {
    return groundedIn(a, b, { minRatio: 0.75 }) && groundedIn(b, a, { minRatio: 0.75 });
}

export function applyMemoryDecision(npc, decision, { turn = null, sourceMessageId = null } = {}) {
    let episodes = normalizeEpisodes(npc?.episodes, npc?.memories);
    let intentions = normalizeIntentions(npc?.intentions);
    const stamp = { ...(Number.isInteger(turn) ? { turn } : {}), ...(Number.isInteger(sourceMessageId) ? { sourceMessageId } : {}) };
    let changed = 0;
    for (const op of decision?.ops || []) {
        if (op.op === 'delete') {
            const before = episodes.length;
            episodes = episodes.filter(item => item.id !== op.id || item.pinned);
            changed += before - episodes.length;
        } else if (op.op === 'update') {
            episodes = episodes.map(item => item.id === op.id ? { ...item, ...op.episode, id: item.id, ...(item.pinned ? { pinned: true } : {}), ...stamp } : item);
            changed += 1;
        } else if (!episodes.some(item => sameEvent(item.event, op.episode.event))) {
            episodes.push({ ...op.episode, id: nextId(episodes, 'm'), ...stamp });
            changed += 1;
        }
    }
    // Over the cap: the lightest unpinned, non-defining episode goes first.
    while (episodes.length > EPISODE_LIMIT) {
        const candidates = episodes.filter(item => !item.pinned && item.level !== 'defining');
        if (!candidates.length) break;
        const lightest = candidates.reduce((low, item) => weight(item, turn) < weight(low, turn) ? item : low);
        episodes = episodes.filter(item => item !== lightest);
    }
    for (const op of decision?.intents || []) {
        if (op.op === 'add') {
            if (intentions.some(item => item.status === 'open' && sameEvent(item.what, op.intention.what))) continue;
            intentions.push({ ...op.intention, id: nextId(intentions, 'i'), status: 'open', ...(Number.isInteger(turn) ? { turn } : {}) });
        } else {
            intentions = intentions.map(item => item.id === op.id ? { ...item, status: op.op === 'done' ? 'done' : 'dropped', ...(Number.isInteger(turn) ? { closedTurn: turn } : {}) } : item);
        }
        changed += 1;
    }
    const open = intentions.filter(item => item.status === 'open');
    intentions = [...intentions.filter(item => item.status !== 'open').slice(-INTENTION_LIMIT), ...open.slice(-INTENTION_LIMIT)];
    return { npc: { ...npc, episodes, intentions }, changed };
}

/* ---------- Prompt context and injection ---------- */

// For the cast pass: stored ids so the model can update instead of repeating.
export function memoryContext(npc, limit = 6, turn = null) {
    const episodes = normalizeEpisodes(npc?.episodes, npc?.memories)
        .sort((a, b) => weight(b, turn) - weight(a, turn)).slice(0, limit)
        .map(item => `${item.id} [${item.level}] ${item.event}${item.effect ? ` -> ${item.effect}` : ''}`);
    const intents = normalizeIntentions(npc?.intentions).filter(item => item.status === 'open').slice(-4)
        .map(item => `${item.id} ${item.what}${item.due ? ` (by ${item.due})` : ''}`);
    return { ...(episodes.length ? { memories: episodes } : {}), ...(intents.length ? { intents } : {}) };
}

export function relativeTime(turn, episodeTurn) {
    if (!Number.isInteger(turn) || !Number.isInteger(episodeTurn)) return '';
    const age = turn - episodeTurn;
    if (age <= 2) return 'just now';
    if (age <= 10) return 'recently';
    if (age <= 40) return 'a while ago';
    return 'long ago';
}

// Effect first, event as faint backing, relative time: material to act from, not to recite.
export function renderMemoryInjection(npc, { turn = null, limit = 5 } = {}) {
    const episodes = normalizeEpisodes(npc?.episodes, npc?.memories);
    const defining = episodes.filter(item => item.level === 'defining' || item.pinned);
    const rest = episodes.filter(item => !defining.includes(item)).sort((a, b) => weight(b, turn) - weight(a, turn));
    const chosen = [...defining.slice(-3), ...rest].slice(0, Math.max(limit, Math.min(defining.length, 3)));
    const lines = chosen.map(item => {
        const when = relativeTime(turn, item.turn);
        return item.effect ? `${item.effect} (${item.event}${when ? `, ${when}` : ''})` : `${item.event}${when ? ` (${when})` : ''}`;
    });
    const open = normalizeIntentions(npc?.intentions).filter(item => item.status === 'open').slice(-3)
        .map(item => `${item.what}${item.due ? ` (by ${item.due})` : ''}`);
    const parts = [];
    if (lines.length) parts.push(`lived memories (let them colour behaviour; never recite): ${lines.join(' | ')}`);
    if (open.length) parts.push(`still means to / unresolved: ${open.join(' | ')}`);
    return parts.join('; ');
}

/* ---------- Editor ---------- */

export function episodesToEditorText(npc) {
    return normalizeEpisodes(npc?.episodes, npc?.memories)
        .map(item => `${item.pinned ? '* ' : ''}${item.level}: ${item.event}${item.effect ? ` => ${item.effect}` : ''}`).join('\n');
}

// "level: event => effect"; a leading "*" pins. Lines matching a stored event keep their id/turn.
export function episodesFromEditorText(text, previous = []) {
    const prior = normalizeEpisodes(previous);
    return withIds(String(text || '').split(/\r?\n/).map(line => {
        let body = line.trim();
        if (!body) return null;
        const pinned = body.startsWith('*');
        if (pinned) body = body.slice(1).trim();
        const match = body.match(/^(defining|significant|minor)\s*:\s*(.*)$/i);
        const level = match ? match[1].toLowerCase() : 'significant';
        const [event, effect = ''] = (match ? match[2] : body).split(/\s*=>\s*/);
        const old = prior.find(item => norm(item.event) === norm(event));
        return normalizeEpisode({ ...(old || {}), event, effect, level, pinned });
    }), 'm');
}

export function intentionsToEditorText(npc) {
    return normalizeIntentions(npc?.intentions).filter(item => item.status === 'open')
        .map(item => `${item.what}${item.due ? ` | ${item.due}` : ''}`).join('\n');
}

export function intentionsFromEditorText(text, previous = []) {
    const prior = normalizeIntentions(previous);
    const closed = prior.filter(item => item.status !== 'open');
    const open = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
        const [what, due = ''] = line.split(/\s*\|\s*/);
        const old = prior.find(item => item.status === 'open' && norm(item.what) === norm(what));
        return normalizeIntention({ ...(old || {}), what, due, status: 'open' });
    });
    return withIds([...closed, ...open], 'i');
}
