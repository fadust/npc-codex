/* NPC State Delta: per-NPC stat sheet (fadust fork). "Who" lives on the Dossier tab; this is
 * "what": class and rank, attributes, resource pools, conditions, spells, skills, equipment and
 * key items. Values are recorded only when the story states them; unknown stays empty.
 *
 * Item and condition changes arrive as operations ("gained", "lost", "equipped", "cleared") so a
 * stolen or broken item really leaves the sheet, and every change records its source message.
 *
 * Pure module: no host, DOM or storage access. */

export const SHEET_LIMITS = Object.freeze({
    keyItems: 10, equipped: 8, spells: 12, skills: 12, conditions: 8, attributes: 12, pools: 6, itemLog: 12,
});
const TEXT = 160;

// Model filler ("not stated", "unknown", "n/a") is not a value.
const FILLER = /^(?:not stated|unstated|unknown|n\/?a|none|null|undefined|unspecified|-+)$/i;

function cleanText(value, max = TEXT) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
    return FILLER.test(text) ? '' : text;
}

function finite(value) {
    const number = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
    return String(value ?? '').trim() !== '' && Number.isFinite(number) ? number : null;
}

function stamp(entry, meta = {}) {
    const out = { ...entry };
    if (Number.isInteger(meta.turn) && !Number.isInteger(out.since)) out.since = meta.turn;
    if (Number.isInteger(meta.sourceMessageId) && !Number.isInteger(out.sourceMessageId)) out.sourceMessageId = meta.sourceMessageId;
    return out;
}

const NAME_STOP = new Set(['the', 'a', 'an', 'her', 'his', 'their', 'its', 'my', 'your', 'our', 'old', 'new', 'of']);

function nameTokens(value) {
    return cleanText(value).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 1 && !NAME_STOP.has(word));
}

// "the compass" names "scratched brass compass" (all its words are there), but "iron hammer badge"
// does not name "bronze badge": one name's words must all appear in the other.
function sameName(a, b) {
    const left = nameTokens(a);
    const right = nameTokens(b);
    if (!left.length || !right.length) return false;
    const contains = (outer, inner) => inner.every(word => outer.includes(word));
    return contains(left, right) || contains(right, left);
}

function upsert(list, entry, key, limit) {
    const index = list.findIndex(item => sameName(item[key], entry[key]));
    const out = list.slice();
    if (index >= 0) out[index] = { ...out[index], ...entry };
    else out.push(entry);
    return out.slice(-limit);
}

function removeNamed(list, name, key) {
    return list.filter(item => !sameName(item[key], name));
}

const CONDITION_KINDS = ['injury', 'illness', 'buff', 'debuff', 'curse', 'status'];

function normalizeList(value, map, limit) {
    return (Array.isArray(value) ? value : []).map(map).filter(Boolean).slice(-limit);
}

export function emptySheet() {
    return { archetype: '', rank: '', attributes: [], pools: [], conditions: [], spells: [], skills: [], equipped: [], keyItems: [], itemLog: [] };
}

export function normalizeSheet(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const meta = item => ({
        ...(Number.isInteger(item?.since) ? { since: item.since } : {}),
        ...(Number.isInteger(item?.sourceMessageId) ? { sourceMessageId: item.sourceMessageId } : {}),
    });
    return {
        archetype: cleanText(source.archetype ?? source.class, 120),
        rank: cleanText(source.rank ?? source.level, 120),
        attributes: normalizeList(source.attributes, item => {
            const name = cleanText(item?.name, 40);
            const value = cleanText(item?.value, 40);
            return name && value ? { name, value } : null;
        }, SHEET_LIMITS.attributes),
        pools: normalizeList(source.pools, item => {
            const name = cleanText(item?.name, 40);
            const current = finite(item?.current);
            const max = finite(item?.max);
            if (!name || (current == null && max == null)) return null;
            return { name, ...(current != null ? { current } : {}), ...(max != null ? { max } : {}) };
        }, SHEET_LIMITS.pools),
        conditions: normalizeList(source.conditions, item => {
            const name = cleanText(item?.name, TEXT);
            if (!name) return null;
            const kind = CONDITION_KINDS.includes(String(item?.kind || '').toLowerCase()) ? String(item.kind).toLowerCase() : 'status';
            const severity = cleanText(item?.severity, 40);
            const until = cleanText(item?.until, 80);
            return { name, kind, ...(severity ? { severity } : {}), ...(until ? { until } : {}), ...meta(item) };
        }, SHEET_LIMITS.conditions),
        spells: normalizeList(source.spells, item => {
            const name = cleanText(item?.name, 80);
            if (!name) return null;
            const school = cleanText(item?.school, 40);
            const tier = cleanText(item?.tier, 40);
            return { name, ...(school ? { school } : {}), ...(tier ? { tier } : {}), ...meta(item) };
        }, SHEET_LIMITS.spells),
        skills: normalizeList(source.skills, item => {
            const name = cleanText(item?.name, 80);
            if (!name) return null;
            const proficiency = cleanText(item?.proficiency, 40);
            return { name, ...(proficiency ? { proficiency } : {}), ...meta(item) };
        }, SHEET_LIMITS.skills),
        equipped: normalizeList(source.equipped, item => {
            const itemName = cleanText(item?.item, TEXT);
            if (!itemName) return null;
            const slot = cleanText(item?.slot, 40);
            const notes = cleanText(item?.notes, TEXT);
            return { item: itemName, ...(slot ? { slot } : {}), ...(notes ? { notes } : {}), ...meta(item) };
        }, SHEET_LIMITS.equipped),
        keyItems: normalizeList(source.keyItems, item => {
            const itemName = cleanText(item?.item, TEXT);
            if (!itemName) return null;
            const significance = cleanText(item?.significance, TEXT);
            return { item: itemName, ...(significance ? { significance } : {}), ...meta(item) };
        }, SHEET_LIMITS.keyItems),
        itemLog: normalizeList(source.itemLog, item => {
            const op = cleanText(item?.op, 20);
            const itemName = cleanText(item?.item, TEXT);
            return op && itemName ? { op, item: itemName, ...meta(item) } : null;
        }, SHEET_LIMITS.itemLog * 2)
            // One event per op/item/message, also for logs stored before re-scans were de-duplicated.
            .filter((item, index, all) => !Number.isInteger(item.sourceMessageId) || all.findIndex(other => other.op === item.op
                && other.item === item.item && other.sourceMessageId === item.sourceMessageId) === index)
            .slice(-SHEET_LIMITS.itemLog),
    };
}

export function sheetIsEmpty(sheet) {
    const s = normalizeSheet(sheet);
    return !s.archetype && !s.rank && ['attributes', 'pools', 'conditions', 'spells', 'skills', 'equipped', 'keyItems'].every(key => !s[key].length);
}

/* ---------- Deltas from the cast pass ---------- */

const ITEM_GAIN = new Set(['gained', 'gain', 'received', 'took', 'picked up', 'found', 'bought', 'kept', 'claimed', 'acquired']);
const ITEM_LOSS = new Set(['lost', 'lose', 'gave', 'given', 'gave away', 'stolen', 'sold', 'dropped', 'broken', 'broke', 'destroyed', 'used up', 'consumed', 'spent', 'confiscated']);
const ITEM_EQUIP = new Set(['equipped', 'equip', 'wielded', 'wore', 'wearing', 'donned', 'drew', 'readied']);
const ITEM_UNEQUIP = new Set(['unequipped', 'unequip', 'removed', 'sheathed', 'stowed', 'took off', 'doffed']);

function itemOp(value) {
    const op = cleanText(value, 20).toLowerCase();
    if (ITEM_GAIN.has(op)) return 'gained';
    if (ITEM_LOSS.has(op)) return 'lost';
    if (ITEM_EQUIP.has(op)) return 'equipped';
    if (ITEM_UNEQUIP.has(op)) return 'unequipped';
    return '';
}

// A name proposed by the model must be grounded in the exchange (most of its words appear).
// Conditions are usually paraphrased ("a wolf caught her" -> "wolf bite wound"), so one content
// word is enough for them; names of items, spells and ranks need most of their words.
export function groundedIn(text, name, { minRatio = 0.5, anyContentWord = false } = {}) {
    const words = cleanText(name).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2);
    if (!words.length) return false;
    const haystack = String(text || '').toLowerCase();
    const hits = words.filter(word => haystack.includes(word));
    if (anyContentWord) return hits.some(word => word.length >= 4);
    return hits.length / words.length >= minRatio;
}

export function readSheetDelta(raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const list = value => (Array.isArray(value) ? value : []).slice(0, 6);
    return {
        items: list(source.items).map(item => ({
            op: itemOp(item?.op),
            item: cleanText(item?.item, TEXT),
            slot: cleanText(item?.slot, 40),
            significance: cleanText(item?.significance, TEXT),
        })).filter(item => item.op && item.item),
        conditions: list(source.conditions).map(item => ({
            op: String(item?.op || 'add').toLowerCase() === 'clear' ? 'clear' : 'add',
            name: cleanText(item?.name, TEXT),
            kind: cleanText(item?.kind, 20).toLowerCase(),
            severity: cleanText(item?.severity, 40),
            until: cleanText(item?.until, 80),
        })).filter(item => item.name),
        spells: list(source.spells).map(item => ({
            op: /lost|forgot|sealed/i.test(String(item?.op || '')) ? 'lost' : 'learned',
            name: cleanText(item?.name, 80), school: cleanText(item?.school, 40), tier: cleanText(item?.tier, 40),
        })).filter(item => item.name),
        skills: list(source.skills).map(item => ({
            name: cleanText(item?.name, 80), proficiency: cleanText(item?.proficiency, 40),
        })).filter(item => item.name),
        attributes: list(source.attributes).map(item => ({ name: cleanText(item?.name, 40), value: cleanText(item?.value, 40) })).filter(item => item.name && item.value),
        pools: list(source.pools).map(item => ({ name: cleanText(item?.name, 40), current: finite(item?.current), max: finite(item?.max) })).filter(item => item.name && (item.current != null || item.max != null)),
        rank: cleanText(source.rank, 120),
        archetype: cleanText(source.archetype ?? source.class, 120),
    };
}

export function sheetDeltaIsEmpty(delta) {
    const d = delta || {};
    return !d.rank && !d.archetype && ['items', 'conditions', 'spells', 'skills', 'attributes', 'pools'].every(key => !(d[key] || []).length);
}

// Drops every part of a delta the exchange does not support. Returns { delta, rejected[] }.
export function groundSheetDelta(delta, transcript) {
    const rejected = [];
    const keep = (value, label, options) => {
        if (groundedIn(transcript, value, options)) return true;
        rejected.push(label);
        return false;
    };
    const out = readSheetDelta(delta);
    out.items = out.items.filter(item => keep(item.item, `item ${item.op}: ${item.item}`));
    out.conditions = out.conditions.filter(item => keep(item.name, `condition: ${item.name}`, { anyContentWord: true }));
    out.spells = out.spells.filter(item => keep(item.name, `spell: ${item.name}`));
    out.skills = out.skills.filter(item => keep(item.name, `skill: ${item.name}`));
    out.attributes = out.attributes.filter(item => keep(`${item.name} ${item.value}`, `attribute: ${item.name}`));
    out.pools = out.pools.filter(item => keep(item.name, `pool: ${item.name}`));
    if (out.rank && !keep(out.rank, `rank: ${out.rank}`)) out.rank = '';
    if (out.archetype && !keep(out.archetype, `class: ${out.archetype}`)) out.archetype = '';
    return { delta: out, rejected };
}

export function applySheetDelta(sheet, delta, meta = {}) {
    const s = normalizeSheet(sheet);
    const d = readSheetDelta(delta);
    // A re-scan of the same message replays the same operations; log each event once per message.
    const log = entry => {
        const next = stamp(entry, meta);
        const duplicate = Number.isInteger(next.sourceMessageId) && s.itemLog.some(item => item.op === next.op
            && item.sourceMessageId === next.sourceMessageId && sameName(item.item, next.item));
        if (!duplicate) s.itemLog = [...s.itemLog, next].slice(-SHEET_LIMITS.itemLog);
    };
    for (const item of d.items) {
        if (item.op === 'gained') {
            s.keyItems = upsert(s.keyItems, stamp({ item: item.item, ...(item.significance ? { significance: item.significance } : {}) }, meta), 'item', SHEET_LIMITS.keyItems);
        } else if (item.op === 'lost') {
            s.keyItems = removeNamed(s.keyItems, item.item, 'item');
            s.equipped = removeNamed(s.equipped, item.item, 'item');
        } else if (item.op === 'equipped') {
            let equipped = s.equipped;
            if (item.slot) equipped = equipped.filter(entry => cleanText(entry.slot).toLowerCase() !== item.slot.toLowerCase());
            s.equipped = upsert(equipped, stamp({ item: item.item, ...(item.slot ? { slot: item.slot } : {}) }, meta), 'item', SHEET_LIMITS.equipped);
        } else if (item.op === 'unequipped') {
            s.equipped = removeNamed(s.equipped, item.item, 'item');
        }
        log({ op: item.op, item: item.item });
    }
    for (const condition of d.conditions) {
        if (condition.op === 'clear') { s.conditions = removeNamed(s.conditions, condition.name, 'name'); continue; }
        const kind = CONDITION_KINDS.includes(condition.kind) ? condition.kind : 'status';
        s.conditions = upsert(s.conditions, stamp({ name: condition.name, kind, ...(condition.severity ? { severity: condition.severity } : {}), ...(condition.until ? { until: condition.until } : {}) }, meta), 'name', SHEET_LIMITS.conditions);
    }
    for (const spell of d.spells) {
        if (spell.op === 'lost') { s.spells = removeNamed(s.spells, spell.name, 'name'); continue; }
        s.spells = upsert(s.spells, stamp({ name: spell.name, ...(spell.school ? { school: spell.school } : {}), ...(spell.tier ? { tier: spell.tier } : {}) }, meta), 'name', SHEET_LIMITS.spells);
    }
    for (const skill of d.skills) s.skills = upsert(s.skills, stamp({ name: skill.name, ...(skill.proficiency ? { proficiency: skill.proficiency } : {}) }, meta), 'name', SHEET_LIMITS.skills);
    for (const attribute of d.attributes) s.attributes = upsert(s.attributes, attribute, 'name', SHEET_LIMITS.attributes);
    for (const pool of d.pools) {
        const index = s.pools.findIndex(item => sameName(item.name, pool.name));
        const merged = { ...(index >= 0 ? s.pools[index] : { name: pool.name }), ...(pool.current != null ? { current: pool.current } : {}), ...(pool.max != null ? { max: pool.max } : {}) };
        s.pools = index >= 0 ? s.pools.map((item, i) => (i === index ? merged : item)) : [...s.pools, merged].slice(-SHEET_LIMITS.pools);
    }
    if (d.rank) s.rank = d.rank;
    if (d.archetype) s.archetype = d.archetype;
    return normalizeSheet(s);
}

/* ---------- Rendering ---------- */

const itemText = item => `${item.item}${item.significance ? ` (${item.significance})` : ''}`;
const equipText = item => `${item.item}${item.slot ? ` [${item.slot}]` : ''}`;
const spellText = spell => `${spell.name}${spell.school || spell.tier ? ` (${[spell.school, spell.tier].filter(Boolean).join(', ')})` : ''}`;
const conditionText = condition => `${condition.name}${condition.severity ? `, ${condition.severity}` : ''}${condition.until ? `, until ${condition.until}` : ''}`;
const poolText = pool => `${pool.name} ${pool.current ?? '?'}${pool.max != null ? `/${pool.max}` : ''}`;

// Compact continuity line for the roleplay injection. Conditions and carried items come first:
// they are what a returning NPC most often contradicts.
export function renderSheetInjection(sheet, maxChars = 420) {
    const s = normalizeSheet(sheet);
    if (sheetIsEmpty(s)) return '';
    const parts = [
        s.conditions.length && `condition: ${s.conditions.map(conditionText).join('; ')}`,
        s.keyItems.length && `carries: ${s.keyItems.map(itemText).join('; ')}`,
        s.equipped.length && `equipped: ${s.equipped.map(equipText).join('; ')}`,
        (s.rank || s.archetype) && `class/rank: ${[s.archetype, s.rank].filter(Boolean).join(', ')}`,
        s.spells.length && `spells: ${s.spells.map(spellText).join('; ')}`,
        s.skills.length && `skills: ${s.skills.map(skill => `${skill.name}${skill.proficiency ? ` (${skill.proficiency})` : ''}`).join('; ')}`,
        s.pools.length && `pools: ${s.pools.map(poolText).join(', ')}`,
        s.attributes.length && `attributes: ${s.attributes.map(item => `${item.name} ${item.value}`).join(', ')}`,
    ].filter(Boolean);
    let text = `STAT SHEET (established): ${parts.join('; ')}`;
    if (text.length > maxChars) {
        const cut = text.slice(0, maxChars);
        const boundary = cut.lastIndexOf('; ');
        text = boundary > 40 ? cut.slice(0, boundary) : cut;
    }
    return text;
}

// Compact context for the cast pass, so "lost" and "cleared" can name what is already there.
export function sheetContext(sheet) {
    const s = normalizeSheet(sheet);
    if (sheetIsEmpty(s)) return null;
    return {
        ...(s.keyItems.length ? { carries: s.keyItems.map(item => item.item) } : {}),
        ...(s.equipped.length ? { equipped: s.equipped.map(equipText) } : {}),
        ...(s.conditions.length ? { conditions: s.conditions.map(item => item.name) } : {}),
        ...(s.spells.length ? { spells: s.spells.map(spell => spell.name) } : {}),
        ...(s.rank ? { rank: s.rank } : {}),
        ...(s.archetype ? { class: s.archetype } : {}),
    };
}

/* ---------- Editor round-trip: one textarea per section, one entry per line. ---------- */

export const SHEET_EDITOR_FIELDS = Object.freeze([
    { key: 'keyItems', label: 'Key items', hint: 'item — why it matters' },
    { key: 'equipped', label: 'Equipped', hint: 'slot: item' },
    { key: 'conditions', label: 'Conditions', hint: 'name (injury|illness|buff|debuff|curse|status) until …' },
    { key: 'spells', label: 'Spells', hint: 'name (school, tier)' },
    { key: 'skills', label: 'Skills', hint: 'name: proficiency' },
    { key: 'attributes', label: 'Attributes', hint: 'NAME: value' },
    { key: 'pools', label: 'Pools', hint: 'HP: 10/12' },
]);

export function sheetToEditor(sheet) {
    const s = normalizeSheet(sheet);
    return {
        archetype: s.archetype,
        rank: s.rank,
        keyItems: s.keyItems.map(item => `${item.item}${item.significance ? ` — ${item.significance}` : ''}`).join('\n'),
        equipped: s.equipped.map(item => `${item.slot ? `${item.slot}: ` : ''}${item.item}`).join('\n'),
        conditions: s.conditions.map(item => `${item.name} (${item.kind})${item.until ? ` until ${item.until}` : ''}`).join('\n'),
        spells: s.spells.map(spellText).join('\n'),
        skills: s.skills.map(item => `${item.name}${item.proficiency ? `: ${item.proficiency}` : ''}`).join('\n'),
        attributes: s.attributes.map(item => `${item.name}: ${item.value}`).join('\n'),
        pools: s.pools.map(item => `${item.name}: ${item.current ?? ''}${item.max != null ? `/${item.max}` : ''}`).join('\n'),
    };
}

function lines(text) {
    return String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

// Editing keeps provenance (since/sourceMessageId) of entries whose text did not change.
export function sheetFromEditor(fields = {}, previous = null) {
    const old = normalizeSheet(previous);
    const keepMeta = (list, key, entry) => {
        const prior = list.find(item => cleanText(item[key]).toLowerCase() === cleanText(entry[key]).toLowerCase());
        return prior ? { ...prior, ...entry } : entry;
    };
    return normalizeSheet({
        archetype: fields.archetype,
        rank: fields.rank,
        keyItems: lines(fields.keyItems).map(line => {
            const [item, ...rest] = line.split(/\s+[—–-]\s+/);
            return keepMeta(old.keyItems, 'item', { item, ...(rest.length ? { significance: rest.join(' - ') } : {}) });
        }),
        equipped: lines(fields.equipped).map(line => {
            const match = /^([^:]{1,40}):\s*(.+)$/.exec(line);
            return keepMeta(old.equipped, 'item', match ? { slot: match[1], item: match[2] } : { item: line });
        }),
        conditions: lines(fields.conditions).map(line => {
            const match = /^(.*?)\s*\((injury|illness|buff|debuff|curse|status)\)\s*(?:until\s+(.+))?$/i.exec(line);
            const entry = match ? { name: match[1], kind: match[2].toLowerCase(), ...(match[3] ? { until: match[3] } : {}) } : { name: line, kind: 'status' };
            return keepMeta(old.conditions, 'name', entry);
        }),
        spells: lines(fields.spells).map(line => {
            const match = /^(.*?)\s*\(([^,)]*)(?:,\s*([^)]*))?\)$/.exec(line);
            return keepMeta(old.spells, 'name', match ? { name: match[1], school: match[2], tier: match[3] || '' } : { name: line });
        }),
        skills: lines(fields.skills).map(line => {
            const match = /^([^:]+):\s*(.+)$/.exec(line);
            return keepMeta(old.skills, 'name', match ? { name: match[1], proficiency: match[2] } : { name: line });
        }),
        attributes: lines(fields.attributes).map(line => {
            const match = /^([^:]+):\s*(.+)$/.exec(line);
            return match ? { name: match[1], value: match[2] } : null;
        }).filter(Boolean),
        pools: lines(fields.pools).map(line => {
            const match = /^([^:]+):\s*([\d.]+)?\s*(?:\/\s*([\d.]+))?$/.exec(line);
            return match ? { name: match[1], current: match[2], max: match[3] } : null;
        }).filter(Boolean),
        itemLog: old.itemLog,
    });
}
