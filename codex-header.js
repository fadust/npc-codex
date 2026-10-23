/* NPC Codex: the dossier panel's shared header and list-column layout (fadust fork).
 *
 * One compact header above the Dossier / Stat / Social Map tabs: portrait, name, subtitle,
 * identity chips, user tags and a quote. Pure module: HTML and CSS strings only; the
 * relationship-map view mounts it and saves edits through the public API. */

const ICONS = { faction: '⚑', location: '⌖', race: '❦', occupation: '⚒', rank: '★', tag: '#' };

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

// "blacksmith of the guild forge; owes Kai" -> "blacksmith of the guild forge"
function occupationOf(npc) {
    return String(npc?.occupation || npc?.role || '').split(/[;,]/)[0].trim();
}

function chip(kind, label, value) {
    return `<span class="codex-chip${value ? '' : ' is-empty'}" title="${escapeHtml(label)}"><i aria-hidden="true">${ICONS[kind]}</i>${escapeHtml(value || label)}</span>`;
}

// A race the card, lore and story never state is human, the same rule the stat sheet derives from.
function raceChip(npc) {
    const race = String(npc?.species || '').trim();
    if (!/^(?:unknown|unspecified|none|n\/a)?$/i.test(race)) return chip('race', 'Race', race);
    return chip('race', 'Race', 'Human');
}

// One-line lead under the name, built only from fields with real values (design review #2).
function leadLine(npc) {
    const known = value => {
        const text = String(value ?? '').replace(/\s+/g, ' ').trim();
        return /^(?:unknown|unspecified|none|n\/a)$/i.test(text) ? '' : text;
    };
    return [known(occupationOf(npc)), known(npc.location || npc.homeBase), known(npc.mood)].filter(Boolean).join(' · ');
}

export function codexHeaderHtml(npc) {
    if (!npc) return '<header class="codex-head is-empty"><div class="codex-ident"><h2>No dossier selected</h2></div></header>';
    const subtitle = [npc.gender, npc.age ? `age ${npc.age}` : npc.apparentAge ? `looks ${npc.apparentAge}` : '', npc.aliases?.length ? `aka ${npc.aliases.slice(0, 2).join(', ')}` : '']
        .filter(Boolean).join(' · ');
    const portrait = npc.portrait
        ? `<img src="${escapeHtml(npc.portrait)}" alt="${escapeHtml(npc.name)} portrait">`
        : `<span class="codex-initial" aria-hidden="true">${escapeHtml(String(npc.name || '?').trim().charAt(0).toUpperCase())}</span>`;
    const lead = leadLine(npc);
    const tags = (npc.tags || []).map((tag, index) => `<span class="codex-chip codex-tag"><i aria-hidden="true">${ICONS.tag}</i>${escapeHtml(tag)}<button type="button" data-codex-untag="${index}" aria-label="Remove tag ${escapeHtml(tag)}">×</button></span>`).join('');
    return `<header class="codex-head" data-npc-id="${escapeHtml(npc.id)}" data-tags="${escapeHtml(JSON.stringify(npc.tags || []))}">
        <button type="button" class="codex-portrait${npc.portrait ? ' delta-portrait-expand' : ''}" data-npc-id="${escapeHtml(npc.id)}" ${npc.portrait ? `aria-label="View ${escapeHtml(npc.name)} portrait full size"` : 'tabindex="-1" aria-hidden="true"'}>${portrait}</button>
        <div class="codex-ident">
            <div class="codex-title"><h2>${escapeHtml(npc.name)}</h2><span class="delta-status delta-status-${escapeHtml(npc.bucket)}">${escapeHtml(npc.statusLabel)}</span></div>
            ${lead ? `<p class="codex-lead">${escapeHtml(lead)}</p>` : ''}
            ${subtitle || !lead ? `<p class="codex-sub">${escapeHtml(subtitle || occupationOf(npc) || 'Identity details not established')}</p>` : ''}
            <div class="codex-chips">
                ${chip('faction', 'Faction', npc.faction)}
                ${chip('location', 'Location', npc.location || npc.homeBase)}
                ${raceChip(npc)}
                ${chip('occupation', 'Occupation', occupationOf(npc))}
                ${npc.sheet?.rank ? chip('rank', 'Rank', npc.sheet.rank) : ''}
                ${tags}
                <button type="button" class="codex-chip codex-add-tag" data-codex-tag>+ Add tag</button>
                ${npc.quote ? '' : '<button type="button" class="codex-chip codex-add-tag" data-codex-add-quote>+ Add quote</button>'}
            </div>
        </div>
        <label class="codex-quote"${npc.quote ? '' : ' hidden'}><span class="sr-only">Quote</span><textarea data-codex-quote rows="2" maxlength="240" placeholder="Add a quote…">${escapeHtml(npc.quote)}</textarea></label>
        <div class="codex-actions"><button type="button" class="delta-btn delta-edit" data-npc-id="${escapeHtml(npc.id)}">Edit dossier</button><button type="button" class="delta-btn npc-state-delta-refresh-chat" data-npc-id="${escapeHtml(npc.id)}" title="Re-read recent story to fill supported details; preserve locks and accepted development">Refresh</button></div>
        <div class="codex-tabs-slot"></div>
    </header>`;
}

export function codexLayoutStyles(rootId) {
    const r = `#${rootId} .delta-panel.delta-codex`;
    return `
${r} .delta-stage { display:grid; grid-template-rows:auto minmax(0,1fr); min-height:0; }
${r} .delta-spread { grid-template-columns:minmax(0,1fr) !important; min-height:0; }
${r} .delta-hero, ${r} .delta-document-head, ${r} .delta-stat-head { display:none !important; }
${r} .codex-head { position:relative; z-index:2; background:var(--delta-bg, #1d2128); display:grid; grid-template-columns:auto minmax(0,1fr) minmax(180px,30%); grid-template-areas:"pic ident quote" "pic ident actions" "tabs tabs tabs"; gap:6px 18px; padding:14px 18px 0; border-bottom:1px solid var(--delta-line, rgba(91,201,189,.16)); }
${r} .codex-portrait { position:static; inset:auto; grid-area:pic; width:118px; height:118px; padding:0; border:1px solid var(--delta-line, rgba(91,201,189,.22)); border-radius:10px; overflow:hidden; background:rgba(0,0,0,.3); cursor:zoom-in; }
${r} .codex-portrait[aria-hidden] { cursor:default; }
${r} .codex-portrait img { width:100%; height:100%; object-fit:cover; object-position:center 18%; display:block; }
${r} .codex-initial { display:grid; place-items:center; height:100%; font:700 3rem/1 Georgia,serif; color:var(--delta-accent, #5bc9bd); opacity:.75; }
${r} .codex-ident { grid-area:ident; min-width:0; display:grid; align-content:start; gap:6px; }
${r} .codex-title { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
${r} .codex-title h2 { margin:0; font:700 1.6rem/1.15 Georgia,"Times New Roman",serif; color:#b6eee4; }
${r} .codex-lead { margin:0; color:var(--delta-text, #e7f1f4); font-size:.95rem; line-height:1.35; }
${r} .codex-sub { margin:0; color:var(--delta-muted, #a9a39a); font-size:.88rem; }
${r} .codex-chips { display:flex; flex-wrap:wrap; gap:6px; margin-top:2px; }
${r} .codex-chip { display:inline-flex; align-items:center; gap:6px; min-height:28px; padding:3px 10px; border:1px solid var(--delta-line, rgba(91,201,189,.22)); border-radius:7px; background:rgba(255,255,255,.035); color:inherit; font-size:.8rem; }
${r} .codex-chip i { font-style:normal; opacity:.7; }
${r} .codex-chip.is-empty { opacity:.5; }
${r} .codex-tag button { margin-left:2px; padding:0 2px; border:0; background:none; color:inherit; opacity:.6; cursor:pointer; }
${r} .codex-add-tag { cursor:pointer; border-style:dashed; }
${r} .codex-quote { grid-area:quote; position:relative; display:block; padding:0 14px; }
${r} .codex-quote::before, ${r} .codex-quote::after { position:absolute; font:700 1.8rem/1 Georgia,serif; color:var(--delta-muted, #a9a39a); opacity:.5; }
${r} .codex-quote::before { content:"“"; left:-4px; top:-6px; }
${r} .codex-quote::after { content:"”"; right:-4px; bottom:-18px; }
${r} .codex-quote textarea { width:100%; min-height:3.2em; resize:none; border:0; border-bottom:1px solid var(--delta-line, rgba(91,201,189,.2)); background:transparent; color:inherit; font:italic .92rem/1.4 Georgia,serif; text-align:center; }
${r} .codex-actions { grid-area:actions; justify-self:end; align-self:end; display:flex; flex-wrap:wrap; gap:6px; }
${r} .codex-quote[hidden] { display:none; }
${r} .codex-actions .delta-dossier-actions-primary { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; }
${r} .codex-actions .delta-dossier-more { min-width:0; }
${r} .codex-actions .delta-dossier-more-menu { top:calc(100% + 7px); bottom:auto; }
${r} .codex-head > .delta-npc-diagnostics { grid-column:1 / -1; margin:4px 0 0; }
${r} .codex-tabs-slot { grid-area:tabs; margin-top:8px; }
${r} .codex-tabs-slot .delta-map-switch { display:flex; gap:4px; border:0; background:none; padding:0; }
${r} .codex-tabs-slot .delta-map-switch button { min-width:120px; padding:9px 18px; border:1px solid var(--delta-line, rgba(91,201,189,.2)); border-bottom:0; border-radius:8px 8px 0 0; background:rgba(255,255,255,.03); color:inherit; }
${r} .codex-tabs-slot .delta-map-switch button[aria-selected="true"] { background:color-mix(in srgb, var(--delta-accent, #5bc9bd) 16%, transparent); border-color:var(--delta-accent, #5bc9bd); color:#b6eee4; }

${r} .delta-library.npc-codex-cast-collapsed { grid-template-columns:minmax(260px,32%) minmax(0,1fr); grid-template-rows:minmax(0,1fr) !important; }
${r} .delta-library.npc-codex-cast-collapsed > .delta-cast { display:none !important; }
${r} .delta-library.npc-codex-cast-collapsed > .delta-hero { display:grid !important; grid-column:1; grid-row:1; }
${r} .delta-library.npc-codex-cast-collapsed > .delta-stage { grid-column:2; }
${r} .delta-library { display:grid !important; grid-template-columns:270px minmax(0,1fr); grid-template-rows:minmax(0,1fr) !important; min-height:0; }
${r} .delta-library > .delta-cast { grid-column:1; grid-row:1; display:flex !important; flex-direction:column; min-height:0; height:auto !important; max-height:none !important; border-right:1px solid var(--delta-line, rgba(91,201,189,.16)); border-top:0 !important; }
${r} .delta-library > .delta-stage { grid-column:2; grid-row:1; }
${r} .delta-cast-tools { display:grid !important; grid-template-columns:minmax(0,1fr) !important; gap:8px !important; padding:12px 10px !important; }
${r} .delta-cast-tools .delta-library-heading { display:none !important; }
${r} .delta-cast-tools .delta-search-label { display:flex !important; grid-column:1 !important; width:100%; }
${r} .delta-cast-tools .delta-filters { display:flex !important; grid-column:1 !important; justify-self:stretch !important; gap:4px; }
${r} .delta-cast-tools .delta-filters .delta-filter { flex:1 1 0; }
${r} .delta-cast-tools .delta-search-label input { width:100%; }
${r} .delta-cast-rail-wrap { display:contents !important; }
${r} .delta-rail-arrow { display:none !important; }
${r} .delta-cast-list { display:flex !important; flex-direction:column; gap:6px !important; padding:0 10px 12px !important; overflow-x:hidden !important; overflow-y:auto !important; scroll-snap-type:none !important; min-height:0 !important; flex:1 1 auto; scrollbar-width:thin !important; }
${r} .delta-cast-card, ${r} .delta-cast-card[data-bucket="dead"] { display:grid !important; grid-template-columns:52px minmax(0,1fr); align-items:center; gap:10px; flex:0 0 auto !important; width:100% !important; min-width:0 !important; max-width:none !important; height:auto !important; min-height:66px; padding:7px !important; text-align:left !important; }
${r} .delta-cast-card.delta-cast-first-dead { margin-left:0 !important; margin-top:8px; box-shadow:0 -9px 0 -8px rgba(91,201,189,.45); }
${r} .delta-cast-card .delta-cast-portrait { position:static !important; inset:auto !important; width:52px !important; height:52px !important; border-radius:8px !important; }
${r} .delta-cast-card .delta-cast-portrait.delta-portrait-placeholder span { font-size:1.5rem !important; }
${r} .delta-cast-card .delta-cast-copy { position:static !important; background:none !important; padding:0 !important; align-content:center !important; gap:2px !important; }
${r} .delta-cast-card .delta-cast-copy b { font-size:.92rem !important; }
${r} .delta-cast-card .delta-cast-copy small { font-size:.74rem !important; display:block !important; }
${r} .delta-cast-card .delta-cast-copy .delta-status { justify-self:start; backdrop-filter:none; }

`;
}
