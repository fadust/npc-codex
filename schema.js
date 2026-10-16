/* NPC Codex: per-world stat schema (spec S2.13, fadust fork).
 *
 * A world defines its own stat set, resource pools, rank scale and skill list (Drakmor guild ranks
 * are not modern Seoul). The schema lives in a lorebook entry whose title or keys say
 * "NPC Codex Schema", or in a "[NPC Codex Schema] ... [/NPC Codex Schema]" block in the card:
 *
 *   attributes: STR, DEX, CON, INT, WIS, CHA
 *   pools: HP, MP, Stamina
 *   ranks: Iron < Bronze < Silver < Gold < Mithril
 *   skills: Swordsmanship, Herbalism, Tracking
 *
 * The cast pass is told the names, and code keeps sheet changes on the schema: names map to the
 * schema's spelling; ranks off the scale and attributes/pools/skills outside a defined list are
 * rejected. A list the schema leaves out stays open.
 *
 * Pure module: no host, DOM or storage access. */

export const SCHEMA_TITLE = /npc\s*codex\s*schema/i;
const BLOCK = /\[npc\s*codex\s*schema\]([\s\S]*?)\[\/npc\s*codex\s*schema\]/i;
const KEYS = { attributes: /^(?:attributes?|stats?)$/i, pools: /^(?:pools?|resources?)$/i, ranks: /^(?:ranks?|rank scale|levels?)$/i, skills: /^skills?$/i };

function cleanText(value, max = 60) {
    return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function norm(value) {
    return cleanText(value, 200).toLowerCase();
}

export function parseWorldSchema(text) {
    const schema = { attributes: [], pools: [], ranks: [], skills: [] };
    for (const line of String(text || '').split(/\r?\n/)) {
        const index = line.indexOf(':');
        if (index <= 0) continue;
        const label = line.slice(0, index).trim();
        const field = Object.keys(KEYS).find(key => KEYS[key].test(label));
        if (!field) continue;
        const body = line.slice(index + 1);
        let values;
        if (field === 'ranks') {
            // "low < high" or "high > low"; plain commas read low to high.
            values = body.includes('>') && !body.includes('<') ? body.split('>').reverse() : body.split(/[<,]/);
        } else {
            values = body.split(/[,;]/);
        }
        schema[field] = [...new Set(values.map(value => cleanText(value)).filter(Boolean))].slice(0, 40);
    }
    return Object.values(schema).some(list => list.length) ? schema : null;
}

// Card block first (this story's own definition), then a lorebook entry.
export function findWorldSchema({ cardText = '', entries = [] } = {}) {
    const block = String(cardText || '').match(BLOCK);
    if (block) {
        const parsed = parseWorldSchema(block[1]);
        if (parsed) return { ...parsed, source: 'card' };
    }
    for (const entry of Array.isArray(entries) ? entries : []) {
        const labels = [entry?.comment, ...(Array.isArray(entry?.key) ? entry.key : [])];
        if (!labels.some(label => SCHEMA_TITLE.test(String(label || '')))) continue;
        const parsed = parseWorldSchema(entry.content);
        if (parsed) return { ...parsed, source: entry.world || 'lorebook' };
    }
    return null;
}

export function schemaPromptLine(schema) {
    if (!schema) return '';
    const parts = [
        schema.attributes.length && `attributes ${schema.attributes.join(', ')}`,
        schema.pools.length && `pools ${schema.pools.join(', ')}`,
        schema.ranks.length && `ranks low->high ${schema.ranks.join(' < ')}`,
        schema.skills.length && `skills ${schema.skills.join(', ')}`,
    ].filter(Boolean);
    return parts.length ? `WORLD SCHEMA (use exactly these names; nothing outside a listed set): ${parts.join('; ')}.` : '';
}

function canonical(list, name) {
    const key = norm(name);
    return list.find(item => norm(item) === key) || '';
}

// Keeps a grounded sheet delta on the schema. Returns { delta, rejected[] }.
export function applySchemaToDelta(delta, schema) {
    if (!schema || !delta) return { delta, rejected: [] };
    const rejected = [];
    const out = { ...delta };
    const onList = (field, items, nameOf, rename) => {
        if (!schema[field].length) return items;
        return items.flatMap(item => {
            const name = canonical(schema[field], nameOf(item));
            if (!name) { rejected.push(`${field}: ${nameOf(item)} is not in the world schema`); return []; }
            return [rename(item, name)];
        });
    };
    out.attributes = onList('attributes', delta.attributes || [], item => item.name, (item, name) => ({ ...item, name }));
    out.pools = onList('pools', delta.pools || [], item => item.name, (item, name) => ({ ...item, name }));
    out.skills = onList('skills', delta.skills || [], item => item.name, (item, name) => ({ ...item, name }));
    if (out.rank && schema.ranks.length) {
        const rank = canonical(schema.ranks, out.rank);
        if (!rank) { rejected.push(`rank: ${out.rank} is not on the world's scale`); out.rank = ''; } else out.rank = rank;
    }
    return { delta: out, rejected };
}
