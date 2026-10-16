/* NPC Codex: stat derivation and ability flavour (fadust fork).
 *
 * Stats are flavour that keeps characters consistent, not a battle calculator.
 *  - An untrained human is 30 in every attribute (1-100 scale). Other races are derived once per
 *    race per world by the model, relative to that human, and cached (an orc: bigger and physical,
 *    so more Strength/Endurance/HP/Stamina, less MP/magic/Charisma).
 *  - A profession (blacksmith, messenger ...) is a modifier on top, derived and cached the same way.
 *  - A rank E-S adds a training budget, spread by the NPC's own emphasis: two B-class swordsmen
 *    share a budget, one Strength-heavy and one Agility-heavy.
 *  - The prompt never gets numbers. In action scenes only, each NPC gets one short flavour phrase
 *    and, when two of them clash, a comparison ("quicker", "hits harder"). Outcomes stay free.
 *
 * Pure module: no host, DOM or storage access. */

export const ATTRIBUTES = Object.freeze(['Strength', 'Agility', 'Endurance', 'Intelligence', 'Wisdom', 'Charisma', 'Luck']);
export const HUMAN_BASELINE = 30;
export const RANKS = Object.freeze(['E', 'D', 'C', 'B', 'A', 'S']);
const RANK_BUDGET = { E: 5, D: 15, C: 40, B: 65, A: 95, S: 130, 'S+': 175 };
// The best attribute of a ranked character lands in its rank's band (user's scale; E starts at the human 30).
// S is the highest acknowledged rank, but the top few of S (SS, S+, "the strongest S-rank") pass 100.
export const RANK_BANDS = Object.freeze({ E: [30, 39], D: [40, 49], C: [50, 59], B: [60, 69], A: [70, 84], S: [85, 100], 'S+': [101, 125] });
const APEX_RANK = /\b(?:SS|SSS|EX)\b|\bS\+/; // case-sensitive: "ex-captain" is not EX rank
const APEX_WORD = /\b(?:strongest|apex|legendary|peerless|unmatched|unrivall?ed|greatest|mightiest)\b/i;
const MAGIC = ['none', 'weak', 'normal', 'strong'];
const MAGIC_FACTOR = { none: 0, weak: 0.5, normal: 1, strong: 1.5 };
export const PROFILE_SYSTEM_PROMPT = "You are NPC Codex's isolated world-rules helper. Reason from common knowledge of the genre and the supplied lore. Return only the requested JSON object.";

const clamp = (value, low, high) => Math.max(low, Math.min(high, Math.round(Number(value) || 0)));
const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const attrKey = name => ATTRIBUTES.find(attr => norm(attr) === norm(name) || norm(attr).slice(0, 3) === norm(name).slice(0, 3)) || '';

export function profileKey(name) {
    return norm(name).replace(/^(an?|the)\s+/, '').replace(/[^a-z0-9 -]/g, '').replace(/s$/, '').slice(0, 40);
}

/* ---------- Race and profession profiles (model-derived, cached per world) ---------- */

export function buildRaceProfilePrompt(race, lore = '') {
    return `World rules: attribute baseline for an untrained adult ${race}.
Scale 1-100. An untrained adult HUMAN is exactly 30 in every attribute: ${ATTRIBUTES.join(', ')}.
Reason from what this world's lore (below, if any) and common genre knowledge say about ${race}s compared with humans: body size, strength, speed, toughness, mind, presence, magic. Example: orcs are bigger and physical but unrefined, so Strength, Endurance, HP and Stamina run higher; magic, MP and Charisma lower.
JSON only: {"attributes":{"Strength":30,"Agility":30,"Endurance":30,"Intelligence":30,"Wisdom":30,"Charisma":30,"Luck":30},"hp":1.0,"stamina":1.0,"magic":"none|weak|normal|strong","note":"one line why"}
hp/stamina are multipliers versus a human (0.5-2). ${lore ? `\nLORE:\n${String(lore).slice(0, 1200)}` : ''}`;
}

export function buildProfessionProfilePrompt(profession, lore = '') {
    return `World rules: how the profession "${profession}" changes an untrained person's attributes (scale 1-100, untrained human = 30).
Give modifiers from the work itself (a blacksmith: +Strength +Endurance; a messenger: +Agility +Endurance; a scholar: +Intelligence +Wisdom). Modest: -10..+15 each.
Attributes: ${ATTRIBUTES.join(', ')}.
"magic":"none" ONLY when the profession itself rules magic out (a barbarian who shuns it, a magic-hunter); otherwise "keep".
JSON only: {"modifiers":{"Strength":0},"magic":"keep|none","focus":["the 1-2 attributes the work builds"],"note":"one line why"}${lore ? `\nLORE:\n${String(lore).slice(0, 800)}` : ''}`;
}

// Race baseline: each attribute 10-60 untrained; the whole race within 0.7-1.35 of a human's total.
export function parseRaceProfile(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const attributes = {};
    for (const attr of ATTRIBUTES) attributes[attr] = clamp(source.attributes?.[attr] ?? HUMAN_BASELINE, 10, 60);
    const total = Object.values(attributes).reduce((sum, value) => sum + value, 0);
    const human = HUMAN_BASELINE * ATTRIBUTES.length;
    const scale = total > human * 1.35 ? (human * 1.35) / total : (total < human * 0.7 ? (human * 0.7) / total : 1);
    if (scale !== 1) for (const attr of ATTRIBUTES) attributes[attr] = clamp(attributes[attr] * scale, 10, 60);
    return {
        attributes,
        hp: Math.max(0.5, Math.min(2, Number(source.hp) || 1)),
        stamina: Math.max(0.5, Math.min(2, Number(source.stamina) || 1)),
        magic: MAGIC.includes(source.magic) ? source.magic : 'normal',
        note: String(source.note || '').slice(0, 160),
    };
}

// A profession only rules magic out when the work itself does; the model over-applies it otherwise
// (live: a messenger came back "magic: none").
const ANTI_MAGIC_WORK = /\b(barbarian|berserker|(?:witch|mage|magic|demon)[- ]?hunter|inquisitor|squib|null|anti-?mage)\b/i;

export function parseProfessionProfile(raw, name = '') {
    const source = raw && typeof raw === 'object' ? raw : {};
    const modifiers = {};
    for (const [name, value] of Object.entries(source.modifiers || {})) {
        const key = attrKey(name);
        if (key) modifiers[key] = clamp(value, -10, 15);
    }
    return {
        modifiers,
        magic: source.magic === 'none' && ANTI_MAGIC_WORK.test(String(name || '')) ? 'none' : 'keep',
        focus: (Array.isArray(source.focus) ? source.focus : []).map(attrKey).filter(Boolean).slice(0, 2),
        note: String(source.note || '').slice(0, 160),
    };
}

export const HUMAN_PROFILE = Object.freeze({ attributes: Object.fromEntries(ATTRIBUTES.map(attr => [attr, HUMAN_BASELINE])), hp: 1, stamina: 1, magic: 'normal', note: 'untrained human baseline' });

/* ---------- Rank ---------- */

// "B-class", "rank B", "Rank: S", a bare "C"; or a world's own scale mapped onto E-S.
export function rankTier(rank, schemaRanks = []) {
    const text = String(rank || '').trim();
    if (!text) return '';
    const letter = text.match(/\b([EDCBAS])\s*[-–]?\s*(?:class|rank|tier|grade)\b/i)?.[1]
        || text.match(/\b(?:class|rank|tier|grade)\s*[:-]?\s*([EDCBAS])\b/i)?.[1]
        || (/^[EDCBAS]$/i.test(text) ? text : '');
    if (APEX_RANK.test(text) || (letter && letter.toUpperCase() === 'S' && APEX_WORD.test(text))) return 'S+';
    if (letter) return letter.toUpperCase();
    const scale = Array.isArray(schemaRanks) ? schemaRanks : [];
    const index = scale.findIndex(item => norm(item) === norm(text));
    if (index >= 0 && scale.length > 1) return RANKS[Math.round((index / (scale.length - 1)) * (RANKS.length - 1))];
    return '';
}

/* ---------- Derivation ---------- */

// Returns { attributes:[{name,value}], pools:[...], restrictions:[], derivation }.
export function deriveSheet({ race = null, profession = null, tier = '', emphasis = {}, raceName = '', professionName = '', previousPools = [] } = {}) {
    const base = race || HUMAN_PROFILE;
    // Training (profession, emphasis, rank) is shaped on the human scale, where the rank bands hold;
    // the race's difference from a human is added after, so an orc stays stronger at every rank.
    const values = { ...HUMAN_PROFILE.attributes };
    for (const [attr, delta] of Object.entries(profession?.modifiers || {})) values[attr] = (values[attr] ?? HUMAN_BASELINE) + delta;
    const dominant = (emphasis.dominant || []).map(attrKey).filter(Boolean);
    const weak = (emphasis.weak || []).map(attrKey).filter(Boolean);
    for (const attr of dominant) values[attr] += 5;
    for (const attr of weak) values[attr] -= 5;
    // Rank training budget, spread by emphasis and the profession's focus.
    const budget = RANK_BUDGET[tier] || 0;
    if (budget) {
        const weights = Object.fromEntries(ATTRIBUTES.map(attr => [attr, attr === 'Luck' ? 0.3 : 1]));
        for (const attr of profession?.focus || []) weights[attr] += 1.5;
        for (const attr of dominant) weights[attr] += 2;
        for (const attr of weak) weights[attr] = Math.min(weights[attr], 0.3);
        const sum = Object.values(weights).reduce((total, value) => total + value, 0);
        for (const attr of ATTRIBUTES) values[attr] += (budget * weights[attr]) / sum;
    }
    // Fit the peak into the rank band, scaling what lies above the human 30 so the shape is kept.
    const band = RANK_BANDS[tier];
    if (band) {
        const peak = Math.max(...ATTRIBUTES.map(attr => values[attr]));
        const target = Math.min(band[1], Math.max(band[0], peak));
        if (peak > HUMAN_BASELINE && target !== peak) {
            const k = (target - HUMAN_BASELINE) / (peak - HUMAN_BASELINE);
            for (const attr of ATTRIBUTES) if (values[attr] > HUMAN_BASELINE) values[attr] = HUMAN_BASELINE + (values[attr] - HUMAN_BASELINE) * k;
        } else if (peak <= HUMAN_BASELINE) {
            const top = ATTRIBUTES.reduce((best, attr) => values[attr] > values[best] ? attr : best, ATTRIBUTES[0]);
            values[top] = target;
        }
    }
    if (race) for (const attr of ATTRIBUTES) values[attr] += (race.attributes[attr] ?? HUMAN_BASELINE) - HUMAN_BASELINE;
    // Flavour, not math: a derived human starts within 100, other races may pass it; the story and
    // edits may push anyone further.
    const attributes = ATTRIBUTES.map(attr => ({ name: attr, value: String(clamp(values[attr], 1, race || tier === 'S+' ? 999 : 100)) }));
    const get = attr => Number(attributes.find(item => item.name === attr).value);
    const tierIndex = tier === 'S+' ? RANKS.length + 1 : tier ? RANKS.indexOf(tier) + 1 : 0;
    const magic = profession?.magic === 'none' ? 'none' : base.magic;
    const keep = (name, max) => {
        const before = (previousPools || []).find(pool => norm(pool.name) === norm(name));
        const current = Number.isFinite(Number(before?.current)) ? Math.min(Number(before.current), max) : max;
        return { name, current, max };
    };
    const pools = [
        keep('HP', Math.round((20 + get('Endurance') * 0.8 + get('Strength') * 0.2 + tierIndex * 10) * base.hp)),
        ...(magic === 'none' ? [] : [keep('MP', Math.round((get('Intelligence') + get('Wisdom')) * 0.4 * MAGIC_FACTOR[magic] + tierIndex * 5))]),
        keep('Stamina', Math.round((20 + get('Endurance') * 0.5 + get('Agility') * 0.4 + tierIndex * 5) * base.stamina)),
    ];
    return {
        attributes,
        pools,
        restrictions: magic === 'none' ? ['no magic'] : [],
        derivation: {
            race: raceName || 'human',
            ...(race ? {} : { assumedRace: true }),
            ...(professionName ? { profession: professionName } : {}),
            ...(tier ? { rank: tier } : {}),
            emphasis: { dominant, weak },
        },
    };
}

/* ---------- Flavour for the prompt (action scenes only) ---------- */

// Verbs of action only: weapon nouns, "cast", "charm", "curse", "run" fire on calm scenes (a smith
// hammering a blade, iron cast in a mould, cursing under a breath).
const ACTION_SIGNAL = /\b(fight|fights|fighting|fought|attack|attacks|attacked|attacking|strike|strikes|struck|swing|swings|swung|stab|stabs|slash|slashes|punch|punches|kick|kicks|wrestle|grapple|dodge|dodges|parry|parries|duel|battle|brawl|chase|chases|chased|flee|flees|fled|sprint|sprints|climb|climbs|lifts|lifted|haul|hauls|sneak|sneaks|crept|shoots|ambush|ambushes|charge|charges|charged|draws? (?:his|her|their|a|the) (?:sword|blade|steel|weapon|bow|axe|dagger)|draw steel|casts? (?:a |the |an )?(?:spell|hex|ward)|spell|spells|hex)\b/i;

// A fight retold ("tells Mira that Brann attacked...", "asks about the day...") is not one happening.
const RETELLING = /\b(?:tells?|told|telling|asks?(?: him| her| them)? about|asked(?: him| her| them)? about|talks? about|remembers?|remembered|recalls?|recalled|recounts?|recounted|heard|hears|the day|the time when|once)\b/i;

export function isActionScene(text) {
    return String(text || '').split(/(?<=[.!?])\s+|\n+/).some(sentence => ACTION_SIGNAL.test(sentence) && !RETELLING.test(sentence));
}

const HIGH = {
    Strength: 'heavy-handed; blows land with crushing, armour-shaking force',
    Agility: 'quick and hard to track; moves before others react',
    Endurance: 'tireless; shrugs off punishment',
    Intelligence: 'a quick, calculating mind',
    Wisdom: 'perceptive; reads people and danger early',
    Charisma: 'a commanding presence',
    Luck: 'fortune tends to favour them',
};
const LOW = {
    Strength: 'physically weak',
    Agility: 'slow and clumsy in motion',
    Endurance: 'tires quickly',
    Intelligence: 'slow to think things through',
    Wisdom: 'easily misreads people and danger',
    Charisma: 'off-putting; struggles to sway others',
    Luck: 'luck rarely goes their way',
};

function attributeMap(sheet) {
    const out = {};
    for (const item of sheet?.attributes || []) {
        const key = attrKey(item.name);
        const value = Number(item.value);
        if (key && Number.isFinite(value)) out[key] = value;
    }
    return out;
}

// One short phrase; '' when nothing stands out. A weakening status bends it ("normally ..., now ...").
export function abilityFlavour(sheet, { sappedBy = '' } = {}) {
    const attrs = attributeMap(sheet);
    const entries = Object.entries(attrs);
    if (!entries.length) return '';
    const high = entries.filter(([, value]) => value >= 45).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([attr]) => HIGH[attr]);
    const low = entries.filter(([, value]) => value <= 20).sort((a, b) => a[1] - b[1]).slice(0, 1).map(([attr]) => LOW[attr]);
    const restrictions = (sheet?.restrictions || []).includes('no magic') ? ['cannot use magic'] : [];
    let strengths = high.join('; ');
    if (strengths && sappedBy) strengths = `normally ${strengths}, now weakened by ${sappedBy}`;
    const parts = [strengths, ...low, ...restrictions].filter(Boolean);
    return parts.length ? parts.join('; ') : '';
}

// "quicker than Brann; Brann hits harder" - only for clear gaps (about one rank band).
export function clashComparison(sheet, others = []) {
    const mine = attributeMap(sheet);
    const lines = [];
    for (const other of others) {
        const theirs = attributeMap(other.sheet);
        const gap = attr => (mine[attr] ?? null) !== null && (theirs[attr] ?? null) !== null ? mine[attr] - theirs[attr] : 0;
        if (gap('Agility') >= 10) lines.push(`quicker than ${other.name}`);
        else if (gap('Agility') <= -10) lines.push(`${other.name} is quicker`);
        if (gap('Strength') >= 10) lines.push(`hits harder than ${other.name}`);
        else if (gap('Strength') <= -10) lines.push(`${other.name} hits harder`);
    }
    return lines.slice(0, 3).join('; ');
}
