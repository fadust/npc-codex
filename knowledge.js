/* NPC State Delta: per-NPC knowledge ledger and information gating (fadust fork).
 *
 * Each dossier carries `knowledge`: what this NPC knows, which of those facts it keeps secret,
 * and which facts it explicitly does NOT know. A fact lives only on the NPC that holds it; an NPC
 * a fact is hidden from gets an `unaware` entry instead, and the injection renders a hard gate so
 * the roleplay model cannot let that NPC act on it.
 *
 * Pure module: no host, DOM or storage access. */

export const KNOWLEDGE_KINDS = Object.freeze(['knows', 'secret', 'unaware']);
export const KNOWLEDGE_SOURCES = Object.freeze(['witnessed', 'told', 'canon', 'deduced', '']);
export const KNOWLEDGE_LIMIT = 12;
export const KNOWLEDGE_NEW_PER_SCAN = 3;
export const KNOWLEDGE_FACT_MAX = 220;
const SIMILARITY = 0.6;

function cleanText(value, max) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeKind(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (KNOWLEDGE_KINDS.includes(raw)) return raw;
    if (['secret', 'hidden', 'conceals', 'conceal', 'never_reveal', 'never reveals', 'keeps_secret'].includes(raw)) return 'secret';
    if (['unaware', 'unknown', 'does_not_know', 'doesnt_know', 'not_known', 'hidden_from', 'ignorant'].includes(raw)) return 'unaware';
    return 'knows';
}

function normalizeSource(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (KNOWLEDGE_SOURCES.includes(raw)) return raw;
    if (['saw', 'seen', 'present', 'witness', 'experienced'].includes(raw)) return 'witnessed';
    if (['told_by', 'heard', 'confided', 'informed'].includes(raw)) return 'told';
    if (['lore', 'lorebook'].includes(raw)) return 'canon';
    if (['inferred', 'guessed', 'suspects'].includes(raw)) return 'deduced';
    return '';
}

function tokens(text) {
    return new Set(String(text || '').toLowerCase().normalize('NFKC')
        .split(/[^\p{L}\p{N}]+/u)
        .filter(token => token.length > 2 && !STOP.has(token)));
}

const STOP = new Set(['the', 'and', 'that', 'this', 'with', 'from', 'for', 'was', 'were', 'has', 'have', 'had', 'her', 'his',
    'him', 'she', 'they', 'them', 'their', 'not', 'but', 'are', 'its', 'into', 'about', 'who', 'what', 'when', 'will', 'would',
    'must', 'never', 'know', 'knows', 'does', 'did']);

export function factSimilarity(a, b) {
    const left = tokens(a), right = tokens(b);
    if (!left.size || !right.size) return 0;
    let shared = 0;
    for (const token of left) if (right.has(token)) shared++;
    return shared / Math.min(left.size, right.size);
}

export function normalizeKnowledgeEntry(raw) {
    if (typeof raw === 'string') raw = { fact: raw };
    if (!raw || typeof raw !== 'object') return null;
    const fact = cleanText(raw.fact ?? raw.text ?? raw.value, KNOWLEDGE_FACT_MAX);
    if (!fact) return null;
    const entry = { fact, kind: normalizeKind(raw.kind ?? raw.stance ?? raw.type) };
    // How a fact was learned means nothing for an NPC who does not know it.
    if (entry.kind !== 'unaware') {
        const source = normalizeSource(raw.source ?? raw.how);
        if (source) entry.source = source;
        const from = cleanText(raw.from ?? raw.toldBy ?? raw.told_by, 120);
        if (from) entry.from = from;
    }
    if (Number.isInteger(raw.sourceMessageId)) entry.sourceMessageId = raw.sourceMessageId;
    if (Number.isInteger(raw.turn)) entry.turn = raw.turn;
    return entry;
}

// Scanner payloads may use `knowledge`, or separate `knows`/`secrets`/`unaware` arrays.
export function readScanKnowledge(raw = {}) {
    const out = [];
    const push = (list, kind) => {
        for (const item of Array.isArray(list) ? list : []) {
            const entry = normalizeKnowledgeEntry(kind && typeof item === 'string' ? { fact: item, kind } : (kind ? { ...item, kind: item?.kind ?? kind } : item));
            if (entry) out.push(entry);
        }
    };
    push(raw.knowledge, null);
    push(raw.knows, 'knows');
    push(raw.secrets, 'secret');
    push(raw.unaware ?? raw.doesNotKnow ?? raw.does_not_know, 'unaware');
    return dedupe(out).slice(0, KNOWLEDGE_NEW_PER_SCAN * 2);
}

function dedupe(list) {
    const out = [];
    for (const entry of list) {
        const index = out.findIndex(item => factSimilarity(item.fact, entry.fact) >= SIMILARITY);
        if (index < 0) out.push(entry);
        else out[index] = resolveSameFact(out[index], entry);
    }
    return out;
}

// Two records of the same fact: a secret stays a secret when re-observed as plain knowledge, and an
// NPC that was unaware and later learns it (knows/secret) moves out of `unaware`. A later `unaware`
// never erases knowledge the NPC already has: forgetting is not modelled.
function resolveSameFact(existing, incoming) {
    if (existing.kind === 'secret' && incoming.kind === 'knows') return { ...existing, ...pickMeta(incoming, existing) };
    if (existing.kind !== 'unaware' && incoming.kind === 'unaware') return existing;
    return { ...existing, ...incoming };
}

function pickMeta(incoming, existing) {
    return { source: existing.source || incoming.source, from: existing.from || incoming.from };
}

function trimToLimit(list) {
    if (list.length <= KNOWLEDGE_LIMIT) return list;
    // Plain knowledge is the cheapest to lose; secrets and unaware gates are the point of the ledger.
    const out = list.slice();
    while (out.length > KNOWLEDGE_LIMIT) {
        const index = out.findIndex(item => item.kind === 'knows');
        out.splice(index >= 0 ? index : 0, 1);
    }
    return out;
}

export function normalizeKnowledge(value) {
    const list = (Array.isArray(value) ? value : []).map(normalizeKnowledgeEntry).filter(Boolean);
    return trimToLimit(dedupe(list));
}

export function mergeKnowledge(existing, incoming, { sourceMessageId = null, turn = null } = {}) {
    const stamped = (Array.isArray(incoming) ? incoming : []).slice(0, KNOWLEDGE_NEW_PER_SCAN * 2).map(entry => {
        const next = normalizeKnowledgeEntry(entry);
        if (!next) return null;
        if (Number.isInteger(sourceMessageId) && !Number.isInteger(next.sourceMessageId)) next.sourceMessageId = sourceMessageId;
        if (Number.isInteger(turn) && !Number.isInteger(next.turn)) next.turn = turn;
        return next;
    }).filter(Boolean);
    return normalizeKnowledge([...(Array.isArray(existing) ? existing : []), ...stamped]);
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labelsOf(npc) {
    const names = [npc?.name, ...(Array.isArray(npc?.aliases) ? npc.aliases : [])].map(value => cleanText(value, 120)).filter(Boolean);
    // A first name alone ("Sera" for "Sera Vantrell") is how prose usually refers to someone.
    for (const name of names.slice()) {
        const first = name.split(/\s+/)[0];
        if (first && first.length > 2 && first !== name) names.push(first);
    }
    return [...new Set(names)];
}

function namePattern(labels) {
    if (!labels.length) return null;
    return `(?<![\\p{L}\\p{N}])(?:${labels.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}])`;
}

const HIDE_VERB = '(?:must|should|can|cannot|can\'t|mustn\'t|will|may|is to|are to)?\\s*(?:never|not|n\'t)\\s+(?:ever\\s+)?(?:know|find out|learn|be told|hear|discover)';

function firstIndex(text, labels) {
    const pattern = namePattern(labels);
    if (!pattern) return -1;
    const match = new RegExp(pattern, 'iu').exec(text);
    return match ? match.index : -1;
}

// True when `text` says the fact is hidden from the NPC named by `labels`. Pronoun subjects
// ("she must never know") count only when another NPC is named before this one (the actor, as in
// "Soo-jin secretly signed Eun-ji …; she must never know"), so the holder's own line stays put.
export function textHidesFrom(text, labels, { otherLabels = [], directOnly = false } = {}) {
    const name = namePattern(labels);
    if (!name || !text) return false;
    const direct = [
        `${name}\\s+${HIDE_VERB}`,
        `never\\s+(?:tell|told|telling)\\s+${name}`,
        `(?:hid|hide|hides|hidden|hiding|keep|keeps|kept|keeping)\\b[^.;]{0,60}\\bfrom\\s+${name}`,
        `${name}\\s+(?:does not|doesn't|did not|didn't|is not to|isn't to)\\s+know`,
        `without\\s+${name}(?:'s)?\\s+(?:knowing|knowledge|consent)`,
        `behind\\s+${name}(?:'s)?\\s+back`,
    ];
    if (direct.some(source => new RegExp(source, 'iu').test(text))) return true;
    if (directOnly || !new RegExp(`(?:she|he|they)\\s+${HIDE_VERB}`, 'iu').test(text)) return false;
    const own = firstIndex(text, labels);
    const other = firstIndex(text, otherLabels);
    return own >= 0 && other >= 0 && other < own;
}

function firstHolder(text, npcs, exclude) {
    let best = null, bestIndex = Infinity;
    for (const npc of npcs) {
        if (npc === exclude || npc?.archived) continue;
        const pattern = namePattern(labelsOf(npc));
        if (!pattern) continue;
        const match = new RegExp(pattern, 'iu').exec(text);
        if (match && match.index < bestIndex) { best = npc; bestIndex = match.index; }
    }
    return best;
}

function hasSimilar(list, fact, kinds = KNOWLEDGE_KINDS) {
    return (list || []).some(item => kinds.includes(item.kind) && factSimilarity(item.fact, fact) >= SIMILARITY);
}

/* Deterministic cross-NPC guard, run after every merge.
 * 1. A memory or knowledge entry on NPC Z that says it is hidden from Z is removed from Z and
 *    becomes Z's `unaware` entry; the first other NPC named in it becomes the holder of a secret.
 * 2. A secret/memory on holder Y saying it is hidden from Z gives Z an `unaware` entry.
 * 3. Z's memories and plain knowledge that repeat one of Z's `unaware` facts are removed, unless Z
 *    learned it later (a knows/secret entry from a newer message already replaced the gate).
 * Returns { npcs, changes } with new NPC objects only where something changed. */
export function enforceKnowledgeBoundaries(npcs, { sourceMessageId = null, turn = null } = {}) {
    const list = (Array.isArray(npcs) ? npcs : []).map(npc => npc ? { ...npc, knowledge: normalizeKnowledge(npc.knowledge), memories: Array.isArray(npc.memories) ? npc.memories.slice() : [] } : npc);
    const changes = [];
    const stamp = entry => ({
        ...entry,
        ...(Number.isInteger(sourceMessageId) && !Number.isInteger(entry.sourceMessageId) ? { sourceMessageId } : {}),
        ...(Number.isInteger(turn) && !Number.isInteger(entry.turn) ? { turn } : {}),
    });
    // A ledger the player edited and locked is authoritative: the guard never rewrites it.
    const editable = npc => !(Array.isArray(npc?.manualProfileFields) && npc.manualProfileFields.includes('knowledge'));
    const addEntry = (npc, entry, reason) => {
        if (!editable(npc) || hasSimilar(npc.knowledge, entry.fact)) return;
        npc.knowledge = normalizeKnowledge([...npc.knowledge, stamp(entry)]);
        changes.push({ npcId: npc.id, action: `add-${entry.kind}`, fact: entry.fact, reason });
    };
    const live = list.filter(npc => npc && !npc.archived);

    for (const npc of live) {
        if (!editable(npc)) continue;
        const labels = labelsOf(npc);
        const otherLabels = live.filter(other => other !== npc).flatMap(labelsOf);
        const leaked = [];
        npc.memories = npc.memories.filter(memory => {
            if (!textHidesFrom(memory, labels, { otherLabels })) return true;
            leaked.push(memory);
            return false;
        });
        npc.knowledge = npc.knowledge.filter(entry => {
            if (entry.kind === 'unaware' || !textHidesFrom(entry.fact, labels, { otherLabels, directOnly: entry.kind === 'secret' })) return true;
            leaked.push(entry.fact);
            return false;
        });
        for (const fact of leaked) {
            changes.push({ npcId: npc.id, action: 'remove-leak', fact, reason: 'stored on the NPC it is hidden from' });
            addEntry(npc, { fact, kind: 'unaware' }, 'hidden from this NPC');
            const holder = firstHolder(fact, live, npc);
            if (holder) addEntry(holder, { fact, kind: 'secret' }, `holder of a fact hidden from ${npc.name}`);
        }
    }

    for (const holder of live) {
        const texts = [...holder.knowledge.filter(entry => entry.kind !== 'unaware').map(entry => entry.fact), ...holder.memories];
        for (const text of texts) {
            for (const other of live) {
                if (other === holder) continue;
                if (!textHidesFrom(text, labelsOf(other), { otherLabels: live.filter(npc => npc !== other).flatMap(labelsOf) })) continue;
                addEntry(other, { fact: text, kind: 'unaware' }, `${holder.name} hides it from this NPC`);
            }
        }
    }

    for (const npc of live) {
        const gates = npc.knowledge.filter(entry => entry.kind === 'unaware');
        if (!gates.length || !editable(npc)) continue;
        const repeats = item => gates.some(gate => factSimilarity(gate.fact, item) >= 0.5);
        const keptMemories = npc.memories.filter(memory => !repeats(memory));
        const keptKnowledge = npc.knowledge.filter(entry => entry.kind !== 'knows' || !repeats(entry.fact));
        for (const memory of npc.memories) if (!keptMemories.includes(memory)) changes.push({ npcId: npc.id, action: 'remove-leak', fact: memory, reason: 'repeats a fact this NPC does not know' });
        for (const entry of npc.knowledge) if (!keptKnowledge.includes(entry)) changes.push({ npcId: npc.id, action: 'remove-leak', fact: entry.fact, reason: 'repeats a fact this NPC does not know' });
        npc.memories = keptMemories;
        npc.knowledge = keptKnowledge;
    }

    const original = Array.isArray(npcs) ? npcs : [];
    const result = list.map((npc, index) => {
        const before = original[index];
        if (!npc || !before) return npc;
        const same = JSON.stringify(normalizeKnowledge(before.knowledge)) === JSON.stringify(npc.knowledge)
            && JSON.stringify(before.memories || []) === JSON.stringify(npc.memories);
        return same ? before : npc;
    });
    return { npcs: result, changes };
}

/* Focused knowledge pass. The broad dossier scanner rarely fills optional fields it is not shown
 * an example of, so information flow gets its own small request, like the relationship pass.
 * It runs only when the current exchange carries information-flow signals and names a dossier. */
const INFORMATION_SIGNAL = /\b(secret(?:ly)?|never (?:tell|know|find out)|don'?t tell|must(?:n'?t| not| never) know|confess(?:ed|es)?|confid(?:e|ed|es)|between us|keep (?:it|this) (?:quiet|between)|hid(?:e|es|den|ing)?|kept from|whisper(?:ed|s)?|told|tells|reveal(?:ed|s)?|admit(?:ted|s)?|lie[ds]?|lying|overh(?:eard|ear)|found out|learn(?:ed|s|t)?|discover(?:ed|s)?|doesn'?t know|does not know|swore|swear|promise[ds]?|alias|real name|isn'?t my name|truth)\b/i;

export const KNOWLEDGE_PASS_TARGET_LIMIT = 6;
export const KNOWLEDGE_PASS_SYSTEM_PROMPT = "You are NPC State Delta's isolated knowledge evaluator. Use only the supplied targets and current exchange. Return only the requested JSON object.";

export function knowledgePassRelevant(transcript) {
    return INFORMATION_SIGNAL.test(String(transcript || ''));
}

export function knowledgePassTargets(npcs, transcript, limit = KNOWLEDGE_PASS_TARGET_LIMIT) {
    const text = String(transcript || '');
    if (!knowledgePassRelevant(text)) return [];
    return (Array.isArray(npcs) ? npcs : [])
        .filter(npc => npc && !npc.archived && npc.lifeState !== 'deceased')
        .filter(npc => firstIndex(text, labelsOf(npc)) >= 0)
        .slice(0, limit);
}

export function buildKnowledgePassPrompt({ transcript, targets = [], userName = 'User' }) {
    const payload = targets.map(npc => ({
        id: npc.id,
        name: npc.name,
        ...(Array.isArray(npc.aliases) && npc.aliases.length ? { aliases: npc.aliases.slice(0, 4) } : {}),
        ...(normalizeKnowledge(npc.knowledge).length ? { existingKnowledge: scannerKnowledgeContext(npc, 8) } : {}),
    }));
    return `Private NPC knowledge evaluator.
Decide, for each TARGET, what durable facts from the CURRENT EXCHANGE that NPC now knows, keeps secret, or explicitly does NOT know.
Rules:
1. kind="knows": the NPC was present and perceived it, was told it on-page, or worked it out from on-page evidence (source=witnessed|told|deduced; from=who told them).
2. kind="secret": the NPC knows it and deliberately conceals it from someone; name who it is hidden from in the fact.
3. kind="unaware": the exchange shows the NPC does NOT know it: it is hidden from them, said while they were absent/asleep/out of earshot, or they believe something false about it.
4. A fact never goes to an NPC who could not have learned it. Absent NPCs learn nothing. ${userName} is the player: never a target.
5. Only facts that matter later (identities, secrets, debts, crimes, promises, who did what). Max 3 per target. Skip facts already in existingKnowledge. One short sentence each, naming the people involved.
6. Targets with nothing new: "knowledge":[].
JSON only: {"npcs":[{"id":"<target id>","knowledge":[{"fact":"...","kind":"knows|secret|unaware","source":"witnessed|told|deduced","from":""}]}]}
Example: Mara tells the player, while Jun sleeps, that she stole the ledger and Jun must never know => {"npcs":[{"id":"npc_mara","knowledge":[{"fact":"Mara stole the ledger and hides it from Jun","kind":"secret"}]},{"id":"npc_jun","knowledge":[{"fact":"Mara stole the ledger","kind":"unaware"}]}]}

TARGETS:
${JSON.stringify(payload)}

CURRENT EXCHANGE:
${String(transcript || '').trim()}`;
}

// Map of target id -> knowledge entries from a parsed knowledge-pass response.
export function parseKnowledgePass(parsed, targets = []) {
    const decisions = new Map();
    const rows = Array.isArray(parsed?.npcs) ? parsed.npcs : [];
    for (const target of targets) {
        const labels = labelsOf(target).map(label => label.toLowerCase());
        const row = rows.find(item => String(item?.id || '') === String(target.id)
            || (item?.name && labels.includes(String(item.name).trim().toLowerCase())));
        if (!row) continue;
        const entries = readScanKnowledge(row).slice(0, KNOWLEDGE_NEW_PER_SCAN);
        if (entries.length) decisions.set(target.id, entries);
    }
    return decisions;
}

// Applies knowledge-pass decisions to stored NPCs (manual locks respected), then re-runs the
// cross-NPC guard. Returns { npcs, applied, changes }.
export function applyKnowledgeDecisions(npcs, decisions, { sourceMessageId = null, turn = null } = {}) {
    let applied = 0;
    const list = (Array.isArray(npcs) ? npcs : []).map(npc => {
        const entries = npc && decisions?.get?.(npc.id);
        if (!entries?.length) return npc;
        if (Array.isArray(npc.manualProfileFields) && npc.manualProfileFields.includes('knowledge')) return npc;
        const knowledge = mergeKnowledge(npc.knowledge, entries, { sourceMessageId, turn });
        if (JSON.stringify(knowledge) === JSON.stringify(normalizeKnowledge(npc.knowledge))) return npc;
        applied++;
        return { ...npc, knowledge };
    });
    const guarded = enforceKnowledgeBoundaries(list, { sourceMessageId, turn });
    return { npcs: guarded.npcs, applied, changes: guarded.changes };
}

// Model-facing gate, rendered inside the NPC's essential (never budget-dropped) block.
export function renderKnowledgeGate(npc, maxChars = 600) {
    const knowledge = normalizeKnowledge(npc?.knowledge);
    if (!knowledge.length) return '';
    const by = kind => knowledge.filter(entry => entry.kind === kind).map(entry => entry.fact);
    const parts = [];
    const unaware = by('unaware');
    const secret = by('secret');
    const knows = by('knows');
    // Unaware first: it is the hard constraint, and must survive any cap.
    if (unaware.length) parts.push(`does NOT know (must not act on, hint at, or be told this off-page): ${unaware.join(' | ')}`);
    if (secret.length) parts.push(`knows but keeps secret (never reveals without an on-page reason): ${secret.join(' | ')}`);
    if (knows.length) parts.push(`knows: ${knows.join(' | ')}`);
    let text = `KNOWLEDGE GATE (authoritative): ${parts.join('; ')}`;
    if (text.length > maxChars) {
        const cut = text.slice(0, maxChars);
        const boundary = Math.max(cut.lastIndexOf(' | '), cut.lastIndexOf('; '));
        text = boundary > 40 ? cut.slice(0, boundary) : cut;
    }
    return text;
}

// Compact list for the scanner prompt (dedupe context, never evidence).
export function scannerKnowledgeContext(npc, max = 8) {
    return normalizeKnowledge(npc?.knowledge).slice(-max).map(entry => `${entry.kind}: ${cleanText(entry.fact, 160)}`);
}

// Editor round-trip: one entry per line, "knows: …", "secret: …", "unaware: …".
export function knowledgeToEditorText(knowledge) {
    return normalizeKnowledge(knowledge).map(entry => `${entry.kind}: ${entry.fact}`).join('\n');
}

export function knowledgeFromEditorText(text, previous = []) {
    const old = normalizeKnowledge(previous);
    const entries = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
        const match = /^(knows|secret|unaware)\s*:\s*(.+)$/i.exec(line);
        const kind = match ? match[1].toLowerCase() : 'knows';
        const fact = match ? match[2] : line;
        const prior = old.find(entry => entry.kind === kind && entry.fact === cleanText(fact, KNOWLEDGE_FACT_MAX));
        return prior || { fact, kind };
    });
    return normalizeKnowledge(entries);
}
