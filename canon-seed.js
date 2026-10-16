/* NPC Codex: canon field seeding (spec S7.1/S7.2, fadust fork).
 *
 * When a dossier is first linked to a canon entry (the card's own definitions or a lorebook
 * entry), its base fields are seeded from the FULL canon text: species, gender, age, enduring
 * appearance, personality, speech and background. Every value must be grounded in that text.
 * Seeded fields are canon-locked: the story may add to them (the new value still contains the
 * canon text) or change them through an explicit event/time skip, but an ordinary scan cannot
 * overwrite them. A manual edit hands a field to the player's own lock.
 *
 * Pure module: no host, DOM or storage access. */

import { CARD_CANON_WORLD } from './cast.js';
import { groundedIn } from './sheet.js';

export const CANON_SEED_FIELDS = Object.freeze(['species', 'gender', 'age', 'apparentAge', 'overallAppearance', 'personality', 'speech', 'background', 'likes', 'dislikes']);
// Fields that stay canon-locked after seeding. Gender/age/species are identity anchors as well.
export const CANON_LOCKABLE = Object.freeze(['species', 'gender', 'overallAppearance', 'personality', 'speech', 'background']);
const LIMITS = { species: 120, gender: 10, age: 40, apparentAge: 20, overallAppearance: 500, personality: 280, speech: 240, background: 320, likes: 200, dislikes: 200 };
const CANON_TEXT_MAX = 2500;
export const CANON_SEED_PER_SCAN = 3;
const MALE_CUES = /\b(he|him|his|himself|man|boy|wizard|king|prince|father|son|brother|husband|mr|sir|lord|headmaster)\b/i;
const FEMALE_CUES = /\b(she|her|hers|herself|woman|girl|witch|queen|princess|mother|daughter|sister|wife|mrs|ms|lady|madam|headmistress)\b/i;

function cleanText(value, max) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (/^(?:unknown|not stated|n\/?a|none|null|-+)$/i.test(text)) return '';
    return text.slice(0, max);
}

function norm(value) {
    return cleanText(value, 200).toLowerCase();
}

/* ---------- Which dossiers need seeding, and from which canon text ---------- */

// Canon text for a reference: a lorebook entry's full content, or every card sentence that
// names the person (card canon is split into sentences, so one sentence is rarely enough).
export function canonTextFor(canonRef, { entries = [], cardEntries = [] } = {}) {
    if (!canonRef) return '';
    if (canonRef.world === CARD_CANON_WORLD) {
        const name = norm(canonRef.name);
        if (!name) return '';
        const sentences = [...new Set((cardEntries || []).filter(entry => norm(entry.comment) === name || String(entry.content || '').replace(/\s+/g, ' ').toLowerCase().includes(name)).map(entry => entry.content))];
        return sentences.join(' ').slice(0, CANON_TEXT_MAX);
    }
    const list = Array.isArray(entries) ? entries : [];
    const exact = list.find(entry => entry?.world === canonRef.world && Number(entry?.uid) === Number(canonRef.uid));
    const byName = canonRef.name ? list.find(entry => entry?.world === canonRef.world && norm(entry?.comment) === norm(canonRef.name)) : null;
    // Prefer the uid, but only while it still names the same person (lorebooks get edited).
    const entry = exact && (!canonRef.name || norm(exact.comment) === norm(canonRef.name)) ? exact : (byName || exact);
    return cleanText(entry?.content, CANON_TEXT_MAX);
}

// Rows from the cast pass that link a dossier (existing or new) to canon for the first time.
export function canonSeedTargets(castRows, npcs, limit = CANON_SEED_PER_SCAN) {
    const live = Array.isArray(npcs) ? npcs : [];
    const out = [];
    for (const row of Array.isArray(castRows) ? castRows : []) {
        if (!row?.canonRef) continue;
        const existing = row.id ? live.find(npc => npc?.id === row.id) : live.find(npc => norm(npc?.name) === norm(row.name));
        if (existing?.canonSeed) continue;
        if (out.some(item => norm(item.name) === norm(row.name))) continue;
        out.push({ id: existing?.id || row.id || '', name: row.name, canonRef: row.canonRef });
        if (out.length >= limit) break;
    }
    return out;
}

/* ---------- Request and validation ---------- */

// S8.5: there is no separate extractor request any more. The cast pass returns a "seed" object
// for a canon-resolved person in the same call; parseCanonSeed grounds it in the full canon text.

// Keeps only fields grounded in the canon text. Returns { fields, rejected[] }.
export function parseCanonSeed(parsed, canonText) {
    const fields = {};
    const rejected = [];
    const source = parsed && typeof parsed === 'object' ? parsed : {};
    for (const key of CANON_SEED_FIELDS) {
        const value = cleanText(source[key], LIMITS[key]);
        if (!value) continue;
        if (key === 'gender') {
            const gender = value.toLowerCase();
            // Grounded only by gendered words in the canon text itself, and only when they agree.
            const male = MALE_CUES.test(canonText);
            const female = FEMALE_CUES.test(canonText);
            if ((gender === 'male' && male && !female) || (gender === 'female' && female && !male)) fields.gender = gender;
            else rejected.push('gender');
            continue;
        }
        if (key === 'apparentAge' || key === 'age') {
            // Numbers or number words must appear in the canon text.
            if (groundedIn(canonText, value, { minRatio: 0.5 }) || String(canonText).includes(value.replace(/^~/, ''))) fields[key] = value;
            else rejected.push(key);
            continue;
        }
        // Species is a short label: every word must be in the text ("human wizard" adds "human").
        const minRatio = key === 'species' ? 1 : 0.5;
        if (groundedIn(canonText, value, { minRatio })) fields[key] = value;
        else rejected.push(key);
    }
    return { fields, rejected };
}

/* ---------- Applying a seed ---------- */

// Gendered titles only (kin words are not checked: a man's background may mention "his daughter").
// Shared card sentences tempt the extractor to hand one person's title to another ("Idris Quill,
// deputy headmistress" from "Miriam Harcourt is the headmistress, with Idris Quill as deputy").
const GENDERED_TITLES = [
    [/\b(headmistress|queen|princess|duchess|countess|baroness|empress|priestess|abbess|matriarch|lady|madam|madame|mistress)\b/i, 'female'],
    [/\b(headmaster|king|prince|duke|baron|emperor|priest|abbot|patriarch|lord|sir)\b/i, 'male'],
];

function titleContradictsGender(text, gender) {
    if (gender !== 'male' && gender !== 'female') return false;
    return GENDERED_TITLES.some(([pattern, implied]) => implied !== gender && pattern.test(String(text || '')));
}

// isNew: the dossier was created in this scan, so canon becomes its base outright. An older
// dossier only has empty fields filled: its story history is never overwritten by a late link.
export function applyCanonSeed(npc, fields, { canonRef = null, turn = null, isNew = false } = {}) {
    if (!npc || !fields) return { npc, seeded: [], dropped: [] };
    const manual = new Set(Array.isArray(npc.manualProfileFields) ? npc.manualProfileFields : []);
    const next = { ...npc };
    const seeded = [];
    const dropped = [];
    const gender = String(fields.gender || npc.gender || '').toLowerCase();
    for (const key of CANON_SEED_FIELDS) {
        const value = fields[key];
        if (!value || manual.has(key)) continue;
        if (key !== 'gender' && titleContradictsGender(value, gender)) { dropped.push(key); continue; }
        const current = String(next[key] ?? '').trim();
        if (current && !isNew) continue;
        next[key] = key === 'likes' || key === 'dislikes' ? value.split(/[;,]/).map(item => item.trim()).filter(Boolean).slice(0, 8) : value;
        seeded.push(key);
    }
    // The current outfit is story state; it only borrows canon's look while nothing else is known.
    if (seeded.includes('overallAppearance') && !String(next.appearance || '').trim()) next.appearance = fields.overallAppearance;
    next.canonLocked = [...new Set([...(Array.isArray(npc.canonLocked) ? npc.canonLocked : []), ...seeded.filter(key => CANON_LOCKABLE.includes(key))])];
    next.canonSeed = {
        ...(canonRef?.name ? { entry: canonRef.name } : {}),
        ...(canonRef?.world ? { world: canonRef.world } : {}),
        fields: seeded,
        ...(Number.isInteger(turn) ? { turn } : {}),
    };
    return { npc: next, seeded, dropped };
}

export function normalizeCanonSeed(value) {
    if (!value || typeof value !== 'object') return null;
    const fields = (Array.isArray(value.fields) ? value.fields : []).filter(key => CANON_SEED_FIELDS.includes(key));
    return {
        ...(value.entry ? { entry: cleanText(value.entry, 160) } : {}),
        ...(value.world ? { world: cleanText(value.world, 200) } : {}),
        fields,
        ...(Number.isInteger(value.turn) ? { turn: value.turn } : {}),
    };
}

export function normalizeCanonLocked(value) {
    return [...new Set((Array.isArray(value) ? value : []).filter(key => CANON_LOCKABLE.includes(key)))];
}

/* ---------- S7.2: the lock ---------- */

// After a merge: a canon-locked field may grow (the new value still contains the canon text) or
// change on an explicit event/time skip; any other change is reverted. Returns { npcs, reverted }.
export function enforceCanonLocks(beforeNpcs, afterNpcs, scanResult = {}) {
    const before = new Map((Array.isArray(beforeNpcs) ? beforeNpcs : []).filter(Boolean).map(npc => [npc.id, npc]));
    const explicit = new Set();
    const rows = [...(Array.isArray(scanResult?.npcs) ? scanResult.npcs : []), ...(Array.isArray(scanResult?.profileUpdates) ? scanResult.profileUpdates : [])];
    for (const row of rows) {
        const scale = String(row?.developmentScale ?? row?.development_scale ?? '').toLowerCase();
        if ((scale === 'explicit' || scale === 'batch') && row?.id) explicit.add(row.id);
    }
    const reverted = [];
    const npcs = (Array.isArray(afterNpcs) ? afterNpcs : []).map(npc => {
        const prior = npc && before.get(npc.id);
        const locked = normalizeCanonLocked(prior?.canonLocked);
        if (!prior || !locked.length || explicit.has(npc.id)) return npc;
        let next = npc;
        for (const key of locked) {
            const was = String(prior[key] ?? '');
            const now = String(npc[key] ?? '');
            if (now === was || (was && norm(now).includes(norm(was)))) continue;
            next = next === npc ? { ...npc } : next;
            next[key] = prior[key];
            reverted.push({ npcId: npc.id, field: key });
        }
        return next;
    });
    return { npcs, reverted };
}
