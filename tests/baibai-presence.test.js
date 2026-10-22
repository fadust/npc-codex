import test from 'node:test';
import assert from 'node:assert/strict';
import { withBaiBaiPresence } from '../actor-stack.js';
import { buildInjection } from '../core.js';

const context = { chatId: 'chat', groupId: null, chatLength: 3, floor: 2 };
const actor = (id, name, extra = {}) => ({ id, name, aliases: [], present: false, worldActive: true, ...extra });
const floor = () => ({ apiVersion: 1, floor: 2, role: 'assistant', chat: { id: 'chat', groupId: null, length: 3 },
    memory: { valid: true, presenceSourceValid: true, delta: { sceneFocus: { situation: 'Ari waits here.', participants: ['Ari Vale'] } } } });
const apply = (npcs, source = floor(), ctx = context) => withBaiBaiPresence(npcs, { getFloor: () => source }, ctx);

test('fresh presence reaches the actor prompt without mutating dossiers or adding information', () => {
    const npcs = [actor('ari', 'Ari Vale', { personality: 'Patient', knowledge: [] }), actor('senn', 'Senn', { present: true })];
    const before = structuredClone(npcs);
    const result = apply(npcs);
    assert.equal(result[0].present, true);
    assert.equal(result[0].worldActive, false);
    assert.equal(result[1].present, true); // omission never removes an actor
    assert.deepEqual(npcs, before);
    assert.deepEqual(result[0], { ...before[0], present: true, worldActive: false });
    assert.match(buildInjection(result, '', 1), /Ari Vale/);
    assert.doesNotMatch(buildInjection(result, '', 1), /Ari waits here/);
});

test('stale, cross-chat, cross-group, wrong-floor and unavailable results fail closed', () => {
    const npcs = [actor('ari', 'Ari Vale')];
    for (const change of [s => s.memory.presenceSourceValid = false, s => delete s.memory.presenceSourceValid,
        s => s.memory.valid = false, s => s.chat.id = 'other', s => s.chat.groupId = 'group',
        s => s.chat.length++, s => s.floor--, s => s.omitted = true, s => s.role = 'user']) {
        const source = floor(); change(source); assert.deepEqual(apply(npcs, source), npcs);
    }
    assert.equal(withBaiBaiPresence(npcs, { getFloor() { throw Error('offline'); } }, context), npcs);
    for (const focus of [undefined, null, { situation: 'Ended', participants: [] }]) {
        const source = floor(); source.memory.delta.sceneFocus = focus;
        assert.deepEqual(apply(npcs, source), npcs);
    }
});

test('ambiguous names, role labels, locks, archived actors and terminal death cannot be promoted', () => {
    for (const extra of [{ archived: true }, { lifeState: 'deceased', lifeStateCertainty: 'explicit' },
        { archiveReason: 'deceased' }, { manualProfileFields: ['present'] }, { manualProfileFields: ['worldActive'] }]) {
        const npcs = [actor('ari', 'Ari Vale', extra)]; assert.deepEqual(apply(npcs), npcs);
    }
    const npcs = [actor('ari', 'Ari Vale', { aliases: ['Ari', 'Healer'] }), actor('senn', 'Ari Senn', { aliases: ['Ari'], archived: true })];
    for (const name of ['Ari', 'Healer', 'Unknown Person', 'ari']) {
        const source = floor(); source.memory.delta.sceneFocus.participants = [name];
        assert.deepEqual(apply(npcs, source), npcs);
    }
    assert.equal(apply(npcs)[0].present, true);
    assert.equal(apply([], floor()).length, 0);
});

test('late arrival and invalidation recompute from original scan, without sticky presence', () => {
    const npcs = [actor('ari', 'Ari Vale')];
    const source = floor(); source.memory.presenceSourceValid = false;
    assert.equal(apply(npcs, source)[0].present, false);
    source.memory.presenceSourceValid = true;
    assert.equal(apply(npcs, source)[0].present, true);
    source.memory.presenceSourceValid = false;
    assert.equal(apply(npcs, source)[0].present, false);
});
