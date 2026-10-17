import test from 'node:test';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

async function ariChecks(mockState, eventSource, manualAddNpc, sleep, extRoot) {
    const runtime = globalThis.NPCStateDelta;
    const fixture = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'tests/fixtures/layer1-ari.json'), 'utf8'));
    const settings = mockState.extensionSettings.npc_state_delta;
    Object.assign(settings, { autoScan: false, enabled: true, inject: true });
    await manualAddNpc(fixture.card.name);
    await runtime.flush();
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

test('Ari fixture executes ownership, read-only profiles and stale canon rejection in the production controller', () => {
    let source = fs.readFileSync(new URL('./runtime-smoke.mjs', import.meta.url), 'utf8');
    source = source.replace('const here = path.dirname(fileURLToPath(import.meta.url));', `const here = ${JSON.stringify(fileURLToPath(new URL('.', import.meta.url)))};`);
    const start = source.indexOf('try {\n    await import(pathToFileURL(path.join(extRoot');
    const end = source.lastIndexOf('} finally {');
    if (start < 0 || end < start) throw new Error('Runtime harness boundary changed');
    source = source.slice(0, start) + `try {\n    await import(pathToFileURL(path.join(extRoot, 'index.js')).href);\n    await sleep(100);\n    await (${ariChecks.toString()})(mockState, eventSource, manualAddNpc, sleep, extRoot);\n` + source.slice(end);
    execFileSync(process.execPath, ['--import', new URL('./active-runtime-test-setup.mjs', import.meta.url).href, '--input-type=module'], {
        input: source, encoding: 'utf8', timeout: 40000, maxBuffer: 8 * 1024 * 1024,
    });
});
