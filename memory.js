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
        // Phase B: the shared event this episode is one witness's view of.
        ...(/^e\d+$/.test(String(raw.eventId || '')) ? { eventId: raw.eventId } : {}),
        ...(cleanText(raw.where, 80) ? { where: cleanText(raw.where, 80) } : {}),
        ...(Array.isArray(raw.witnesses) && raw.witnesses.length ? { witnesses: [...new Set(raw.witnesses.map(item => cleanText(item, LIMITS.with)).filter(Boolean))].slice(0, 8) } : {}),
        ...(cleanText(raw.toldBy, LIMITS.with) ? { toldBy: cleanText(raw.toldBy, LIMITS.with) } : {}),
        ...(raw.secret === true ? { secret: true } : {}),
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
    for (const raw of (Array.isArray(memory.intents) ? memory.intents : (Array.isArray(person?.intents) ? person.intents : [])).slice(0, 4)) {
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
    episodes = capEpisodes(episodes, turn);
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

// Over the cap: the lightest unpinned, non-defining episode goes first.
function capEpisodes(list, turn) {
    let episodes = list;
    while (episodes.length > EPISODE_LIMIT) {
        const candidates = episodes.filter(item => !item.pinned && item.level !== 'defining');
        if (!candidates.length) break;
        const lightest = candidates.reduce((low, item) => weight(item, turn) < weight(low, turn) ? item : low);
        episodes = episodes.filter(item => item !== lightest);
    }
    return episodes;
}

/* ---------- Phase B: shared event nodes, one view per witness, told-by ----------
 * An event node is the objective fact, identified by an eventId (e1, e2 ...) shared by every
 * witness's episode. Each witness keeps their own view (effect, level, fit). Nothing is stored
 * at chat level, so per-NPC rollback (swipe/delete/edit) keeps working unchanged. Gossip: when
 * someone present tells a listener about an event they hold, the listener gains a second-hand
 * episode (toldBy) and becomes a holder. */

export const EVENTS_PER_SCAN = 2;

function npcLabels(npc) {
    return [npc?.id, npc?.name, ...(Array.isArray(npc?.aliases) ? npc.aliases : [])].filter(Boolean).map(norm);
}

function findNpc(npcs, who) {
    const key = norm(who);
    return key ? (npcs || []).find(npc => npc && !npc.archived && npcLabels(npc).includes(key)) : null;
}

export function nextEventNumber(npcs) {
    let max = 0;
    for (const npc of npcs || []) for (const episode of npc?.episodes || []) max = Math.max(max, Number(String(episode?.eventId || '').slice(1)) || 0);
    return max + 1;
}

const TELLING = /\b(?:told|tells|tell|telling|informed|informs|reported|reports|recounted|recounts|mentioned|mentions|warned|warns|explained|explains|said that|says that)\b/i;

// The stored event a recounting refers to, and which of the people involved holds it.
function retoldEvent(what, npcs, people) {
    for (const who of people) {
        const teller = findNpc(npcs, who);
        for (const episode of teller?.episodes || []) {
            if (!episode?.eventId) continue;
            // A retelling paraphrases: three shared content words (names count) identify it.
            const stored = recallTokens(episode.event);
            let shared = 0;
            for (const word of recallTokens(what)) if (stored.has(word)) shared += 1;
            if (shared >= 3) return { eventId: episode.eventId, teller: teller.name };
        }
    }
    return null;
}

// Validates the cast pass's "events" and "told" against the exchange and who was present.
export function readEventDecisions(parsed, { transcript = '', present = [], npcs = [], userName = '' } = {}) {
    const rejected = [];
    const events = [];
    const told = [];
    const here = new Set(present.map(norm).filter(Boolean));
    const isUser = who => Boolean(userName) && norm(who) === norm(userName);
    const isHere = who => here.has(norm(who)) || isUser(who);
    const known = new Set((npcs || []).flatMap(npc => (npc?.episodes || []).map(episode => episode?.eventId)).filter(Boolean));
    for (const raw of (Array.isArray(parsed?.events) ? parsed.events : []).slice(0, 4)) {
        const op = String(raw?.op || 'add').toLowerCase() === 'update' ? 'update' : 'add';
        const what = cleanText(raw?.what ?? raw?.objective, LIMITS.event);
        if (!what) continue;
        if (!groundedIn(transcript, what, { minRatio: 0.5 })) { rejected.push(`event not in exchange: ${what}`); continue; }
        if (op === 'update' && !known.has(raw?.id)) { rejected.push('event update: unknown id'); continue; }
        if (op === 'add' && events.filter(item => item.op === 'add').length >= EVENTS_PER_SCAN) { rejected.push('over the per-turn event limit'); continue; }
        const witnesses = [...new Set((Array.isArray(raw?.witnesses) ? raw.witnesses : []).map(item => cleanText(item, LIMITS.with)).filter(isHere))];
        const views = [];
        for (const view of (Array.isArray(raw?.views) ? raw.views : []).slice(0, 8)) {
            const who = cleanText(view?.who, LIMITS.with);
            if (!who || isUser(who)) continue;
            // Witness gating: only someone present in this exchange can hold a first-hand view.
            if (!isHere(who)) { rejected.push(`view from someone absent: ${who}`); continue; }
            if (!witnesses.some(item => norm(item) === norm(who))) witnesses.push(who);
            views.push({
                who,
                effect: cleanText(view?.effect, LIMITS.effect),
                level: MEMORY_LEVELS.includes(view?.level) ? view.level : 'significant',
                ...(FITS.includes(view?.fit) ? { fit: view.fit } : {}),
            });
        }
        if (!views.length) { rejected.push(`event without a present NPC's view: ${what}`); continue; }
        // A "new" event that is someone recounting a stored event they hold is gossip: the
        // listeners join that event second-hand instead of getting a duplicate node.
        const retold = op === 'add' && TELLING.test(what) ? retoldEvent(what, npcs, [...witnesses, ...views.map(view => view.who)]) : null;
        if (retold) {
            for (const view of views) {
                const listener = findNpc(npcs, view.who);
                if (!listener || norm(listener.name) === norm(retold.teller)) continue;
                if ((listener.episodes || []).some(item => item.eventId === retold.eventId)) continue;
                told.push({ event: retold.eventId, by: retold.teller, to: view.who, effect: view.effect });
            }
            continue;
        }
        events.push({ op, ...(op === 'update' ? { id: raw.id } : {}), what, where: cleanText(raw?.where, 80), witnesses, secret: raw?.secret === true, views });
    }
    for (const raw of (Array.isArray(parsed?.told) ? parsed.told : []).slice(0, 4)) {
        const by = cleanText(raw?.by, LIMITS.with);
        const to = cleanText(raw?.to, LIMITS.with);
        if (!known.has(raw?.event)) { rejected.push('told: unknown event'); continue; }
        if (!isHere(by) || !isHere(to) || isUser(to)) { rejected.push(`told: ${by} -> ${to} not both present`); continue; }
        told.push({ event: raw.event, by, to, effect: cleanText(raw?.effect, LIMITS.effect) });
    }
    return { events, told, rejected };
}

// Applies validated events/told to the dossiers (after the merge, so new NPCs exist).
export function applyEventDecisions(npcs, decisions, { turn = null, sourceMessageId = null, userName = '' } = {}) {
    let list = Array.isArray(npcs) ? [...npcs] : [];
    const applied = [];
    const rejected = [];
    const stamp = { ...(Number.isInteger(turn) ? { turn } : {}), ...(Number.isInteger(sourceMessageId) ? { sourceMessageId } : {}) };
    const editable = npc => !(Array.isArray(npc?.manualProfileFields) && npc.manualProfileFields.includes('memories'));
    const replace = (npc, next) => { list = list.map(item => item === npc ? next : item); };
    let number = nextEventNumber(list);
    for (const event of decisions?.events || []) {
        const eventId = event.op === 'update' ? event.id : `e${number++}`;
        const witnesses = event.witnesses.map(who => findNpc(list, who)?.name || who);
        for (const view of event.views) {
            const npc = findNpc(list, view.who);
            if (!npc) { rejected.push(`unknown witness ${view.who}`); continue; }
            if (!editable(npc)) continue;
            const hidden = (Array.isArray(npc.knowledge) ? npc.knowledge : []).filter(entry => entry?.kind === 'unaware').map(entry => entry.fact);
            if (hidden.some(fact => groundedIn(event.what, fact, { minRatio: 0.6 }))) { rejected.push(`hidden from ${npc.name}`); continue; }
            let episodes = normalizeEpisodes(npc.episodes, npc.memories);
            const fields = {
                eventId, event: event.what, level: view.level, witnesses,
                ...(event.where ? { where: event.where } : {}),
                ...(event.secret ? { secret: true } : {}),
                ...(view.effect ? { effect: view.effect } : {}),
                ...(view.fit ? { fit: view.fit } : {}),
                ...stamp,
            };
            const existing = episodes.find(item => item.eventId === eventId)
                || (event.op === 'add' ? episodes.find(item => !item.eventId && sameEvent(item.event, event.what)) : null);
            episodes = existing
                ? episodes.map(item => item === existing ? normalizeEpisode({ ...item, ...fields, id: item.id, pinned: item.pinned }) : item)
                : [...episodes, normalizeEpisode({ ...fields, id: nextId(episodes, 'm') })];
            replace(npc, { ...npc, episodes: capEpisodes(episodes, turn) });
            applied.push({ npcId: npc.id, eventId });
        }
        // The objective fact is one node: an update reaches every holder, witness or told.
        if (event.op === 'update') {
            list = list.map(npc => (npc?.episodes || []).some(item => item.eventId === eventId)
                ? { ...npc, episodes: npc.episodes.map(item => item.eventId === eventId ? { ...item, event: event.what } : item) }
                : npc);
        }
    }
    for (const tell of decisions?.told || []) {
        const listener = findNpc(list, tell.to);
        if (!listener || !editable(listener)) continue;
        if ((listener.episodes || []).some(item => item.eventId === tell.event)) continue;
        const teller = findNpc(list, tell.by);
        const userTells = Boolean(userName) && norm(tell.by) === norm(userName);
        const source = (teller?.episodes || []).find(item => item.eventId === tell.event)
            || (userTells ? list.flatMap(npc => npc?.episodes || []).find(item => item.eventId === tell.event && (item.witnesses || []).some(who => norm(who) === norm(userName))) : null);
        if (!source) { rejected.push(`told: ${tell.by} does not hold ${tell.event}`); continue; }
        const episodes = normalizeEpisodes(listener.episodes, listener.memories);
        episodes.push(normalizeEpisode({
            id: nextId(episodes, 'm'),
            eventId: tell.event,
            event: source.event,
            ...(source.where ? { where: source.where } : {}),
            witnesses: source.witnesses,
            toldBy: teller?.name || tell.by,
            // Hearsay never lands harder than first-hand experience.
            level: source.level === 'defining' ? 'significant' : source.level,
            ...(tell.effect ? { effect: tell.effect } : {}),
            ...stamp,
        }));
        replace(listener, { ...listener, episodes: capEpisodes(episodes, turn) });
        applied.push({ npcId: listener.id, eventId: tell.event, toldBy: teller?.name || tell.by });
    }
    return { npcs: list, applied, rejected };
}

/* ---------- Prompt context and injection ---------- */

// For the cast pass: stored ids so the model can update instead of repeating.
export function memoryContext(npc, limit = 6, turn = null) {
    const episodes = normalizeEpisodes(npc?.episodes, npc?.memories)
        .sort((a, b) => weight(b, turn) - weight(a, turn)).slice(0, limit)
        .map(item => `${item.eventId || item.id} [${item.level}] ${item.event}${item.effect ? ` -> ${item.effect}` : ''}${item.toldBy ? ` (heard from ${item.toldBy})` : ''}`);
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

const RECALL_STOP = new Set(['that', 'this', 'with', 'from', 'have', 'they', 'them', 'their', 'there', 'what', 'when', 'were', 'been', 'into', 'about', 'would', 'could', 'just', 'then', 'than', 'your', 'said', 'says']);

function recallTokens(text) {
    return new Set(String(text || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 3 && !RECALL_STOP.has(word)));
}

// Relevance to the current scene: shared content words and people in the episode.
function relevance(episode, sceneTokens) {
    if (!sceneTokens.size) return 0;
    const words = recallTokens([episode.event, episode.effect, ...(episode.witnesses || []), ...(episode.with || []), episode.toldBy, episode.where].join(' '));
    let hits = 0;
    for (const word of words) if (sceneTokens.has(word)) hits += 1;
    return Math.min(hits, 4);
}

// Keyword recall (Qdrant joins in B2): defining/pinned always; the rest ranked by
// level x recency x relevance to the current scene. Effect first, event as faint backing.
export function renderMemoryInjection(npc, { turn = null, limit = 5, text = '', vector = null } = {}) {
    const episodes = normalizeEpisodes(npc?.episodes, npc?.memories);
    const scene = recallTokens(text);
    // Vector similarity (0..1, from Qdrant) adds to keyword relevance; keys match recall-index.js.
    const similar = item => (vector instanceof Map ? Number(vector.get(item.eventId || `${npc?.id}:${item.id}`)) || 0 : 0);
    const score = item => weight(item, turn) * (1 + relevance(item, scene) + 4 * similar(item));
    const defining = episodes.filter(item => item.level === 'defining' || item.pinned);
    const rest = episodes.filter(item => !defining.includes(item)).sort((a, b) => score(b) - score(a));
    const chosen = [...defining.slice(-3), ...rest].slice(0, Math.max(limit, Math.min(defining.length, 3)));
    const lines = chosen.map(item => {
        const when = relativeTime(turn, item.turn);
        const notes = [item.toldBy && `heard from ${item.toldBy}`, when, item.secret && 'keeps it secret'].filter(Boolean).join(', ');
        if (item.effect) return `${item.effect} (${item.event}${notes ? `; ${notes}` : ''})`;
        return `${item.event}${notes ? ` (${notes})` : ''}`;
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
