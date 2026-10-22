import test from 'node:test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function imageChecks(mockState, eventSource, manualAddNpc, sleep) {
    const runtime = globalThis.NPCStateDelta;
    mockState.context.groupId = null;
    mockState.context.chatId = 'image-appearance';
    mockState.context.getCurrentChatId = () => mockState.context.chatId;
    mockState.context.chat = [{ is_user: false, name: 'Narrator', mes: 'Ari Vale waits in human form.' }];
    eventSource.emit('chat_changed');
    await sleep(120);
    await manualAddNpc('Ari Vale');
    const npc = runtime.getState().npcs.find(item => item.name === 'Ari Vale');
    if (!await runtime.updateAppearance(npc.id, {
        overallAppearance: 'Amber eyes', currentForm: 'Human', formsText: 'Human | Copper hair; blue coat\nFox | Red fur; white-tipped tail',
    }, { chatKey: runtime.uiStatus().chatKey })) throw new Error('Appearance edit failed');
    const request = { chatId: 'image-appearance', groupId: null, floor: 0, sourceText: mockState.context.chat[0].mes };
    const before = JSON.stringify(runtime.getState());
    const data = runtime.imageActors(request);
    const actor = data?.actors.find(item => item.id === npc.id);
    if (!actor || !/Copper hair/.test(actor.appearance) || /Red fur/.test(actor.appearance)) throw new Error('Image API did not use the accepted current form');
    if (Object.keys(actor).sort().join(',') !== 'aliases,appearance,archived,id,name') throw new Error('Image API exposed unrelated dossier fields');
    if (runtime.imageActors({ ...request, chatId: 'other' }) !== null) throw new Error('Cross-chat image read accepted');
    if (runtime.imageActors({ ...request, sourceText: 'Changed story.' }) !== null) throw new Error('Stale source image read accepted');
    if (JSON.stringify(runtime.getState()) !== before) throw new Error('Read-only image API mutated a dossier');
    await runtime.flush();
    // Exercise the real creation -> accepted appearance -> automatic image-save hooks.
    const previousCreate = document.createElement;
    const previousBridge = globalThis.STBaiBaiImage;
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (url, options) => String(url).startsWith('data:image/')
        ? Promise.resolve(new Response(Buffer.from(String(url).split(',')[1], 'base64'), { headers: { 'Content-Type': 'image/png' } }))
        : previousFetch(url, options);
    globalThis.FileReader = class { readAsDataURL(file) { void file.arrayBuffer().then(bytes => { this.result = `data:${file.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload?.(); }); } };
    globalThis.Image = class { set src(value) { this._src = value; this.width = 64; this.height = 96; queueMicrotask(() => this.onload?.()); } get src() { return this._src; } };
    document.createElement = function (tag, ...rest) {
        if (String(tag).toLowerCase() !== 'canvas') return previousCreate?.call(this, tag, ...rest);
        return { width: 0, height: 0, getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/webp;base64,AAAA' };
    };
    const calls = [];
    globalThis.STBaiBaiImage = { apiVersion: 1, getBackendStatus: () => ({ configured: true }), generate: async request => {
        calls.push(request); return { dataUrl: 'data:image/png;base64,AAAA', seed: calls.length === 1 ? 4242 : 9999 };
    } };
    mockState.extensionSettings.npc_codex.autoNewNpcImages = true;
    await manualAddNpc('Mira Vale');
    await sleep(30);
    if (calls.length) throw new Error('Blank new appearance triggered image generation');
    const newcomer = runtime.getState().npcs.find(item => item.name === 'Mira Vale');
    await runtime.updateAppearance(newcomer.id, { overallAppearance: 'Copper hair; green eyes', currentForm: '', formsText: '', currentAppearance: 'blue coat' }, { chatKey: runtime.uiStatus().chatKey });
    const deadline = Date.now() + 5000;
    while (!runtime.getNpc(newcomer.id)?.portrait?.fullBody?.dataUrl && Date.now() < deadline) await sleep(20);
    const imaged = runtime.getNpc(newcomer.id);
    if (calls.length !== 2 || !imaged?.portrait?.dataUrl || !imaged.portrait.fullBody?.dataUrl) throw new Error(`New dossier did not receive both automatic images: ${JSON.stringify({ calls: calls.length, appearance: imaged?.appearance, portrait: imaged?.portrait, pending: runtime.getState().pendingBackfills })}`);
    if (imaged.portraitSeed !== 4242 || calls[1].seed !== 4242) throw new Error('Actual face seed was not retained');
    if (runtime.getNpc(npc.id).portrait?.dataUrl) throw new Error('Enabling automation generated an existing-roster backlog');
    mockState.extensionSettings.npc_codex.autoNewNpcImages = false;
    await sleep(30);
    await runtime.flush();
    document.createElement = previousCreate;
    globalThis.STBaiBaiImage = previousBridge;
    globalThis.fetch = previousFetch;
}

test('image appearance public API uses the real controller and rejects wrong chat or edited text', () => {
    let source = fs.readFileSync(new URL('./runtime-smoke.mjs', import.meta.url), 'utf8');
    source = source.replace('const here = path.dirname(fileURLToPath(import.meta.url));', `const here = ${JSON.stringify(fileURLToPath(new URL('.', import.meta.url)))};`);
    const marker = "    console.log('Runtime smoke:";
    if (!source.includes(marker)) throw new Error('Runtime smoke cleanup marker changed');
    source = source.replace(marker, `    await (${imageChecks.toString()})(mockState, eventSource, manualAddNpc, sleep);\n${marker}`);
    execFileSync(process.execPath, ['--import', new URL('./active-runtime-test-setup.mjs', import.meta.url).href, '--input-type=module'], {
        input: source, encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024,
    });
});
