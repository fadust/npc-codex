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
