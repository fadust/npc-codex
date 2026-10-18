/* NPC Codex Stat tab (the "what"), laid out after the user's mockup: a header strip (name, role,
   faction / location / race / occupation chips), Core Attributes (level, resource pools, the
   world's attribute set), Skills, Magic / Techniques, Active and Passive Status, plus equipment
   and key items. Every value is editable in place; edits go through NPCStateDelta.updateSheet and
   do not lock the sheet, so story updates keep landing on top. The world schema (S2.13) supplies
   the attribute and pool names when the world defines them. */
import { normalizeSheet } from './sheet.js';
import { statusStateText } from './status.js';

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

export const DEFAULT_ATTRIBUTES = Object.freeze(['Strength', 'Agility', 'Endurance', 'Intelligence', 'Wisdom', 'Charisma', 'Luck']);
export const DEFAULT_POOLS = Object.freeze(['HP', 'MP', 'Stamina']);
const ICONS = {
    level: '▲', hp: '♥', mp: '✦', stamina: '➶', strength: '⚔', agility: '➹', endurance: '⛨', intelligence: '✎',
    wisdom: '◉', charisma: '❖', luck: '♣', skills: '⚒', magic: '✧', active: '⚡', passive: '★', gear: '⛉',
};
const icon = name => `<span class="delta-stat-icon" aria-hidden="true">${ICONS[String(name).toLowerCase()] || '◆'}</span>`;
const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// The editable tables: column -> sheet key. The first column is the row's required name.
export const STAT_TABLES = Object.freeze({
    skills: { title: 'Skills', icon: 'skills', add: 'Add Skill', empty: 'No skills added yet.', columns: [['Name', 'name'], ['Level', 'level'], ['Proficiency', 'proficiency'], ['Note', 'note']], blank: 'New skill' },
    spells: { title: 'Magic / Techniques', icon: 'magic', add: 'Add Magic', empty: 'No magic or techniques added yet.', columns: [['Name', 'name'], ['Level', 'tier'], ['Type', 'school'], ['Note', 'note']], blank: 'New technique' },
    conditions: { title: 'Active Status', icon: 'active', add: 'Add Status', empty: 'No active status.', columns: [['Status', 'name'], ['Source', 'source'], ['Duration', 'until'], ['Effect', 'effect']], blank: 'New status' },
    passives: { title: 'Passive Status', icon: 'passive', add: 'Add Passive', empty: 'No passive status.', columns: [['Status', 'name'], ['Type', 'type'], ['Effect / Description', 'effect']], blank: 'New passive' },
    equipped: { title: 'Equipped', icon: 'gear', add: 'Add Gear', empty: 'Nothing equipped on record.', columns: [['Item', 'item'], ['Slot', 'slot'], ['Note', 'notes']], blank: 'New item' },
    keyItems: { title: 'Key Items', icon: 'gear', add: 'Add Item', empty: 'No key items.', columns: [['Item', 'item'], ['Significance', 'significance']], blank: 'New item' },
});

function input(path, value, { label, placeholder = '—', type = 'text', cls = '' } = {}) {
    return `<input class="delta-stat-input ${cls}" type="${type}" data-stat-path="${escapeHtml(path)}" value="${escapeHtml(value ?? '')}" placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(label || path)}">`;
}

function poolRow(name, pool) {
    const current = pool?.current ?? '';
    const max = pool?.max ?? '';
    const pct = Number(max) > 0 && Number.isFinite(Number(current)) && current !== '' ? Math.max(0, Math.min(100, Math.round((Number(current) / Number(max)) * 100))) : null;
    return `<div class="delta-stat-cell delta-stat-pool">${icon(name)}<span class="delta-stat-label">${escapeHtml(name)}</span>
        <span class="delta-stat-pool-values">${input(`pool:${name}:current`, current, { label: `${name} current`, placeholder: '', type: 'number' })}<i>/</i>${input(`pool:${name}:max`, max, { label: `${name} max`, placeholder: '—', type: 'number', cls: 'delta-stat-max' })}</span>
        ${pct == null ? '' : `<span class="delta-stat-bar" role="meter" aria-valuemin="0" aria-valuemax="${escapeHtml(max)}" aria-valuenow="${escapeHtml(current)}" aria-label="${escapeHtml(name)}"><b style="width:${pct}%"></b></span>`}</div>`;
}

function table(key, rows) {
    const spec = STAT_TABLES[key];
    const state = key === 'conditions';
    const head = spec.columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join('') + (state ? '<th>State</th>' : '') + '<th aria-label="Remove"></th>';
    const body = rows.map((row, index) => `<tr>${spec.columns.map(([label, field]) => `<td>${input(`${key}:${index}:${field}`, row[field], { label, placeholder: field === spec.columns[0][1] ? '' : '—' })}</td>`).join('')}${state ? `<td class="delta-stat-state">${escapeHtml(statusStateText(row))}</td>` : ''}<td><button type="button" class="delta-stat-remove" data-stat-remove="${key}:${index}" aria-label="Remove ${escapeHtml(row[spec.columns[0][1]])}" title="Remove">×</button></td></tr>`).join('');
    return `<section class="delta-stat-card" data-stat-table="${key}">
        <header>${icon(spec.icon)}<h3>${escapeHtml(spec.title)}</h3><button type="button" class="delta-stat-add" data-stat-add="${key}">＋ ${escapeHtml(spec.add)}</button></header>
        <table class="delta-stat-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
        ${rows.length ? '' : `<p class="delta-stat-empty">${escapeHtml(spec.empty)}</p>`}
    </section>`;
}

export function statPaneHtml(npc, { schema = null } = {}) {
    if (!npc) return '<div class="delta-stat-empty-pane">Select an NPC to see their stat sheet.</div>';
    const sheet = normalizeSheet(npc.sheet);
    const chips = [['Faction', npc.faction], ['Location', npc.location], ['Race', npc.species], ['Occupation', npc.role]]
        .map(([label, value]) => `<span class="delta-stat-chip${value ? '' : ' is-empty'}" title="${escapeHtml(label)}"><small>${escapeHtml(label)}</small>${value ? ` ${escapeHtml(value)}` : ''}</span>`).join('');
    const header = `<header class="delta-stat-head" data-npc-id="${escapeHtml(npc.id)}">
        <div><h2>${escapeHtml(npc.name)}</h2><p>${escapeHtml([sheet.archetype, npc.role].filter(Boolean).join(' · ') || 'No role or title yet')}</p></div>
        <div class="delta-stat-chips">${chips}</div></header>`;

    const attributeNames = [...(schema?.attributes?.length ? schema.attributes : DEFAULT_ATTRIBUTES)];
    for (const item of sheet.attributes) if (!attributeNames.some(name => sameName(name, item.name))) attributeNames.push(item.name);
    const poolNames = [...(schema?.pools?.length ? schema.pools : DEFAULT_POOLS)];
    for (const pool of sheet.pools) if (!poolNames.some(name => sameName(name, pool.name))) poolNames.push(pool.name);
    const rankList = schema?.ranks?.length ? `<datalist id="delta-stat-ranks-${escapeHtml(npc.id)}">${schema.ranks.map(rank => `<option value="${escapeHtml(rank)}"></option>`).join('')}</datalist>` : '';
    const level = `<div class="delta-stat-cell delta-stat-level">${icon('level')}<span class="delta-stat-label">Level</span>${input('rank', sheet.rank, { label: 'Level or rank', placeholder: schema?.ranks?.length ? schema.ranks.join(' < ') : '—' }).replace('<input ', rankList ? `<input list="delta-stat-ranks-${escapeHtml(npc.id)}" ` : '<input ')}${rankList}</div>`;
    const pools = poolNames.map(name => poolRow(name, sheet.pools.find(pool => sameName(pool.name, name)))).join('');
    const attributes = attributeNames.map(name => `<div class="delta-stat-cell">${icon(name)}<span class="delta-stat-label">${escapeHtml(name)}</span>${input(`attr:${name}`, sheet.attributes.find(item => sameName(item.name, name))?.value, { label: name })}</div>`).join('');
    const derived = sheet.derivation ? `derived: ${[sheet.derivation.race + (sheet.derivation.assumedRace ? ' (assumed)' : ''), sheet.derivation.profession, sheet.derivation.rank && `rank ${sheet.derivation.rank}`].filter(Boolean).join(' · ')}` : '';
    const limits = (sheet.restrictions || []).map(item => `<span class="delta-stat-chip">${escapeHtml(item)}</span>`).join('');
    const core = `<section class="delta-stat-card delta-stat-core"><header>${icon('level')}<h3>Core Attributes</h3>${limits}${schema ? '<small class="delta-stat-schema">world schema</small>' : (derived ? `<small class="delta-stat-schema">${escapeHtml(derived)}</small>` : '')}</header>
        <div class="delta-stat-core-grid"><div class="delta-stat-core-left">${level}${pools}</div><div class="delta-stat-core-attrs">${attributes}</div></div></section>`;

    const log = sheet.itemLog.slice(-6).reverse().map(item => `<li><span class="delta-stat-tag">${escapeHtml(item.op)}</span> ${escapeHtml(item.item)}${Number.isInteger(item.since) ? ` <small>turn ${item.since}</small>` : ''}</li>`).join('');
    return `${header}${core}
        <div class="delta-stat-columns">${table('skills', sheet.skills)}${table('spells', sheet.spells)}</div>
        <div class="delta-stat-columns">${table('conditions', sheet.conditions)}${table('passives', sheet.passives)}</div>
        <div class="delta-stat-columns">${table('equipped', sheet.equipped)}${table('keyItems', sheet.keyItems)}</div>
        ${log ? `<section class="delta-stat-card delta-stat-log"><header><h3>Recent item events</h3></header><ul>${log}</ul></section>` : ''}`;
}

/* ---------- Edits: pure helpers, wired by the dossier panel ---------- */

// Applies one field edit ("attr:Strength", "pool:HP:max", "rank", "skills:2:level") to a sheet.
export function applyStatEdit(sheetRaw, path, rawValue) {
    const sheet = normalizeSheet(sheetRaw);
    const value = String(rawValue ?? '').trim();
    const parts = String(path || '').split(':');
    if (parts[0] === 'rank') return { ...sheet, rank: value };
    if (parts[0] === 'attr') {
        const name = parts.slice(1).join(':');
        const rest = sheet.attributes.filter(item => !sameName(item.name, name));
        return { ...sheet, attributes: value ? [...rest, { name, value }] : rest };
    }
    if (parts[0] === 'pool') {
        const [, name, field] = parts;
        const current = sheet.pools.find(pool => sameName(pool.name, name)) || { name };
        const next = { ...current, [field]: value === '' ? undefined : Number(value) };
        const rest = sheet.pools.filter(pool => !sameName(pool.name, name));
        return { ...sheet, pools: next.current == null && next.max == null ? rest : [...rest, next] };
    }
    const [key, indexText, field] = parts;
    if (!STAT_TABLES[key] || !Array.isArray(sheet[key])) return sheet;
    const index = Number(indexText);
    const rows = sheet[key].map((row, i) => (i === index ? { ...row, [field]: value } : row));
    return { ...sheet, [key]: rows };
}

export function addStatRow(sheetRaw, key) {
    const sheet = normalizeSheet(sheetRaw);
    const spec = STAT_TABLES[key];
    if (!spec) return sheet;
    return { ...sheet, [key]: [...sheet[key], { [spec.columns[0][1]]: spec.blank }] };
}

export function removeStatRow(sheetRaw, key, index) {
    const sheet = normalizeSheet(sheetRaw);
    if (!STAT_TABLES[key]) return sheet;
    return { ...sheet, [key]: sheet[key].filter((row, i) => i !== Number(index)) };
}

export function statSheetStyles(rootId) {
    const r = `#${rootId}`;
    return `
${r} .delta-stat-pane { min-width:0; min-height:0; overflow:auto; padding:14px 16px 18px; background:var(--delta-bg); display:grid; gap:12px; align-content:start; }
${r} .delta-spread.delta-stat-mode > .delta-document { display:none; }
${r} .delta-stat-head { display:flex; flex-wrap:wrap; align-items:flex-end; justify-content:space-between; gap:8px 16px; }
${r} .delta-stat-head h2 { margin:0; font-size:1.35rem; }
${r} .delta-stat-head p { margin:2px 0 0; color:var(--delta-muted); font-size:.85rem; }
${r} .delta-stat-chips { display:flex; flex-wrap:wrap; gap:6px; }
${r} .delta-stat-chip { padding:4px 10px; border:1px solid var(--delta-line); border-radius:8px; font-size:.8rem; background:rgba(255,255,255,.03); }
${r} .delta-stat-chip small { color:var(--delta-muted); }
${r} .delta-stat-chip.is-empty { opacity:.55; }
${r} .delta-stat-card { min-width:0; padding:10px 12px 12px; border:1px solid var(--delta-line); border-radius:10px; background:rgba(0,0,0,.16); }
${r} .delta-stat-card > header { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
${r} .delta-stat-card h3 { margin:0; font-size:1rem; font-weight:600; }
${r} .delta-stat-schema { margin-left:auto; color:var(--delta-accent-soft); font-size:.72rem; letter-spacing:.04em; text-transform:uppercase; }
${r} .delta-stat-icon { display:inline-grid; place-items:center; width:1.4em; color:var(--delta-accent-soft); }
${r} .delta-stat-add { margin-left:auto; padding:4px 10px; border:1px solid var(--delta-line); border-radius:8px; color:inherit; background:rgba(255,255,255,.04); font-size:.8rem; cursor:pointer; }
${r} .delta-stat-add:hover, ${r} .delta-stat-remove:hover { border-color:var(--delta-accent); }
${r} .delta-stat-core-grid { display:grid; grid-template-columns:minmax(220px,1fr) minmax(0,2fr); gap:8px; }
${r} .delta-stat-core-left, ${r} .delta-stat-core-attrs { display:grid; gap:6px; align-content:start; }
${r} .delta-stat-core-attrs { grid-template-columns:repeat(auto-fill,minmax(190px,1fr)); }
${r} .delta-stat-cell { display:grid; grid-template-columns:auto minmax(0,1fr) minmax(70px,1fr); align-items:center; gap:6px; padding:6px 8px; border-radius:8px; background:rgba(255,255,255,.035); }
${r} .delta-stat-label { font-size:.86rem; }
${r} .delta-stat-input { width:100%; min-width:0; box-sizing:border-box; padding:4px 7px; border:1px solid var(--delta-line); border-radius:6px; color:inherit; background:rgba(0,0,0,.25); font:inherit; font-size:.85rem; }
${r} .delta-stat-input:focus { outline:none; border-color:var(--delta-accent); }
${r} .delta-stat-pool { grid-template-columns:auto minmax(0,1fr) minmax(120px,1.4fr); }
${r} .delta-stat-pool-values { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:4px; }
${r} .delta-stat-pool-values i { color:var(--delta-muted); font-style:normal; }
${r} .delta-stat-bar { grid-column:1 / -1; height:5px; border-radius:3px; background:rgba(255,255,255,.08); overflow:hidden; }
${r} .delta-stat-bar b { display:block; height:100%; background:var(--delta-accent); }
${r} .delta-stat-columns { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:12px; }
${r} .delta-stat-table { width:100%; border-collapse:collapse; table-layout:fixed; font-size:.84rem; }
${r} .delta-stat-table th { text-align:left; padding:4px 4px 6px; color:var(--delta-muted); font-weight:500; border-bottom:1px solid var(--delta-line); }
${r} .delta-stat-table th:last-child { width:26px; }
${r} .delta-stat-table td { padding:3px 2px; }
${r} .delta-stat-table .delta-stat-input { border-color:transparent; background:transparent; }
${r} .delta-stat-table .delta-stat-input:hover, ${r} .delta-stat-table .delta-stat-input:focus { border-color:var(--delta-line); background:rgba(0,0,0,.25); }
${r} .delta-stat-remove { width:22px; height:22px; padding:0; border:1px solid transparent; border-radius:6px; color:var(--delta-muted); background:none; cursor:pointer; }
${r} .delta-stat-empty, ${r} .delta-stat-empty-pane { margin:10px 0 2px; text-align:center; color:var(--delta-muted); font-size:.85rem; }
${r} .delta-stat-log ul { margin:0; padding-left:18px; display:grid; gap:3px; font-size:.84rem; }
${r} .delta-stat-log small { color:var(--delta-muted); }
${r} .delta-stat-state { color:var(--delta-muted); font-size:.78rem; }
${r} .delta-stat-tag { display:inline-block; padding:0 6px; border-radius:6px; font-size:.72rem; background:rgba(91,201,189,.16); color:var(--delta-accent-soft); }
@media (max-width: 760px) { ${r} .delta-stat-core-grid { grid-template-columns:1fr; } ${r} .delta-stat-columns { grid-template-columns:1fr; } }
`;
}
