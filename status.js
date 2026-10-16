/* NPC Codex: active status timing and its feedback into the story (fadust fork).
 *
 * The story feeds a status in (the cast pass records it, grounded); the status feeds back into
 * every scene the NPC is in, as behaviour. Time moves it, by kind:
 *  - AFFLICTIONS (poison, illness, bleeding, infection, curse): the duration is a window, not an
 *    end. Untreated past the window, the status escalates one stage: mild -> moderate -> severe ->
 *    dying. Treatment in the story steps it down or clears it. Code never kills: "dying" is the
 *    last stage, and death only comes from the story.
 *  - BUFFS / DEBUFFS / plain statuses: when their time runs out they fade for one turn ("wearing
 *    off") for a natural exit, then expire.
 *  - Injuries stay until the story heals them (a bleeding wound counts as an affliction).
 * Story days come from the World State date when known; otherwise turns.
 * An UNAWARE status (a slow poison the NPC has not noticed) shows symptoms without the cause.
 *
 * Pure module: no host, DOM or storage access. */

export const AFFLICTIONS = Object.freeze(['poison', 'illness', 'bleeding', 'infection', 'curse']);
export const LADDER = Object.freeze(['mild', 'moderate', 'severe', 'dying']);
// Default windows for an affliction "until treated" (genre pacing; days when the date is known).
const DEFAULT_WINDOW = { poison: { days: 1, turns: 6 }, illness: { days: 3, turns: 12 }, bleeding: { days: 1, turns: 3 }, infection: { days: 2, turns: 10 }, curse: { days: 7, turns: 30 } };
const WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10 };

export function isAffliction(condition) {
    return AFFLICTIONS.includes(condition?.kind) || (condition?.kind === 'injury' && /\bbleed/i.test(condition?.name || ''));
}

export function stageOf(condition) {
    const text = String(condition?.severity || '').toLowerCase();
    if (/dying|critical|fatal|deadly/.test(text)) return 3;
    if (/severe|serious|heavy|grave|bad/.test(text)) return 2;
    if (/mild|light|minor|slight/.test(text)) return 0;
    return 1;
}

// "3 days", "an hour", "until dawn", "until treated" -> { days?, turns?, open? }
export function parseDuration(text) {
    const value = String(text || '').toLowerCase();
    if (!value) return {};
    if (/until (?:it is |they are |she is |he is )?(?:treated|cured|healed|removed|lifted|broken)|untreated|until (?:an? )?(?:antidote|cure|healer)/.test(value)) return { open: true };
    const match = value.match(/\b(\d+|an?|one|two|three|four|five|six|seven|ten)\s+(minute|hour|day|night|week|turn|round|scene)s?\b/);
    if (match) {
        const count = Number(match[1]) || WORDS[match[1]] || 1;
        const unit = match[2];
        if (unit === 'week') return { days: count * 7, turns: count * 20 };
        if (unit === 'day' || unit === 'night') return { days: count, turns: count * 3 };
        if (unit === 'hour') return { days: count >= 12 ? 1 : 0, turns: Math.max(1, Math.ceil(count / 2)) };
        return { turns: Math.max(1, count === 1 && unit === 'scene' ? 3 : Math.ceil(count / 10)) };
    }
    if (/until (?:dawn|morning|sunrise|tomorrow|nightfall|dusk|sunset|tonight|midnight)/.test(value)) return { days: 1, turns: 3 };
    if (/(?:end of|until) the (?:fight|battle|scene|encounter)/.test(value)) return { turns: 2 };
    return {};
}

function windowFor(condition) {
    const parsed = parseDuration(condition.until);
    if (isAffliction(condition)) return parsed.days || parsed.turns ? parsed : (DEFAULT_WINDOW[condition.kind] || DEFAULT_WINDOW.illness);
    return parsed.days || parsed.turns ? parsed : null;
}

function deadlineFrom(window, { turn, day }) {
    if (!window) return null;
    const out = {};
    if (Number.isInteger(day) && window.days) out.day = day + window.days;
    if (Number.isInteger(turn) && window.turns) out.turn = turn + window.turns;
    return Object.keys(out).length ? out : null;
}

function passed(deadline, { turn, day }) {
    if (!deadline) return false;
    if (Number.isInteger(deadline.day) && Number.isInteger(day)) return day >= deadline.day;
    return Number.isInteger(deadline.turn) && Number.isInteger(turn) && turn >= deadline.turn;
}

// Gives new statuses their onset and deadline. A re-mentioned status keeps its clock.
export function scheduleStatuses(conditions, now) {
    return (Array.isArray(conditions) ? conditions : []).map(condition => {
        if (condition.onset) return condition;
        const onset = { ...(Number.isInteger(now.turn) ? { turn: now.turn } : {}), ...(Number.isInteger(now.day) ? { day: now.day } : {}) };
        const deadline = deadlineFrom(windowFor(condition), now);
        return { ...condition, onset, ...(deadline ? { deadline } : {}) };
    });
}

// Moves statuses on with time. Returns { conditions, events[] } (events go to the item log).
export function tickStatuses(conditions, now) {
    const events = [];
    const out = [];
    for (const condition of Array.isArray(conditions) ? conditions : []) {
        if (!passed(condition.deadline, now)) { out.push(condition); continue; }
        if (isAffliction(condition)) {
            const stage = stageOf(condition);
            if (stage >= LADDER.length - 1) { out.push({ ...condition, deadline: undefined }); continue; }
            const next = LADDER[stage + 1];
            out.push({ ...condition, severity: next, deadline: deadlineFrom(windowFor(condition), now) || undefined });
            events.push({ op: 'escalated', item: `${condition.name} (${next})` });
        } else if (!condition.fading) {
            out.push({ ...condition, fading: true, deadline: Number.isInteger(now.turn) ? { turn: now.turn + 1 } : undefined });
            events.push({ op: 'fading', item: condition.name });
        } else {
            events.push({ op: 'expired', item: condition.name });
        }
    }
    return { conditions: out, events };
}

// Treatment in the story: one stage down, or gone from mild.
export function treatStatus(condition) {
    const stage = stageOf(condition);
    if (!isAffliction(condition) || stage === 0) return null;
    return { ...condition, severity: LADDER[stage - 1], onset: undefined, deadline: undefined };
}

function elapsed(condition, now) {
    if (Number.isInteger(condition.onset?.day) && Number.isInteger(now.day) && now.day > condition.onset.day) {
        const days = now.day - condition.onset.day;
        return `${days} day${days === 1 ? '' : 's'}`;
    }
    return '';
}

function weight(condition) {
    return (isAffliction(condition) ? 10 : 0) + stageOf(condition) * 2 + (condition.kind === 'injury' ? 3 : 0);
}

// The behaviour line for a present NPC: up to three statuses, most serious first.
export function renderStatusInjection(conditions, now = {}) {
    const list = (Array.isArray(conditions) ? conditions : []).slice().sort((a, b) => weight(b) - weight(a)).slice(0, 3);
    if (!list.length) return '';
    const lines = list.map(condition => {
        if (condition.fading) return `${condition.name} is wearing off`;
        const since = isAffliction(condition) && elapsed(condition, now) ? `, untreated ${elapsed(condition, now)}` : '';
        const severity = condition.severity ? `${condition.severity}${since}` : since.replace(/^, /, '');
        const effect = condition.effect ? `: ${condition.effect}` : '';
        const cause = condition.aware === false ? '; does not know the cause' : '';
        return `${condition.name}${severity ? ` (${severity})` : ''}${effect}${cause}`;
    });
    return `CONDITION (shapes behaviour now): ${lines.join(' | ')}`;
}

// The status that saps ability flavour, if any.
export function sappingStatus(conditions) {
    const hit = (Array.isArray(conditions) ? conditions : []).find(condition => !condition.fading
        && ((isAffliction(condition) && stageOf(condition) >= 1) || condition.kind === 'debuff' || (condition.kind === 'injury' && stageOf(condition) >= 2)));
    return hit ? hit.name : '';
}

export function statusStateText(condition) {
    return [
        condition?.fading ? 'wearing off' : '',
        isAffliction(condition) ? (condition.severity || LADDER[stageOf(condition)]) : '',
        condition?.aware === false ? 'unaware' : '',
    ].filter(Boolean).join(' · ');
}
