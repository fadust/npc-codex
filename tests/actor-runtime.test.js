import test from 'node:test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function ariChecks(mockState, eventSource, manualAddNpc, sleep, extRoot) {
    const runtime = globalThis.NPCStateDelta;
    const fixture = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'tests/fixtures/layer1-ari.json'), 'utf8'));
    const settings = mockState.extensionSettings.npc_state_delta;
    Object.assign(settings, { autoScan: false, enabled: true, inject: true });
    Object.assign(mockState.context, { name2: fixture.card.name, characters: [{ ...fixture.card, avatar: 'ari.png' }], characterId: 0 });
    await manualAddNpc(fixture.card.name);
    await runtime.flush();
    assert.equal(runtime.ownsActor(fixture.card.name), true);
    mockState.context.characters[0].description += '\n[NPC Codex: narrator]';
    assert.equal(runtime.ownsActor(fixture.card.name), false);
    assert.equal(runtime.actorProfiles().length, 0);
    assert.ok(runtime.getState().npcs.some(n => n.name === fixture.card.name), 'designation preserves dossiers');
    mockState.context.characters[0].description = fixture.card.description;
    assert.equal(runtime.ownsActor(fixture.card.name), true);
    const profiles = runtime.actorProfiles();
    profiles.find(n => n.name === fixture.card.name).aliases.push('mutable copy');
    assert.ok(!runtime.actorProfiles().some(n => n.aliases.includes('mutable copy')));
    settings.inject = false;
    assert.equal(runtime.ownsActor(fixture.card.name), false, 'BaiBai regains its fallback when actor injection is disabled');
    settings.inject = true;
    mockState.context.chat = [{ is_user: false, name: 'Narrator', mes: `${fixture.card.name} enters. The healer speaks.` }];
    let revision = 'ari-old', calls = 0;
    globalThis.Saga = { bridge: {
        canonStatus: () => ({ enabled: true }), canonRevision: () => revision,
        queryCanon: async () => ({ status: 'no-match', evidence: [] }),
    } };
    const before = runtime.getState().npcs;
    mockState.quietResponder = async () => {
        calls++; revision = 'ari-new';
        return JSON.stringify({ npcs: [{ name: fixture.card.name, present: true, mood: 'unsupported change' }] });
    };
    assert.equal(await runtime.scan(), false, 'source changes during provider work cancel the commit');
    assert.ok(calls > 0);
    assert.deepEqual(runtime.getState().npcs, before, 'the stale scan changes no accepted actor');
    delete globalThis.Saga;
    await runtime.flush();
}

function runAriHostChecks(checks) {
    let source = fs.readFileSync(new URL('./runtime-smoke.mjs', import.meta.url), 'utf8');
    source = source.replace('const here = path.dirname(fileURLToPath(import.meta.url));', `const here = ${JSON.stringify(fileURLToPath(new URL('.', import.meta.url)))};`);
    const start = source.indexOf('try {\n    await import(pathToFileURL(path.join(extRoot');
    const end = source.lastIndexOf('} finally {');
    if (start < 0 || end < start) throw new Error('Runtime harness boundary changed');
    source = source.slice(0, start) + `try {\n    await import(pathToFileURL(path.join(extRoot, 'index.js')).href);\n    await sleep(100);\n    await (${checks.toString()})(mockState, eventSource, manualAddNpc, sleep, extRoot);\n` + source.slice(end);
    execFileSync(process.execPath, ['--import', new URL('./active-runtime-test-setup.mjs', import.meta.url).href, '--input-type=module'], {
        input: source, encoding: 'utf8', timeout: 40000, maxBuffer: 8 * 1024 * 1024,
    });
}

test('Ari fixture executes ownership, read-only profiles and stale canon rejection in the production controller', () => runAriHostChecks(ariChecks));

async function ariAutomaticChecks(mockState, eventSource, manualAddNpc, sleep, extRoot) {
    const runtime = globalThis.NPCStateDelta;
    const fixture = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'tests/fixtures/layer1-ari.json'), 'utf8'));
    const settings = mockState.extensionSettings.npc_state_delta;
    Object.assign(settings, { autoScan: true, scanEvery: 1, enabled: true, inject: true, fullScanEveryTurn: false });
    Object.assign(mockState.context, { name2: fixture.card.name, characters: [{ ...fixture.card, avatar: 'ari.png' }], characterId: 0, chat: [] });
    let turn = 0, promptEpoch = 0;
    globalThis.Saga = { bridge: {
        canonStatus: () => ({ enabled: true }), canonRevision: () => 'unchanged-source',
        queryCanon: async () => ({ status: 'no-match', entries: [] }),
    } };
    mockState.quietResponder = async (args = {}) => {
        assert.doesNotMatch(JSON.stringify(args), /PLANNING_ONLY_FALSE_DEATH/, 'Floris planning is not scanner evidence');
        promptEpoch++; // quiet-generation cleanup does not change the canon-source epoch.
        if (!/isolated dossier scanner/i.test(args.systemPrompt || '')) return '{"people":[],"npcs":[]}';
        return JSON.stringify({ npcs: [{ name: fixture.card.name, present: turn < 9,
            ...(turn === 1 ? { personality: 'deliberate', speech: 'speaks softly' } : {}),
            mood: `calm at the river on turn ${turn}`, relationshipImpact: 'none',
            ...(turn === 9 ? { lifeState: 'deceased', lifeStateCertainty: 'explicit', lifeStateReason: 'Ari Vale died in the flood.' } : {}),
        }] });
    };
    for (turn = 1; turn <= 10; turn++) {
        mockState.context.chat.push({ is_user: true, mes: `Continue turn ${turn}.` });
        const story = turn === 9 ? 'Ari Vale died in the flood. His death is explicitly confirmed.' : turn === 10
            ? 'The traveller remembers Ari Vale, who remains deceased.'
            : `Ari Vale is deliberate and speaks softly. Ari Vale is calm at the river on turn ${turn}.`;
        mockState.context.chat.push({ is_user: false, name: fixture.card.name, mes: story + '\n<log>PLANNING_ONLY_FALSE_DEATH: Ari Vale dies next turn.</log>', swipe_id: 0 });
        const messageId = mockState.context.chat.length - 1;
        eventSource.emit('message_received', messageId);
        if (turn === 5) mockState.context.chat[messageId].mes += '\n[COLORS:Ari Vale=#9cb8c9]';
        for (let i = 0; i < 100 && runtime.getState().lastScannedMessageId !== messageId; i++) await sleep(20);
        assert.equal(runtime.getState().lastScannedMessageId, messageId, `automatic turn ${turn} must APPLY, not merely dispatch`);
        await runtime.flush();
        const ari = runtime.getState().npcs.find(n => n.name === fixture.card.name);
        assert.ok(ari, 'main actor admitted without manual scan');
        assert.match(ari.personality, /deliberate/);
        if (turn < 9) assert.match(runtime.injectionPreview().text, /speaks softly/);
        else assert.equal(ari.lifeState, 'deceased');
        if (turn === 10) assert.doesNotMatch(runtime.injectionPreview().text, /PORTRAYAL ONLY/);
    }
    assert.ok(promptEpoch >= 10);
    delete globalThis.Saga;
}
test('Ari ten-turn production event loop applies automatic scans, personality and terminal continuity without manual rescue', () => runAriHostChecks(ariAutomaticChecks));
