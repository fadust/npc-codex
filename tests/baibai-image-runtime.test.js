import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function imageEditChecks(mockState, eventSource, manualAddNpc, sleep, sourceRoot, fs, path, assert) {
    // BaiBai emits MESSAGE_EDITED after saving tags; actual prose edits must still rescan.
    mockState.context.chatId = 'ari-image-edit';
    mockState.context.getCurrentChatId = () => 'ari-image-edit';
    const ariFixture = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'tests/fixtures/layer1-ari.json'), 'utf8'));
    mockState.context.characters[mockState.context.characterId] = { ...ariFixture.card, avatar: 'ari-fixture.png' };
    mockState.context.chat = [{ is_user: true, mes: 'Kai greets Ari Vale.' }, { is_user: false, mes: 'Ari Vale speaks softly beside the river.' }];
    eventSource.emit('chat_changed');
    await sleep(150);
    await manualAddNpc('Ari Vale');
    let releaseImageScan;
    let imageScanEntered;
    const imageScanGate = new Promise(resolve => { imageScanEntered = resolve; });
    const imageScanHold = new Promise(resolve => { releaseImageScan = resolve; });
    mockState.quietResponder = async () => {
        imageScanEntered();
        await imageScanHold;
        return JSON.stringify({ npcs: [{ name: 'Ari Vale', present: true, mood: mockState.context.chat[1].mes.includes('angrily') ? 'angry' : 'calm' }] });
    };
    const inFlightImageScan = globalThis.NPCStateDelta.scan();
    await imageScanGate;
    mockState.context.chat[1].mes += '\n<bbi_image>blue ribbon<nl>Ari at the river</nl><size>portrait</size></bbi_image>';
    eventSource.emit('message_edited', 1);
    await sleep(180);
    releaseImageScan();
    assert.equal(await inFlightImageScan, true, 'tag insertion during scanning must not discard valid results');
    await globalThis.NPCStateDelta.flush();
    const beforeImageCalls = mockState.rawCalls.length;
    const beforeImageState = globalThis.NPCStateDelta.getState();
    mockState.context.chat[1].mes = mockState.context.chat[1].mes.replace('blue ribbon', 'green ribbon');
    eventSource.emit('message_edited', 1);
    await sleep(350);
    assert.equal(mockState.rawCalls.length, beforeImageCalls, 'tag-only edit must not dispatch an NPC request');
    assert.equal(globalThis.NPCStateDelta.getState().turn, beforeImageState.turn, 'tag edit must not rewind the receipt turn');
    mockState.context.chat[1].mes = mockState.context.chat[1].mes.replace('speaks softly', 'shouts angrily');
    eventSource.emit('message_edited', 1);
    await sleep(800);
    assert.ok(mockState.rawCalls.length > beforeImageCalls, 'real prose edit must dispatch a new scan');
    assert.equal(globalThis.NPCStateDelta.getState().npcs.find(n => n.name === 'Ari Vale')?.mood, 'angry');
    mockState.quietResponder = null;

}

test('Ari host: image edits do not duplicate or invalidate scans; real story edits update', () => {
    let source = fs.readFileSync(new URL('./runtime-smoke.mjs', import.meta.url), 'utf8');
    source = source.replace('const here = path.dirname(fileURLToPath(import.meta.url));', `const here = ${JSON.stringify(fileURLToPath(new URL('.', import.meta.url)))};`);
    const marker = "    console.log('Runtime smoke:";
    assert.ok(source.includes(marker));
    source = source.replace(marker, `    await (${imageEditChecks.toString()})(mockState, eventSource, manualAddNpc, sleep, sourceRoot, fs, path, assert);\n${marker}`);
    const run = spawnSync(process.execPath, ['--import', new URL('./active-runtime-test-setup.mjs', import.meta.url).href, '--input-type=module'], { input: source, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(run.status, 0, run.stderr);
});
