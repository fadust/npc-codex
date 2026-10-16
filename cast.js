/* NPC State Delta: cast resolution (fadust fork).
 *
 * References are queries. "Martha's older daughter", "his first student", "her ex-wife", "the
 * headmaster of Hogwarts" each name an anchor, a tie or title, and qualifiers. Code narrows the
 * candidates (names, 1-hop ties of any kind, gender, roles/orgs, scene location, canon lorebook
 * entries); one focused model request decides who each reference is, in this order: canon entry,
 * existing dossier, new. Code then validates the answer and hands it to the normal NSD merge as
 * ordinary scan rows and relationship edges.
 *
 * Pure module: no host, DOM or storage access. */

import {
    firstIndex,
    labelsOf,
    knowledgePassRelevant,
    normalizeKnowledge,
    readScanKnowledge,
    scannerKnowledgeContext,
    KNOWLEDGE_NEW_PER_SCAN,
} from './knowledge.js';
import { groundSheetDelta, sheetContext, sheetDeltaIsEmpty } from './sheet.js';
import { memoryContext, readMemoryDecision, readEventDecisions } from './memory.js';

export const CAST_PASS_SYSTEM_PROMPT = "You are NPC State Delta's isolated cast and knowledge evaluator. Use only the supplied candidates, canon entries and current exchange. Return only the requested JSON object.";
export const ROLE_LIMIT = 6;
export const SHORTLIST_LIMIT = 10;
export const CANON_LIMIT = 6;
export const CAST_PEOPLE_LIMIT = 12;

function cleanText(value, max) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function norm(value) {
    return cleanText(value, 400).toLowerCase();
}

// For whole exchanges and canon entries: same normalization, no length cap.
function normAll(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/* ---------- Roles: a title held in an organization, possibly exclusive, possibly former. ---------- */

const EXCLUSIVE_TITLE = /\b(head ?master|head ?mistress|headman|principal|dean|chancellor|king|queen|emperor|empress|president|mayor|chief|captain|commander|guild ?master|grand ?master|abbot|abbess|high priest(?:ess)?|matriarch|patriarch|ceo|director|warden|sheriff|governor|regent|pope|archbishop)\b/i;

export function normalizeRole(raw) {
    if (typeof raw === 'string') raw = { title: raw };
    if (!raw || typeof raw !== 'object') return null;
    const title = cleanText(raw.title ?? raw.role ?? raw.name, 120);
    if (!title) return null;
    const org = cleanText(raw.org ?? raw.organization ?? raw.faction ?? raw.of, 120);
    const role = { title, ...(org ? { org } : {}) };
    // Exclusivity is decided here, not by the model: "prefect" or "professor" can be shared even
    // when a model calls them exclusive, and a wrong flag would end someone else's title.
    const exclusive = raw.exclusive !== false && Boolean(org) && EXCLUSIVE_TITLE.test(title);
    if (exclusive) role.exclusive = true;
    const status = String(raw.status ?? '').toLowerCase();
    if (Number.isInteger(raw.since)) role.since = raw.since;
    if (Number.isInteger(raw.until)) role.until = raw.until;
    else if (['former', 'ex', 'past', 'retired', 'ended'].includes(status)) role.until = Number.isInteger(raw.turn) ? raw.turn : 0;
    return role;
}

const roleKey = role => `${norm(role.title)}|${norm(role.org)}`;
export const roleIsCurrent = role => !Number.isInteger(role?.until);

export function normalizeRoles(value) {
    const out = [];
    for (const raw of Array.isArray(value) ? value : []) {
        const role = normalizeRole(raw);
        if (!role) continue;
        const index = out.findIndex(item => roleKey(item) === roleKey(role));
        if (index >= 0) out[index] = { ...out[index], ...role };
        else out.push(role);
    }
    // Current roles outrank former ones when the list is full.
    return [...out.filter(roleIsCurrent), ...out.filter(role => !roleIsCurrent(role))].slice(0, ROLE_LIMIT);
}

export function mergeRoles(existing, incoming, { turn = null } = {}) {
    const stamped = normalizeRoles(incoming).map(role => {
        const next = { ...role };
        if (roleIsCurrent(next) && !Number.isInteger(next.since) && Number.isInteger(turn)) next.since = turn;
        if (!roleIsCurrent(next) && next.until === 0 && Number.isInteger(turn)) next.until = turn;
        return next;
    });
    const out = normalizeRoles(existing).slice();
    for (const role of stamped) {
        const index = out.findIndex(item => roleKey(item) === roleKey(role));
        if (index < 0) { out.push(role); continue; }
        const merged = { ...out[index], ...role };
        if (roleIsCurrent(role)) delete merged.until;
        if (Number.isInteger(out[index].since)) merged.since = out[index].since;
        out[index] = merged;
    }
    return normalizeRoles(out);
}

export function roleLabel(role) {
    return `${role.title}${role.org ? ` of ${role.org}` : ''}${roleIsCurrent(role) ? '' : ' (former)'}`;
}

export function currentRoleText(roles) {
    return normalizeRoles(roles).filter(roleIsCurrent).map(roleLabel).join('; ').slice(0, 300);
}

// One current holder per exclusive title+org: the most recent holder keeps it; earlier holders
// become former. Locked (manual) roles are never rewritten.
export function transferExclusiveRoles(npcs, { turn = null } = {}) {
    const list = Array.isArray(npcs) ? npcs : [];
    const holders = new Map();
    list.forEach((npc, index) => {
        if (!npc || npc.archived) return;
        for (const role of normalizeRoles(npc.roles)) {
            if (!role.exclusive || !role.org || !roleIsCurrent(role)) continue;
            const key = roleKey(role);
            if (!holders.has(key)) holders.set(key, []);
            holders.get(key).push({ index, since: Number.isInteger(role.since) ? role.since : -1 });
        }
    });
    const changes = [];
    const out = list.slice();
    for (const [key, owners] of holders) {
        if (owners.length < 2) continue;
        const keep = owners.reduce((best, item) => (item.since > best.since ? item : best), owners[0]);
        for (const owner of owners) {
            if (owner === keep) continue;
            const npc = out[owner.index];
            if (Array.isArray(npc.manualProfileFields) && npc.manualProfileFields.includes('roles')) continue;
            const roles = normalizeRoles(npc.roles).map(role => (roleKey(role) === key && roleIsCurrent(role)
                ? { ...role, until: Number.isInteger(turn) ? turn : (keep.since >= 0 ? keep.since : 0) }
                : role));
            out[owner.index] = { ...npc, roles, role: currentRoleText(roles) || npc.role };
            changes.push({ npcId: npc.id, ended: key });
        }
    }
    return { npcs: out, changes };
}

function stripArticle(value) {
    return cleanText(value, 200).replace(/^(?:the|a|an)\s+/i, '');
}

// Titles are roles, not names: an alias equal to one of the NPC's role titles ("Headmaster",
// "headmaster of Hogwarts") would keep matching after the title passes to someone else.
export function stripTitleAliases(npc) {
    const roles = normalizeRoles(npc?.roles);
    if (!roles.length || !Array.isArray(npc?.aliases) || !npc.aliases.length) return npc;
    const titles = new Set(roles.flatMap(role => [role.title, role.org ? `${role.title} of ${role.org}` : '', role.org ? `${role.org} ${role.title}` : ''])
        .map(stripArticle).map(norm).filter(Boolean));
    const aliases = npc.aliases.filter(alias => !titles.has(norm(stripArticle(alias))));
    return aliases.length === npc.aliases.length ? npc : { ...npc, aliases };
}

/* ---------- Canon references stored on a dossier. ---------- */

export function normalizeCanonRef(value) {
    if (!value || typeof value !== 'object') return null;
    const world = cleanText(value.world, 200);
    const uid = Number(value.uid);
    if (!world || !Number.isInteger(uid)) return null;
    const ref = { world, uid };
    const name = cleanText(value.name, 160);
    if (name) ref.name = name;
    return ref;
}

/* ---------- Signals: does this exchange need cast resolution at all? ---------- */

const TIE_WORDS = 'daughters?|sons?|child(?:ren)?|kids?|wi(?:fe|ves)|husbands?|spouses?|brothers?|sisters?|siblings?|twins?|mother|father|mom|mum|dad|parents?|uncles?|aunts?|cousins?|nieces?|nephews?|grand(?:mother|father|daughter|son|child|ma|pa)s?|students?|apprentices?|disciples?|pupils?|teachers?|masters?|mentors?|friends?|rivals?|lovers?|fianc[eé]e?s?|partners?|servants?|maids?|butlers?|guards?|bodyguards?|boss|employers?|employees?|retainers?|squires?|wards?|guardians?|heirs?|successors?|predecessors?|deputy|second|right hand|captain|lieutenant';
const TIE_QUALIFIERS = '(?:(?:old|new|late|former|ex|first|second|third|fourth|last|\\d+(?:st|nd|rd|th)|eldest|oldest|youngest|older|younger|elder|little|big|baby|twin|half|step|favou?rite|only|best|sworn|estranged|current)[\\s-]+)*';
const TIE_PHRASE = new RegExp(`\\b((?:[A-Z][\\p{L}'’-]+(?:\\s+[A-Z][\\p{L}'’-]+){0,2})(?:'s|’s)|her|his|their|my|your|our)\\s+${TIE_QUALIFIERS}(?:${TIE_WORDS})\\b`, 'gu');
const TITLE_PHRASE = /\bthe\s+(?:(?:old|new|former|current|late|young|acting)\s+)?(deputy(?:\s+head(?:\s?master|\s?mistress)?)?|head of house|head ?master|head ?mistress|principal|dean|captain|king|queen|prince|princess|mayor|chief|commander|innkeeper|barkeep|bartender|barista|watchman|guard|priest(?:ess)?|abbot|abbess|lord|lady|duke|duchess|baron|baroness|count|countess|knight|healer|smith|blacksmith|merchant|steward|chancellor|emperor|empress|professor|teacher|librarian|caretaker|keeper|landlord|landlady|owner|boss|manager|director|sheriff|warden|governor|regent|magistrate|elder|matron)\b(?:\s+of\s+(?:the\s+)?([A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)*))?/giu;
// Item, injury, spell and rank events: the stat sheet needs the cast pass even without new names.
const SHEET_SIGNAL = /\b(gave|gives|handed|hands|took|takes|stole|stolen|lost|dropped|broke|broken|shattered|bought|sold|found|picked up|pocketed|equipped|wielded|drew|draws|sheathed|wore|wears|wearing|donned|holds|holding|held|carries|carrying|clutch(?:es|ing)?|badge|insignia|crest|hat|armou?r|sword|blade|dagger|bow|staff|wand|ring|amulet|necklace|key|compass|potion|scroll|wounded|injured|bleeding|bled|poisoned|cursed|fever|sick|bandaged|healed|exhausted|cast|casts|spell|cantrip|learned|mastered|skill|promoted|demoted|rank|level(?:ed)? up|hp|mana|stamina)\b/i;

const NAME_RUN = /(?<![\p{L}\p{N}'’])([A-Z][\p{Ll}'’-]+(?:\s+[A-Z][\p{Ll}'’-]+){0,2})(?![\p{L}\p{N}])/gu;
const NOT_NAMES = new Set(['the', 'a', 'an', 'i', 'he', 'she', 'they', 'we', 'you', 'it', 'his', 'her', 'their', 'my', 'your', 'our', 'its',
    'this', 'that', 'these', 'those', 'there', 'then', 'when', 'what', 'who', 'why', 'how', 'where', 'and', 'but', 'or', 'so', 'if', 'yes',
    'no', 'not', 'just', 'still', 'later', 'now', 'well', 'oh', 'ah', 'okay', 'ok', 'mr', 'mrs', 'ms', 'miss', 'sir', 'madam', 'lady', 'lord',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december', 'god', 'gods', 'ooc', 'eomma', 'appa', 'mom', 'dad', 'mum']);

function midSentence(text, index) {
    const before = text.slice(Math.max(0, index - 3), index);
    return !/(^|[.!?…"“*\]\n]\s*)$/.test(before) && index > 0;
}

export function castSignals(transcript, { knownLabels = [], userName = '', charName = '' } = {}) {
    const text = String(transcript || '');
    const known = new Set([...knownLabels, userName, charName].map(norm).filter(Boolean));
    const knownTokens = new Set([...known].flatMap(label => label.split(/\s+/)));
    const unknownNames = [];
    for (const match of text.matchAll(NAME_RUN)) {
        const name = match[1];
        const words = name.split(/\s+/);
        if (words.every(word => NOT_NAMES.has(word.toLowerCase()))) continue;
        if (known.has(norm(name)) || words.some(word => knownTokens.has(word.toLowerCase()))) continue;
        if (!midSentence(text, match.index)) continue;
        if (!unknownNames.includes(name)) unknownNames.push(name);
    }
    const tiePhrases = [...text.matchAll(TIE_PHRASE)].map(match => cleanText(match[0], 120));
    const titlePhrases = [...text.matchAll(TITLE_PHRASE)].map(match => cleanText(match[0], 120));
    const information = knowledgePassRelevant(text);
    const sheet = SHEET_SIGNAL.test(text);
    // A known NPC in the exchange may form or revise memories.
    const lowered = normAll(text);
    const memory = (knownLabels || []).some(label => { const key = normAll(label); return key.length > 2 && lowered.includes(key); });
    return {
        unknownNames: unknownNames.slice(0, 12),
        tiePhrases: [...new Set(tiePhrases)].slice(0, 12),
        titlePhrases: [...new Set(titlePhrases)].slice(0, 12),
        information,
        sheet,
        memory,
        any: Boolean(unknownNames.length || tiePhrases.length || titlePhrases.length || information || sheet || memory),
    };
}

/* ---------- Shortlist: dossiers that could be meant, with what is needed to tell them apart. ---------- */

function tieLines(npc) {
    return (Array.isArray(npc?.keyRelationships) ? npc.keyRelationships : []).map(item => cleanText(item, 160)).filter(Boolean);
}

function tieCounterpartNames(npc) {
    // "Name — relation | dynamic": the counterpart is the text before the dash.
    return tieLines(npc).map(line => cleanText(line.split(/\s+[—–-]\s+/)[0], 120)).filter(Boolean);
}

function tokens(text) {
    return new Set(normAll(text).split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 2));
}

export function buildCastShortlist({ npcs = [], transcript = '', sceneLocation = '', baibaiNpcs = [], limit = SHORTLIST_LIMIT } = {}) {
    const text = String(transcript || '');
    const words = tokens(text);
    const scene = tokens(sceneLocation);
    const live = (Array.isArray(npcs) ? npcs : []).filter(npc => npc && !npc.archived);
    const named = new Set(live.filter(npc => firstIndex(text, labelsOf(npc)) >= 0).map(npc => npc.id));
    const byLabel = new Map(live.flatMap(npc => labelsOf(npc).map(label => [norm(label), npc])));
    const scores = new Map();
    const bump = (npc, value) => scores.set(npc.id, (scores.get(npc.id) || 0) + value);
    for (const npc of live) {
        if (named.has(npc.id)) bump(npc, 10);
        if (npc.present) bump(npc, 2);
        const roleWords = tokens([npc.role, ...(npc.roles || []).flatMap(role => [role.title, role.org])].join(' '));
        let roleHits = 0;
        for (const word of roleWords) if (words.has(word)) roleHits++;
        if (roleHits) bump(npc, 3 * Math.min(3, roleHits));
        const place = tokens([npc.location, npc.homeBase].join(' '));
        let placeHits = 0;
        for (const word of place) if (scene.has(word)) placeHits++;
        if (placeHits >= 2 || (placeHits === 1 && scene.size <= 2)) bump(npc, 4);
    }
    // 1-hop: anyone tied (any kind of tie) to a named NPC is a candidate for "X's <tie>".
    for (const id of named) {
        const anchor = live.find(npc => npc.id === id);
        for (const name of tieCounterpartNames(anchor)) {
            const other = byLabel.get(norm(name));
            if (other && other.id !== id) bump(other, 5);
        }
        for (const npc of live) {
            if (npc.id !== id && tieCounterpartNames(npc).some(name => labelsOf(anchor).some(label => norm(label) === norm(name)))) bump(npc, 5);
        }
    }
    const baibai = new Map((Array.isArray(baibaiNpcs) ? baibaiNpcs : []).map(item => [norm(item?.name), item]));
    return live
        .filter(npc => (scores.get(npc.id) || 0) > 0)
        .sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0))
        .slice(0, limit)
        .map(npc => {
            const extra = baibai.get(norm(npc.name)) || {};
            const roles = normalizeRoles(npc.roles);
            return {
                id: npc.id,
                name: npc.name,
                ...(npc.aliases?.length ? { aliases: npc.aliases.slice(0, 5) } : {}),
                ...((npc.gender || extra.gender) ? { gender: npc.gender || extra.gender } : {}),
                ...((npc.age || npc.apparentAge || extra.age) ? { age: npc.age || npc.apparentAge || extra.age } : {}),
                ...(roles.length ? { roles: roles.map(roleLabel) } : (npc.role || extra.title ? { role: cleanText(npc.role || extra.title, 160) } : {})),
                ...(tieLines(npc).length ? { ties: tieLines(npc) } : (extra.ties ? { ties: [cleanText(extra.ties, 200)] } : {})),
                ...((npc.location || extra.location) ? { location: cleanText(npc.location || extra.location, 120) } : {}),
                ...(npc.lifeState && npc.lifeState !== 'unknown' ? { lifeState: npc.lifeState } : {}),
                ...(npc.canonRef ? { canon: `canon:${npc.canonRef.world}#${npc.canonRef.uid}` } : {}),
                ...(normalizeKnowledge(npc.knowledge).length ? { existingKnowledge: scannerKnowledgeContext(npc, 6) } : {}),
                ...(sheetContext(npc.sheet) ? { sheet: sheetContext(npc.sheet) } : {}),
                ...memoryContext(npc),
            };
        });
}

/* ---------- Canon: lorebook entries that may define a referenced person. ---------- */

const CANON_STOP = new Set(['that', 'this', 'with', 'from', 'have', 'will', 'your', 'they', 'them', 'their', 'there', 'what', 'when',
    'where', 'which', 'would', 'could', 'should', 'about', 'into', 'were', 'been', 'just', 'like', 'only', 'then', 'than', 'over', 'also']);

function contentTokens(text) {
    return new Set(normAll(text).split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 3 && !CANON_STOP.has(token)));
}

export const CARD_CANON_WORLD = 'card';

function defaultFocus(text) {
    const signals = castSignals(text);
    return [...signals.titlePhrases, ...signals.tiePhrases, ...signals.unknownNames]
        .map(phrase => phrase.replace(/^the\s+/i, ''));
}
const CARD_CANON_BONUS = 3;
const PERSON_RUN = /(?<![\p{L}\p{N}'’])([A-Z][\p{Ll}'’-]+(?:\s+(?:[A-Z][\p{Ll}'’-]+|de|van|von|al|bin)){1,3})(?![\p{L}\p{N}])/gu;

// The card's own definitions are this story's canon (an AU may replace franchise canon). Each
// sentence of the description/scenario that names a person becomes a canon entry for that name.
export function cardCanonEntries(cardText, { limit = 80 } = {}) {
    const sentences = String(cardText || '').split(/(?<=[.!?])\s+|\r?\n+/).map(item => cleanText(item, 400)).filter(Boolean);
    const out = [];
    sentences.forEach((sentence, index) => {
        for (const match of sentence.matchAll(PERSON_RUN)) {
            // "The Six-House Era" is not a person: a leading function word is never part of a name.
            const words = match[1].split(/\s+/);
            while (words.length && NOT_NAMES.has(words[0].toLowerCase())) words.shift();
            if (words.length < 2) continue;
            const name = words.join(' ');
            if (out.length >= limit) return;
            // Only the full name is a key: name parts ("World", "Six") would match ordinary prose.
            out.push({ world: CARD_CANON_WORLD, uid: out.length, comment: name, key: [name], content: sentence, sentence: index });
        }
    });
    return out;
}

// entries: SillyTavern world-info entries ({world, uid, comment, key[], content, disable}), plus
// cardCanonEntries(). Card canon ranks ahead of lorebook canon.
export function rankCanonEntries(entries, transcript, { npcs = [], limit = CANON_LIMIT, focus = null, exclude = [] } = {}) {
    // The card and the player are not cast; their names also prefix every transcript line.
    const excluded = (Array.isArray(exclude) ? exclude : []).map(norm).filter(Boolean);
    const excludedEntry = entry => [entry.comment, ...(entry.key || [])].map(norm).filter(Boolean)
        .some(label => excluded.some(name => name === label || name.startsWith(`${label} `) || label.startsWith(`${name} `)));
    const usable = (Array.isArray(entries) ? entries : []).filter(entry => entry && !entry.disable && String(entry.content || '').trim() && !excludedEntry(entry));
    if (!usable.length) return [];
    const text = String(transcript || '');
    const query = contentTokens(text);
    // Focus terms: what the references ask for ("headmistress", "caretaker", unknown names). An
    // entry containing one qualifies even when the word is common in a small lorebook.
    const focusTokens = contentTokens((focus ?? defaultFocus(text)).join(' '));
    const docs = usable.map(entry => ({ entry, tokens: contentTokens(`${entry.comment || ''} ${(entry.key || []).join(' ')} ${entry.content || ''}`) }));
    const df = new Map();
    for (const doc of docs) for (const token of doc.tokens) df.set(token, (df.get(token) || 0) + 1);
    const total = docs.length;
    const idf = token => Math.log((total + 1) / ((df.get(token) || 0) + 0.5));
    const rare = Math.log((total + 1) / 2.5);
    const live = (Array.isArray(npcs) ? npcs : []).filter(Boolean);
    const scored = docs.map(({ entry, tokens: docTokens }) => {
        let score = 0;
        let rareHits = 0;
        let focusHits = 0;
        for (const token of focusTokens) if (docTokens.has(token)) focusHits++;
        score += 2 * focusHits;
        for (const token of query) {
            if (!docTokens.has(token)) continue;
            const weight = idf(token);
            score += weight;
            if (weight >= rare) rareHits++;
        }
        const keys = (Array.isArray(entry.key) ? entry.key : []).map(key => cleanText(key, 80)).filter(Boolean);
        const keyHit = keys.some(key => key.length > 2 && firstIndex(text, [key]) >= 0);
        if (keyHit) score += 10;
        const card = entry.world === CARD_CANON_WORLD;
        if (card && (keyHit || focusHits)) score += CARD_CANON_BONUS;
        return { entry, score, rareHits, keyHit, keys, focusHits, card };
        // Card sentences mention many things; they qualify only by the full name or a focus term.
    }).filter(item => item.keyHit || item.focusHits > 0 || (!item.card && item.rareHits >= 2))
        .sort((a, b) => b.score - a.score)
        // One entry per name (card sentences repeat a name): the best-scoring one represents it.
        .filter((item, index, all) => all.findIndex(other => norm(other.entry.comment || other.keys[0]) === norm(item.entry.comment || item.keys[0])) === index)
        .slice(0, limit);
    return scored.map(({ entry, keys }) => {
        const name = cleanText(entry.comment || keys[0], 160);
        const dossier = live.find(npc => labelsOf(npc).some(label => norm(label) === norm(name) || keys.some(key => norm(key) === norm(label))));
        return {
            id: `canon:${entry.world}#${entry.uid}`,
            source: entry.world === CARD_CANON_WORLD ? 'card' : 'lorebook',
            world: entry.world,
            uid: entry.uid,
            name,
            keys: keys.slice(0, 6),
            snippet: cleanText(entry.content, 500),
            ...(dossier ? { dossierId: dossier.id } : {}),
        };
    });
}

/* ---------- The combined cast + knowledge request. ---------- */

export function buildCastPassPrompt({ transcript, shortlist = [], canon = [], signals = {}, userName = 'User', charName = 'Character' }) {
    const hints = [
        signals.unknownNames?.length && `unlisted names: ${signals.unknownNames.join(', ')}`,
        signals.tiePhrases?.length && `tie references: ${signals.tiePhrases.join(' | ')}`,
        signals.titlePhrases?.length && `title references: ${signals.titlePhrases.join(' | ')}`,
    ].filter(Boolean).join('\n');
    return `Private NPC cast and knowledge evaluator.
TASK A - CAST. List each individual person the CURRENT EXCHANGE refers to by name, title or tie (people only: not places or objects, not crowds, not ${userName}, not ${charName}). Resolve each to exactly one of, checked IN THIS ORDER:
 1. a CANON entry that defines them: "is":"canon:<id>", "name" = the canonical name. source "card" is this story's own canon (it may be an AU) and outranks source "lorebook" when they disagree;
 2. an existing DOSSIER: "is":"<dossier id>";
 3. "is":"new".
A reference is a query: anchor + tie or title + qualifiers. "Martha's older daughter" = Martha's child, female, the older one; "his first student" = the earliest of his students; "her ex-wife" = her former spouse; "Tomas's younger brother" = Tomas's sibling, male, younger than Tomas; "the headmaster of Hogwarts" = the CURRENT holder of that title in this story. Decide with the candidates' ties, roles, gender, ages, life state and locations. If two candidates fit equally, use "new" with the reference as the name instead of guessing.
Per person: {"ref":"exact words from the exchange","is":"canon:<id>|<dossier id>|new","name":"proper name if known","gender":"female|male|","present":true|false,"roles":[{"title":"","org":"","exclusive":true,"status":"current|former"}],"ties":[{"is":"older daughter","of":"Martha"}]}
Only roles/ties stated in this exchange or the canon entry. A promotion or new post: the new title "current", the replaced one "former". "ties" reads "<this person> IS <tie> OF <other>". A newly revealed proper name for a dossier: "is":"<that id>","name":"<new name>".
TASK C (in each person object) - SHEET: only what THIS exchange states about that person: "sheet":{"items":[{"op":"gained|lost|equipped|unequipped","item":"","slot":"","significance":""}],"conditions":[{"op":"add|clear","name":"","kind":"injury|illness|buff|debuff|curse|status","severity":"","until":""}],"spells":[{"op":"learned|lost","name":"","school":"","tier":""}],"skills":[{"name":"","proficiency":""}],"rank":"","class":"","pools":[{"name":"HP","current":0,"max":0}],"attributes":[{"name":"","value":""}]}. Items: things that identify the person or matter later (weapons, wands, armour, badges/insignia, keys, heirlooms, quest objects, notable artefacts), not food, coins or furniture. An item the text shows them already holding or carrying => "gained"; wearing or wielding => "equipped" with a slot. Stolen/given away/broken/used up => "lost". "rank" = the person's standing on the world's scale (guild rank, level, belt, grade) when this exchange sets or reveals it, e.g. a promotion to Bronze => "rank":"Bronze". A tie or job title alone is not a rank. Omit "sheet" when the exchange states none of this.
TASK D - MEMORY. "events": what happened IN this exchange that those present will remember: events major to them or to people close to them, ${userName}'s actions that truly match or go against someone's personality, shared moments/jokes that will matter later. Skip routine talk. Each event once, objectively: {"op":"add|update","id":"<stored event id, for update>","what":"objective fact, short","where":"","witnesses":["everyone present who saw it, incl. ${userName}"],"secret":false,"views":[{"who":"<witness>","effect":"what it changed in THEM: feeling, belief or stance","level":"defining|significant|minor","fit":"matches|contradicts|"}]}. One view per witness; each reacts in their own way. defining = changes their life or a relationship. "told": someone here tells another about a stored event (ids in memories); a retelling is "told", never a new event: {"event":"<event id>","by":"","to":"","effect":""}. Per person object, "intents":[{"op":"add|done|drop","id":"","what":"plan, promise or unresolved problem they hold","due":""}]. Max 2 events; never repeat a stored event, update it.
TASK B - KNOWLEDGE. For people in the exchange, durable facts they now know, keep secret, or explicitly do NOT know (hidden from them, said while they were absent). Never give a fact to someone who could not have learned it. Max ${KNOWLEDGE_NEW_PER_SCAN} per person; skip existingKnowledge.
JSON only: {"people":[...],"knowledge":[{"who":"<dossier id or name>","fact":"","kind":"knows|secret|unaware","source":"witnessed|told|deduced","from":""}],"events":[...],"told":[...]}
Example: {"people":[{"ref":"the headmaster","is":"canon:HP#3","name":"Albus Dumbledore","gender":"male","present":true,"roles":[{"title":"Headmaster","org":"Hogwarts","exclusive":true,"status":"current"}],"ties":[]},{"ref":"Martha's older daughter","is":"new","name":"Martha's older daughter","gender":"female","present":false,"roles":[],"ties":[{"is":"older daughter","of":"Martha"}],"sheet":{"items":[{"op":"gained","item":"bread basket","significance":""}]}}],"knowledge":[]}

DOSSIER CANDIDATES:
${JSON.stringify(shortlist)}

CANON ENTRIES:
${JSON.stringify(canon.map(({ id, source, name, keys, snippet }) => ({ id, source, name, keys, snippet })))}
${hints ? `\nSIGNALS:\n${hints}\n` : ''}
CURRENT EXCHANGE:
${String(transcript || '').trim()}`;
}

/* ---------- Validation and conversion into ordinary NSD scan rows and edges. ---------- */

const GENDERED_TIES = [
    [/\b(daughter|wife|sister|mother|mom|mum|aunt|niece|granddaughter|grandmother|girlfriend|fianc[eé]e|maid|queen|princess|duchess|countess|baroness|headmistress|abbess|matriarch|empress|priestess)\b/i, 'female'],
    [/\b(son|husband|brother|father|dad|uncle|nephew|grandson|grandfather|boyfriend|fianc[eé]|butler|king|prince|duke|count|baron|headmaster|abbot|patriarch|emperor)\b/i, 'male'],
];

function impliedGender(text) {
    for (const [pattern, gender] of GENDERED_TIES) if (pattern.test(text)) return gender;
    return '';
}

// A "new person" whose label ends in a place or object noun ("Charms corridor", "Ravenclaw table").
const PLACE_NAME = /\b(?:hall|corridor|table|room|chamber|tower|castle|keep|street|road|lane|square|market|inn|tavern|forest|woods|river|lake|mountain|village|town|city|kingdom|gate|bridge|library|kitchen|courtyard|garden|dungeon|stairs?|staircase|classroom|common room|office|shop|temple|church|school|academy)$/i;

function appearsIn(text, fragment) {
    // The whole exchange: norm() caps at 400 chars, which dropped references late in a long reply.
    const haystack = normAll(text).replace(/[’]/g, "'");
    const needle = norm(fragment).replace(/[’]/g, "'");
    return Boolean(needle) && haystack.includes(needle);
}

export function castDecisionsToScan(parsed, { transcript = '', npcs = [], canon = [], userName = '', charName = '' } = {}) {
    const report = { accepted: [], rejected: [] };
    const live = (Array.isArray(npcs) ? npcs : []).filter(npc => npc && !npc.archived);
    const excluded = new Set([userName, charName].map(norm).filter(Boolean));
    const rows = [];
    const edges = [];
    const nameOf = new Map();
    const presentLabels = [];
    const people = (Array.isArray(parsed?.people) ? parsed.people : []).slice(0, CAST_PEOPLE_LIMIT);
    for (const person of people) {
        const ref = cleanText(person?.ref, 160);
        const is = cleanText(person?.is, 220);
        const name = cleanText(person?.name, 160);
        if (!ref || !appearsIn(transcript, ref)) { report.rejected.push({ ref, reason: 'reference not in exchange' }); continue; }
        if (excluded.has(norm(name)) || excluded.has(norm(ref))) continue;
        const gender = ['female', 'male'].includes(String(person?.gender || '').toLowerCase()) ? String(person.gender).toLowerCase() : '';
        const roles = normalizeRoles(person?.roles).map(role => ({ ...role }));
        let row = null;
        if (is.startsWith('canon:')) {
            const entry = canon.find(item => item.id === is);
            if (!entry) { report.rejected.push({ ref, reason: 'unknown canon entry' }); continue; }
            const canonical = name || entry.name;
            const dossier = live.find(npc => npc.id === entry.dossierId)
                || live.find(npc => labelsOf(npc).some(label => norm(label) === norm(canonical)));
            row = dossier
                ? { id: dossier.id, name: dossier.name, sameIndividual: true }
                : { name: canonical, identityKind: 'proper_name', dossierSignal: 'persistent', dossierReason: `canon entry ${entry.name}`, sameIndividual: true };
            row.canonRef = { world: entry.world, uid: entry.uid, name: entry.name };
            // Name-like canon keys ("Dumbledore", "Filch") become aliases so later mentions match.
            const nameKeys = (entry.keys || []).filter(key => /^[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)*$/u.test(key) && norm(key) !== norm(row.name));
            if (nameKeys.length && !row.id) row.aliases = nameKeys.slice(0, 4);
            row.matchLabels = [...new Set([...(entry.keys || []), canonical])];
        } else if (is === 'new') {
            const label = name || ref;
            if (PLACE_NAME.test(label)) { report.rejected.push({ ref, reason: 'a place, not a person' }); continue; }
            const existing = live.find(npc => labelsOf(npc).some(item => norm(item) === norm(label)));
            row = existing
                ? { id: existing.id, name: existing.name, sameIndividual: true }
                : { name: label, identityKind: name ? 'proper_name' : 'role_label', dossierSignal: 'meaningful', dossierReason: `cast reference "${ref}"`, sameIndividual: false };
        } else {
            const dossier = live.find(npc => npc.id === is);
            if (!dossier) { report.rejected.push({ ref, reason: 'unknown dossier id' }); continue; }
            row = { id: dossier.id, name: dossier.name, sameIndividual: true };
            if (name && norm(name) !== norm(dossier.name) && !labelsOf(dossier).some(label => norm(label) === norm(name))) {
                // A role-labelled dossier is promoted to its revealed proper name (old label kept as
                // alias by the merge); a named dossier only gains the new name as an alias.
                if (dossier.identityKind === 'role_label') { row.name = name; row.identityKind = 'proper_name'; row.aliases = [dossier.name]; }
                else row.aliases = [name];
            }
        }
        if (gender && !(row.id && live.find(npc => npc.id === row.id)?.gender)) row.gender = gender;
        if (person?.present === true) row.present = true;
        if (roles.length) row.roles = roles;
        if (person?.sheet && typeof person.sheet === 'object') {
            const grounded = groundSheetDelta(person.sheet, transcript);
            for (const label of grounded.rejected) report.rejected.push({ ref, reason: `sheet ${label} not in exchange` });
            if (!sheetDeltaIsEmpty(grounded.delta)) row.sheetDelta = grounded.delta;
        }
        if (person?.present === true) presentLabels.push(ref, row.name, ...(row.id ? [row.id] : []), ...(name ? [name] : []));
        if ((person?.memory && typeof person.memory === 'object') || Array.isArray(person?.intents)) {
            const decision = readMemoryDecision(person, { transcript, npc: row.id ? live.find(npc => npc.id === row.id) : null });
            for (const reason of decision.rejected) report.rejected.push({ ref, reason: `memory ${reason}` });
            if (decision.ops.length || decision.intents.length) row.memoryDecision = { ops: decision.ops, intents: decision.intents };
        }
        row.matchLabels = [...new Set([...(row.matchLabels || []), stripArticle(ref), ...(name ? [name] : [])])];
        rows.push(row);
        nameOf.set(norm(ref), row.name);
        if (name) nameOf.set(norm(name), row.name);
        report.accepted.push({ ref, is, name: row.name });

        for (const tie of (Array.isArray(person?.ties) ? person.ties : []).slice(0, 4)) {
            const relation = cleanText(tie?.is, 120);
            const anchorLabel = cleanText(tie?.of, 160);
            if (!relation || !anchorLabel) continue;
            const tieGender = impliedGender(relation);
            const personGender = gender || live.find(npc => npc.id === row.id)?.gender || '';
            if (tieGender && personGender && tieGender !== personGender) {
                report.rejected.push({ ref, reason: `tie "${relation}" contradicts gender ${personGender}` });
                continue;
            }
            const anchor = live.find(npc => labelsOf(npc).some(label => norm(label) === norm(anchorLabel)));
            const anchorName = anchor?.name || nameOf.get(norm(anchorLabel)) || anchorLabel;
            if (excluded.has(norm(anchorName)) || norm(anchorName) === norm(row.name)) continue;
            // NSD edge convention: aToB is b's role to a. "<person> IS <tie> OF <anchor>".
            edges.push({ a: anchorName, b: row.name, aToB: relation, reason: `cast: ${ref}` });
        }
    }

    const knowledge = new Map();
    for (const item of Array.isArray(parsed?.knowledge) ? parsed.knowledge : []) {
        const who = cleanText(item?.who, 160);
        if (!who) continue;
        const dossier = live.find(npc => npc.id === who || labelsOf(npc).some(label => norm(label) === norm(who)));
        const key = dossier ? dossier.id : `name:${norm(nameOf.get(norm(who)) || who)}`;
        const entries = readScanKnowledge({ knowledge: [item] });
        if (!entries.length) continue;
        const list = knowledge.get(key) || [];
        if (list.length < KNOWLEDGE_NEW_PER_SCAN) knowledge.set(key, [...list, ...entries].slice(0, KNOWLEDGE_NEW_PER_SCAN));
    }
    // Shared events: witnesses must be present; labels resolve to the names rows were stored under.
    const events = readEventDecisions(parsed, { transcript, present: presentLabels, npcs: live, userName });
    for (const reason of events.rejected) report.rejected.push({ ref: 'events', reason });
    const named = who => nameOf.get(norm(who)) || who;
    for (const event of events.events) {
        event.witnesses = [...new Set(event.witnesses.map(named))];
        for (const view of event.views) view.who = named(view.who);
    }
    for (const tell of events.told) { tell.by = named(tell.by); tell.to = named(tell.to); }
    return { npcs: rows, keyRelationshipEdges: edges, knowledge, events: { events: events.events, told: events.told }, report };
}

// Folds cast rows into the broad scanner's parsed result. A row for an NPC the scanner already
// returned is merged into that row (the merge reads `present` per row, so a duplicate row would
// undo the scanner's presence); other rows are appended. Edges are appended.
export function mergeCastIntoScan(parsed, cast) {
    const base = parsed && typeof parsed === 'object' ? parsed : {};
    const rows = (Array.isArray(base.npcs) ? base.npcs : []).map(row => ({ ...row }));
    // The broad scanner may have recorded the same person in this turn under a title ("Deputy
    // Headmistress") or a short name ("Filch"): match on any label either side knows.
    const labelsOfItem = item => new Set([item.name, ...(item.aliases || []), ...(item.matchLabels || []),
        ...(item.roles || []).flatMap(role => [role.title, role.org ? `${role.title} of ${role.org}` : ''])].map(stripArticle).map(norm).filter(Boolean));
    const sameRow = (row, item) => {
        if (item.id && row.id === item.id) return true;
        const mine = labelsOfItem(item);
        return [row.name, ...(row.aliases || [])].map(stripArticle).map(norm).some(label => mine.has(label));
    };
    for (const raw of cast?.npcs || []) {
        const { matchLabels, ...item } = raw;
        const index = rows.findIndex(row => sameRow(row, raw));
        if (index < 0) { rows.push({ ...item }); continue; }
        const row = rows[index];
        if (!row.id && item.id) row.id = item.id;
        if (item.identityKind === 'proper_name' && item.name && norm(item.name) !== norm(row.name)) {
            row.aliases = [...new Set([...(row.aliases || []), row.name, ...(item.aliases || [])])];
            row.name = item.name;
            row.identityKind = 'proper_name';
            row.sameIndividual = true;
        } else if (item.aliases?.length) {
            row.aliases = [...new Set([...(row.aliases || []), ...item.aliases])];
        }
        if (item.present === true) row.present = true;
        if (item.gender && !row.gender) row.gender = item.gender;
        if (item.roles?.length) row.roles = [...(row.roles || []), ...item.roles];
        if (item.canonRef && !row.canonRef) row.canonRef = item.canonRef;
        if (item.sheetDelta) row.sheetDelta = item.sheetDelta;
        if (item.memoryDecision) row.memoryDecision = item.memoryDecision;
    }
    const edges = [...(Array.isArray(base.keyRelationshipEdges) ? base.keyRelationshipEdges : []), ...(cast?.keyRelationshipEdges || [])];
    return { ...base, npcs: rows, keyRelationshipEdges: edges };
}

// After the merge, name-keyed knowledge (people created in this scan) resolves to real ids.
export function resolveKnowledgeKeys(knowledge, npcs) {
    const out = new Map();
    for (const [key, entries] of knowledge || []) {
        if (!key.startsWith('name:')) { out.set(key, entries); continue; }
        const label = key.slice(5);
        const npc = (npcs || []).find(item => item && labelsOf(item).some(name => norm(name) === label));
        if (npc) out.set(npc.id, [...(out.get(npc.id) || []), ...entries]);
    }
    return out;
}
