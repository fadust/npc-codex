import test from 'node:test';
import assert from 'node:assert/strict';
import { chatLineage, lineageCheckpointKey, imageNpcsAtFloor } from '../branch.js';
import { buildNpcPortraitPrompts } from '../core.js';

test('image appearance uses current accepted state or an exact matching historical checkpoint, without mutation', () => {
    const chat = [{ is_user: false, mes: 'Ari has red hair.' }, { is_user: true, mes: 'Later.' }, { is_user: false, mes: 'Ari dyes her hair blue.' }];
    const lineage = chatLineage(chat);
    const old = [{ id: 'ari', name: 'Ari', appearance: 'red hair' }];
    const current = [{ id: 'ari', name: 'Ari', appearance: 'blue hair' }];
    const state = { npcs: current, lineage, lastScannedMessageId: 2, checkpoints: [{ messageId: 0, lineageKey: lineageCheckpointKey(lineage, 0), snapshot: { npcs: old } }] };
    const before = JSON.stringify(state);
    assert.equal(imageNpcsAtFloor(state, chat, 2), current);
    assert.equal(imageNpcsAtFloor(state, chat, 0), old);
    assert.equal(imageNpcsAtFloor(state, chat, 1), null);
    assert.equal(imageNpcsAtFloor(state, [{ ...chat[0], mes: 'Different branch.' }, ...chat.slice(1)], 0), null);
    assert.equal(imageNpcsAtFloor(state, chat.slice(0, 1), 0), old);
    assert.equal(JSON.stringify(state), before);
});

test('semantic identity reference shares the portrait form resolver and omits alternate anatomy and private state', () => {
    const npc = { name: 'Ari', species: 'Dragon', gender: 'female', currentForm: 'Human',
        appearanceForms: [{ name: 'Human', appearance: 'a human woman with red hair and green eyes, wearing a blue coat' }, { name: 'Dragon', appearance: 'silver scales and huge wings' }],
        knowledge: [{ fact: 'Private password' }] };
    const prompt = buildNpcPortraitPrompts(npc, { format: 'natural', composition: '', stylePositive: '', styleNegative: '', useMood: false, useLocation: false }).positive;
    assert.match(prompt, /red hair.*green eyes/);
    assert.doesNotMatch(prompt, /silver scales|huge wings|Private password|Dragon/);
});
