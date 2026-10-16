/* NPC Codex: Floris readout ingest (spec S4.3 / S8.3, fadust fork).
 *
 * The Floris preset may append a <log> after the prose with per-NPC trackers:
 *   [Bond: Kai ↔ Sera | Stage: Wary Allies | Affection: 55% | Fear: 10% | Trust: 40% | Yearning: 30% · Shift: +5 trust, kept his word]
 *   [Feel: Sera | T2 F3 D1 Y2 · fear of being left behind]   (Tenderness, Fury, Dread, Yearning; 0-4, 2 = baseline)
 *
 * NPC Codex treats these as a READOUT: input for the model's thinking, never as truth. They are
 * parsed deterministically (no model call), the latest per NPC is kept on the dossier, shown to
 * the cast pass as a hint and injected for present NPCs. NPC Codex's own relationship numbers are
 * never overwritten by them, and the <log> block is not story evidence.
 *
 * Pure module: no host, DOM or storage access. */

const LOG_BLOCK = /<log>[\s\S]*?(?:<\/log>|$)/gi;
const BOND = /\[Bond:\s*([^\]]*)\]/gi;
const FEEL = /\[Feel:\s*([^\]]*)\]/gi;
const FEEL_AXES = { T: 'tenderness', F: 'fury', D: 'dread', Y: 'yearning' };

function cleanText(value, max) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function norm(value) {
    return cleanText(value, 200).toLowerCase();
}

export function stripFlorisLog(text) {
    return String(text || '').replace(LOG_BLOCK, ' ').trim();
}

// "Kai ↔ Sera | Stage: X | Affection: 55% | ... · Shift: +5 trust, reason"
function parseBond(body, userName) {
    const [main, shift = ''] = body.split(/\s·\s|·/);
    const parts = main.split('|').map(part => part.trim()).filter(Boolean);
    const pair = parts.shift() || '';
    const names = pair.split(/\s*(?:↔|<->|<=>|&)\s*/).map(name => cleanText(name, 80)).filter(Boolean);
    const name = names.find(item => !userName || norm(item) !== norm(userName)) || names[1] || '';
    if (!name || /^character$/i.test(name)) return null;
    const bond = { name, values: {} };
    for (const part of parts) {
        const [label, value] = part.split(/:\s*/);
        if (!label || value === undefined) continue;
        if (/^stage$/i.test(label.trim())) { bond.stage = cleanText(value, 60); continue; }
        const number = Number(String(value).replace('%', '').trim());
        if (Number.isFinite(number)) bond.values[cleanText(label, 24).toLowerCase()] = Math.max(0, Math.min(100, Math.round(number)));
    }
    const reason = cleanText(shift.replace(/^shift:\s*/i, ''), 140);
    if (reason) bond.shift = reason;
    return Object.keys(bond.values).length || bond.stage ? bond : null;
}

// "Sera | T2 F3 D1 Y2 · hides ..." or "Sera — T2 F3 D1 Y2 · ..."
function parseFeel(body) {
    const [main, hidden = ''] = body.split(/\s·\s|·/);
    const match = main.match(/^(.*?)\s*(?:\||—|-|:)\s*(.*)$/);
    const name = cleanText(match ? match[1] : '', 80);
    if (!name) return null;
    const feel = { name, levels: {} };
    for (const [, letter, level] of String(match[2] || '').matchAll(/\b([TFDY])\s*(\d)\b/g)) {
        feel.levels[FEEL_AXES[letter]] = Math.max(0, Math.min(4, Number(level)));
    }
    const hides = cleanText(hidden, 140);
    if (hides) feel.hidden = hides;
    return Object.keys(feel.levels).length ? feel : null;
}

export function parseFlorisReadout(text, { userName = '' } = {}) {
    const source = String(text || '');
    const bonds = [...source.matchAll(BOND)].map(match => parseBond(match[1], userName)).filter(Boolean);
    const feels = [...source.matchAll(FEEL)].map(match => parseFeel(match[1])).filter(Boolean);
    return { bonds, feels };
}

function labelsOf(npc) {
    return [npc?.name, ...(Array.isArray(npc?.aliases) ? npc.aliases : [])].map(norm).filter(Boolean);
}

function matchNpc(npcs, name) {
    const key = norm(name);
    return (npcs || []).find(npc => npc && !npc.archived && labelsOf(npc).some(label => label === key || label.split(' ')[0] === key || key.split(' ')[0] === label));
}

// Attaches the latest readout to each named NPC. Returns { npcs, applied }.
export function applyFlorisReadout(npcs, readout, { turn = null, sourceMessageId = null } = {}) {
    let list = Array.isArray(npcs) ? [...npcs] : [];
    let applied = 0;
    const stamp = { ...(Number.isInteger(turn) ? { turn } : {}), ...(Number.isInteger(sourceMessageId) ? { sourceMessageId } : {}) };
    const update = (name, key, value) => {
        const npc = matchNpc(list, name);
        if (!npc) return;
        const { name: _ignored, ...rest } = value;
        list = list.map(item => item === npc ? { ...npc, floris: { ...(npc.floris || {}), [key]: rest, ...stamp } } : item);
        applied += 1;
    };
    for (const bond of readout?.bonds || []) update(bond.name, 'bond', bond);
    for (const feel of readout?.feels || []) update(feel.name, 'feel', feel);
    return { npcs: list, applied };
}

export function normalizeFloris(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    if (raw.bond && typeof raw.bond === 'object') out.bond = { ...(raw.bond.stage ? { stage: cleanText(raw.bond.stage, 60) } : {}), values: raw.bond.values && typeof raw.bond.values === 'object' ? raw.bond.values : {}, ...(raw.bond.shift ? { shift: cleanText(raw.bond.shift, 140) } : {}) };
    if (raw.feel && typeof raw.feel === 'object') out.feel = { levels: raw.feel.levels && typeof raw.feel.levels === 'object' ? raw.feel.levels : {}, ...(raw.feel.hidden ? { hidden: cleanText(raw.feel.hidden, 140) } : {}) };
    if (Number.isInteger(raw.turn)) out.turn = raw.turn;
    if (Number.isInteger(raw.sourceMessageId)) out.sourceMessageId = raw.sourceMessageId;
    return out.bond || out.feel ? out : null;
}

const LEVEL_WORD = ['very low', 'low', 'baseline', 'high', 'very high'];

// Short, qualitative; feelings at baseline are omitted.
export function renderFlorisReadout(npc) {
    const floris = normalizeFloris(npc?.floris);
    if (!floris) return '';
    const parts = [];
    if (floris.bond) {
        const values = Object.entries(floris.bond.values).map(([label, value]) => `${label} ${value}%`).join(', ');
        parts.push([floris.bond.stage && `stage ${floris.bond.stage}`, values].filter(Boolean).join('; '));
    }
    if (floris.feel) {
        const levels = Object.entries(floris.feel.levels).filter(([, level]) => level !== 2).map(([axis, level]) => `${axis} ${LEVEL_WORD[level]}`).join(', ');
        if (levels) parts.push(levels);
        if (floris.feel.hidden) parts.push(`hides (do not reveal directly): ${floris.feel.hidden}`);
    }
    return parts.filter(Boolean).length ? `Floris readout (a hint, not fact): ${parts.filter(Boolean).join('; ')}` : '';
}
