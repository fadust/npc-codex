import test from 'node:test';
import assert from 'node:assert/strict';
import { generateNewNpcImages } from '../portrait-tools.js';

function fixture() {
    const npc = { id: 'ari', name: 'Ari Vale', appearance: 'red hair and green eyes; blue coat', portraitSeed: null };
    const calls = [], seeds = [], saves = [];
    let chatKey = 'chat-a';
    const runtime = {
        getNpc: id => id === npc.id ? structuredClone(npc) : null,
        uiStatus: () => ({ chatKey }),
        portraitSettings: () => ({ autoNewNpcImages: true, portraitGenerationEnabled: true }),
        portraitPrompts: (_id, { slot }) => ({ positive: `A woman with red hair and green eyes wears a blue coat. ${slot === 'face' ? 'Show her face and shoulders.' : 'Show her entire body and both feet.'}`, negative: '' }),
        setPortrait: async (_id, file, options) => {
            assert.equal(file.type, 'image/png');
            if (!options.isCurrent()) return false;
            npc.portrait ||= {};
            if (options.slot === 'face') npc.portrait.dataUrl = 'face';
            else npc.portrait.fullBody = { dataUrl: 'body' };
            saves.push(options.slot);
            return true;
        },
        setPortraitSeed: async (_id, seed, options) => { if (!options.isCurrent()) return false; npc.portraitSeed = seed; seeds.push(seed); return true; },
        flush: async () => true,
    };
    const bridge = { apiVersion: 1, getBackendStatus: () => ({ configured: true }), generate: async request => {
        calls.push(request);
        return { dataUrl: 'data:image/png;base64,AAAA', seed: calls.length === 1 ? 4242 : 9999 };
    } };
    return { npc, runtime, bridge, calls, seeds, saves, leave: () => { chatKey = 'other'; } };
}

async function withFixture(run) {
    const old = [globalThis.NPCCodex, globalThis.STBaiBaiImage];
    const f = fixture();
    globalThis.NPCCodex = f.runtime; globalThis.STBaiBaiImage = f.bridge;
    try { await run(f); } finally { [globalThis.NPCCodex, globalThis.STBaiBaiImage] = old; }
}

test('automatic creation images save both empty slots and retain the actual face seed', () => withFixture(async f => {
    assert.equal(await generateNewNpcImages(f.npc.id, { chatKey: 'chat-a' }), true);
    assert.deepEqual(f.saves, ['face', 'fullBody']);
    assert.deepEqual(f.seeds, [4242]);
    assert.equal(f.npc.portraitSeed, 4242);
    assert.equal(f.calls[1].seed, 4242);
    assert.equal(f.calls[0].nl, f.calls[0].prompt);
}));

test('automatic images preserve occupied slots and saved seeds', () => withFixture(async f => {
    f.npc.portrait = { dataUrl: 'manual-face' }; f.npc.portraitSeed = 81;
    await generateNewNpcImages(f.npc.id, { chatKey: 'chat-a' });
    assert.deepEqual(f.saves, ['fullBody']);
    assert.equal(f.npc.portrait.dataUrl, 'manual-face');
    assert.equal(f.npc.portraitSeed, 81);
    await generateNewNpcImages(f.npc.id, { chatKey: 'chat-a' });
    assert.equal(f.calls.length, 1);
}));

test('changed appearance or chat rejects a late automatic result', () => withFixture(async f => {
    const generate = f.bridge.generate;
    f.bridge.generate = async request => { f.npc.appearance = 'now blue hair'; f.leave(); return generate(request); };
    assert.equal(await generateNewNpcImages(f.npc.id, { chatKey: 'chat-a' }), false);
    assert.deepEqual(f.saves, []);
    assert.deepEqual(f.seeds, []);
}));
