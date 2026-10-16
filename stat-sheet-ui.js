/* NPC Codex Stat tab: a read-only view of the selected NPC's stat sheet (the "what"), beside the
   Dossier ("who") and Map views. It renders the dossier panel's own projection and never writes
   dossier data; edits go through the dossier editor. */
import { normalizeSheet, sheetIsEmpty } from './sheet.js';

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function section(title, body, empty) {
    return `<section class="delta-stat-section"><h3>${escapeHtml(title)}</h3>${body || `<p class="delta-stat-empty">${escapeHtml(empty)}</p>`}</section>`;
}

function list(items, render) {
    return items.length ? `<ul class="delta-stat-list">${items.map(item => `<li>${render(item)}</li>`).join('')}</ul>` : '';
}

const since = item => (Number.isInteger(item?.since) ? `<small class="delta-stat-since">turn ${item.since}</small>` : '');

function poolBar(pool) {
    const max = Number(pool.max);
    const current = Number(pool.current);
    const pct = Number.isFinite(max) && max > 0 && Number.isFinite(current) ? Math.max(0, Math.min(100, Math.round((current / max) * 100))) : null;
    const value = `${pool.current ?? '?'}${pool.max != null ? ` / ${pool.max}` : ''}`;
    return `<div class="delta-stat-pool"><span>${escapeHtml(pool.name)}</span><b>${escapeHtml(value)}</b>${pct == null ? '' : `<div class="delta-stat-bar" role="meter" aria-valuemin="0" aria-valuemax="${escapeHtml(max)}" aria-valuenow="${escapeHtml(current)}" aria-label="${escapeHtml(pool.name)}"><i style="width:${pct}%"></i></div>`}</div>`;
}

export function statPaneHtml(npc) {
    if (!npc) return '<div class="delta-stat-empty-pane">Select an NPC to see their stat sheet.</div>';
    const sheet = normalizeSheet(npc.sheet);
    const header = `<header class="delta-stat-head"><span class="delta-kicker">STAT SHEET</span><h2>${escapeHtml(npc.name)}</h2>${sheet.archetype || sheet.rank ? `<p>${escapeHtml([sheet.archetype, sheet.rank].filter(Boolean).join(' · '))}</p>` : ''}</header>`;
    if (sheetIsEmpty(sheet)) {
        return `${header}<p class="delta-stat-empty">Nothing established yet. Stats, items and conditions are recorded only when the story states them; you can also add them in Edit dossier.</p>`;
    }
    const attributes = sheet.attributes.length
        ? `<div class="delta-stat-attributes">${sheet.attributes.map(item => `<div><span>${escapeHtml(item.name)}</span><b>${escapeHtml(item.value)}</b></div>`).join('')}</div>`
        : '';
    const pools = sheet.pools.length ? `<div class="delta-stat-pools">${sheet.pools.map(poolBar).join('')}</div>` : '';
    const conditions = list(sheet.conditions, item => `<span class="delta-stat-tag" data-kind="${escapeHtml(item.kind)}">${escapeHtml(item.kind)}</span> ${escapeHtml(item.name)}${item.severity ? ` <em>(${escapeHtml(item.severity)})</em>` : ''}${item.until ? ` <small>until ${escapeHtml(item.until)}</small>` : ''} ${since(item)}`);
    const equipped = sheet.equipped.length
        ? `<table class="delta-stat-table"><tbody>${sheet.equipped.map(item => `<tr><th>${escapeHtml(item.slot || '—')}</th><td>${escapeHtml(item.item)}${item.notes ? ` <small>${escapeHtml(item.notes)}</small>` : ''}</td><td>${since(item)}</td></tr>`).join('')}</tbody></table>`
        : '';
    const keyItems = list(sheet.keyItems, item => `<b>${escapeHtml(item.item)}</b>${item.significance ? ` — ${escapeHtml(item.significance)}` : ''} ${since(item)}`);
    const spells = list(sheet.spells, item => `${escapeHtml(item.name)}${item.school || item.tier ? ` <small>${escapeHtml([item.school, item.tier].filter(Boolean).join(', '))}</small>` : ''}`);
    const skills = list(sheet.skills, item => `${escapeHtml(item.name)}${item.proficiency ? ` <small>${escapeHtml(item.proficiency)}</small>` : ''}`);
    const log = list(sheet.itemLog.slice().reverse(), item => `<span class="delta-stat-tag">${escapeHtml(item.op)}</span> ${escapeHtml(item.item)} ${since(item)}`);
    return `${header}<div class="delta-stat-grid">
        ${section('Condition', conditions, 'No conditions recorded.')}
        ${section('Pools', pools, 'No pools stated.')}
        ${section('Attributes', attributes, 'No attributes stated.')}
        ${section('Equipped', equipped, 'Nothing equipped on record.')}
        ${section('Key items', keyItems, 'No key items.')}
        ${section('Spells', spells, 'No spells recorded.')}
        ${section('Skills', skills, 'No skills recorded.')}
        ${section('Recent item events', log, 'No item events yet.')}
    </div>`;
}

export function statSheetStyles(rootId) {
    const r = `#${rootId}`;
    return `
${r} .delta-stat-pane { min-width:0; min-height:0; overflow:auto; padding:14px 18px; background:var(--delta-bg); }
${r} .delta-spread.delta-stat-mode > .delta-document { display:none; }
${r} .delta-stat-head h2 { margin:2px 0 4px; }
${r} .delta-stat-head p { margin:0 0 10px; color:var(--delta-muted); }
${r} .delta-stat-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; }
${r} .delta-stat-section { padding:10px 12px; border:1px solid var(--delta-line); border-radius:9px; background:rgba(0,0,0,.14); }
${r} .delta-stat-section h3 { margin:0 0 8px; font-size:.86rem; letter-spacing:.04em; text-transform:uppercase; color:var(--delta-accent-soft); }
${r} .delta-stat-empty, ${r} .delta-stat-empty-pane { color:var(--delta-muted); font-size:.85rem; margin:0; }
${r} .delta-stat-list { margin:0; padding-left:18px; display:grid; gap:4px; }
${r} .delta-stat-since { color:var(--delta-muted); margin-left:4px; }
${r} .delta-stat-tag { display:inline-block; padding:0 6px; border-radius:6px; font-size:.72rem; background:rgba(216,188,120,.16); color:var(--delta-accent-soft); }
${r} .delta-stat-tag[data-kind="injury"], ${r} .delta-stat-tag[data-kind="illness"], ${r} .delta-stat-tag[data-kind="curse"], ${r} .delta-stat-tag[data-kind="debuff"] { background:rgba(200,90,80,.2); color:#f0b4ac; }
${r} .delta-stat-attributes { display:grid; grid-template-columns:repeat(auto-fill,minmax(70px,1fr)); gap:6px; }
${r} .delta-stat-attributes div { display:grid; place-items:center; padding:6px; border:1px solid var(--delta-line); border-radius:7px; }
${r} .delta-stat-attributes span { font-size:.72rem; color:var(--delta-muted); }
${r} .delta-stat-pools { display:grid; gap:8px; }
${r} .delta-stat-pool { display:grid; grid-template-columns:1fr auto; gap:3px 8px; align-items:center; }
${r} .delta-stat-bar { grid-column:1 / -1; height:7px; border-radius:4px; background:rgba(255,255,255,.08); overflow:hidden; }
${r} .delta-stat-bar i { display:block; height:100%; background:var(--delta-accent); }
${r} .delta-stat-table { width:100%; border-collapse:collapse; font-size:.86rem; }
${r} .delta-stat-table th { text-align:left; padding:3px 8px 3px 0; color:var(--delta-muted); font-weight:500; white-space:nowrap; }
${r} .delta-stat-table td { padding:3px 0; }
@media (max-width: 650px) { ${r} .delta-stat-grid { grid-template-columns:1fr; } }
`;
}
