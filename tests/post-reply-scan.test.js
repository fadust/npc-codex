import test from 'node:test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The host awaits each MESSAGE_RECEIVED listener in turn, so the dossier scan must start without
// holding that chain. Turn Queue still reads isBusy while it runs, and a reply that lands during
// the scan is queued, then scanned once the first one settles.
async function postReplyChecks(mockState, eventSource, manualAddNpc, sleep) {
    const fail = message => { throw new Error(message); };
    const scannerCalls = () => mockState.rawCalls.filter(call => /isolated dossier scanner/i.test(String(call?.[0]?.systemPrompt || ''))).length;
    const previousResponder = mockState.quietResponder;
    let release = null;
    let held = 0;
    mockState.quietResponder = async (args = {}) => {
        if (/isolated dossier scanner/i.test(String(args.systemPrompt || ''))) {
            held++;
            await new Promise(resolve => { release = resolve; });
        }
        return '{"npcs":[]}';
    };

    mockState.context.groupId = null;
    mockState.context.chatId = 'post-reply-fire-and-forget';
    mockState.context.getCurrentChatId = () => mockState.context.chatId;
    mockState.context.chat = [
        { is_user: true, is_system: false, name: 'Kazuma', mes: 'Kazuma greets Lena at the gate.' },
    ];
    eventSource.emit('chat_changed');
    await sleep(150);
    await manualAddNpc('Lena Gate');
    await globalThis.NPCStateDelta.flush();
    await sleep(100);

    const listeners = mockState.listeners.get('message_received') || [];
    if (!listeners.length) fail('no MESSAGE_RECEIVED listener is registered');
    const before = scannerCalls();
    mockState.context.chat.push({ is_user: false, is_system: false, name: 'Narrator', mes: 'Lena nods and opens the gate for Kazuma.', swipe_id: 0 });
    const returned = listeners.map(fn => fn(1));
    if (returned.some(value => value && typeof value.then === 'function')) fail('the MESSAGE_RECEIVED listener returned a promise the host would await');
    await sleep(300);
    if (scannerCalls() !== before + 1 || held !== 1) fail(`the post-reply scan did not start (scanner calls ${scannerCalls() - before})`);
    if (window.NPCCodex.isBusy() !== true) fail('isBusy was false while the post-reply scan was still running');

    // A second reply while the first scan is held is queued, not scanned in parallel.
    mockState.context.chat.push({ is_user: true, is_system: false, name: 'Kazuma', mes: 'Kazuma thanks her.' });
    mockState.context.chat.push({ is_user: false, is_system: false, name: 'Narrator', mes: 'Lena smiles and waves Kazuma through.', swipe_id: 0 });
    for (const fn of listeners) fn(3);
    await sleep(300);
    if (scannerCalls() !== before + 1) fail('a second scan started while the first was still running');

    // Releasing the first scan settles it and drains the queued reply.
    release();
    for (let i = 0; i < 40 && held < 2; i++) await sleep(50);
    if (held !== 2) fail('the reply queued during the busy scan was never scanned');
    release();
    for (let i = 0; i < 40 && window.NPCCodex.isBusy(); i++) await sleep(50);
    if (window.NPCCodex.isBusy()) fail('isBusy stayed true after both scans settled');

    mockState.quietResponder = previousResponder;
    setTimeout(() => process.exit(0), 300);
}

test('the post-reply scan runs without holding the host event chain, stays busy and queues overlapping replies', () => {
    let source = fs.readFileSync(new URL('./runtime-smoke.mjs', import.meta.url), 'utf8');
    source = source.replace('const here = path.dirname(fileURLToPath(import.meta.url));', `const here = ${JSON.stringify(fileURLToPath(new URL('.', import.meta.url)))};`);
    const marker = "    console.log('Runtime smoke:";
    if (!source.includes(marker)) throw new Error('Runtime smoke cleanup marker changed');
    source = source.replace(marker, `    await (${postReplyChecks.toString()})(mockState, eventSource, manualAddNpc, sleep);\n${marker}`);
    execFileSync(process.execPath, ['--import', new URL('./active-runtime-test-setup.mjs', import.meta.url).href, '--input-type=module'], {
        input: source,
        encoding: 'utf8',
        timeout: 90000,
        maxBuffer: 8 * 1024 * 1024,
    });
});
