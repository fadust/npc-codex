import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord, normalizeNpcRecord, buildInjection } from '../core.js';
import { applyCanonSeed } from '../canon-seed.js';
import { renderMemoryInjection } from '../memory.js';
import {
    applyReflection,
    beliefsFromEditorText,
    beliefsToEditorText,
    buildReflectionPrompt,
    reflectionTarget,
    renderReflectionInjection,
} from '../reflection.js';

function priya() {
    return normalizeNpcRecord({
        ...createNpcRecord('Priya Nair'),
        personality: 'Dry, rule-minded prefect with a soft spot for honesty.',
        episodes: [
            { id: 'm1', eventId: 'e1', event: 'Kai fished her badge out of the gravy and polished it', effect: 'sees him as honest', level: 'significant', witnesses: ['Kai', 'Priya Nair'], turn: 3 },
            { id: 'm2', eventId: 'e2', event: 'Kai lied to Filch to save a second-year', effect: 'kind or foolish', level: 'significant', witnesses: ['Kai', 'Priya Nair', 'Argus Filch'], turn: 5 },
            { id: 'm3', event: 'showed Kai the Charms corridor shortcut', level: 'minor', turn: 6 },
            { id: 'm4', event: 'laughed at the portrait jokes over breakfast toast', level: 'minor', turn: 7 },
        ],
    });
}

test('reflection runs only once enough unreflected memories gather, and not on locked memories', () => {
    const npc = priya();
    assert.equal(reflectionTarget([npc])?.name, 'Priya Nair');
    assert.equal(reflectionTarget([{ ...npc, episodes: npc.episodes.slice(0, 3) }]), null);
    assert.equal(reflectionTarget([{ ...npc, manualProfileFields: ['memories'] }]), null);
    assert.match(buildReflectionPrompt(npc, { userName: 'Kai' }), /m2 \[significant\] Kai lied to Filch to save a second-year -> kind or foolish/);
});

test('beliefs need cited memories she holds and a known subject; preferences must be grounded', () => {
    const out = applyReflection(priya(), {
        beliefs: [
            { op: 'add', about: 'Kai', belief: 'Kai does the decent thing even when it costs him', basis: ['e1', 'e2'] },
            { op: 'add', about: 'Kai', belief: 'Kai is secretly a spy', basis: ['m1'] },
            { op: 'add', about: 'Headmistress Harcourt', belief: 'the headmistress favours Ravenclaw', basis: ['m3', 'm4'] },
            { op: 'add', about: 'Kai', belief: 'Kai will betray her', basis: ['e9', 'e10'] },
        ],
        likes: ['breakfast toast', 'dragon racing'],
        dislikes: ['rule-breaking'],
    }, { turn: 8, userName: 'Kai' });
    assert.deepEqual(out.npc.beliefs.map(item => item.belief), ['Kai does the decent thing even when it costs him']);
    assert.deepEqual(out.npc.beliefs[0].basis, ['e1', 'e2']);
    assert.equal(out.rejected.length, 4);
    assert.deepEqual(out.npc.likes, ['breakfast toast']);
    assert.deepEqual(out.npc.dislikes, ['rule-breaking']);
    assert.ok(out.npc.episodes.every(item => item.reflected), 'shown memories are marked reflected');
    assert.equal(reflectionTarget([out.npc]), null, 'no immediate re-reflection');
});

test('update and drop revise beliefs instead of piling them up', () => {
    let npc = applyReflection(priya(), { beliefs: [{ op: 'add', about: 'Kai', belief: 'Kai is honest', basis: ['e1', 'e2'] }] }, { userName: 'Kai' }).npc;
    npc = applyReflection(npc, { beliefs: [{ op: 'update', id: 'b1', about: 'Kai', belief: 'Kai is honest, maybe too honest for Hogwarts', basis: ['e1', 'e2'] }] }, { userName: 'Kai' }).npc;
    assert.equal(npc.beliefs.length, 1);
    assert.match(npc.beliefs[0].belief, /too honest/);
    npc = applyReflection(npc, { beliefs: [{ op: 'drop', id: 'b1' }] }, { userName: 'Kai' }).npc;
    assert.equal(npc.beliefs.length, 0);
});

test('injection: beliefs about people in the scene first, preferences always; reflected minor memories step back', () => {
    const reflected = applyReflection(priya(), {
        beliefs: [{ op: 'add', about: 'Kai', belief: 'Kai does the decent thing even when it costs him', basis: ['e1', 'e2'] }],
        likes: ['breakfast toast'],
    }, { turn: 8, userName: 'Kai' }).npc;
    assert.equal(renderReflectionInjection(reflected, { text: 'Kai sits down.' }), 'has come to believe: about Kai: Kai does the decent thing even when it costs him; likes: breakfast toast');
    const lived = renderMemoryInjection(reflected, { turn: 9, text: 'They walk to class.' });
    assert.doesNotMatch(lived, /shortcut|portrait jokes/, 'reflected minor memories are carried by the belief');
    assert.match(renderMemoryInjection(reflected, { turn: 9, text: 'The portrait jokes start again.' }), /portrait jokes/);
    assert.match(buildInjection([{ ...reflected, present: true }], 'Kai and Priya', 9), /has come to believe: about Kai/);
});

test('canon seeds a likes/dislikes baseline; editor round-trip for beliefs', () => {
    const seeded = applyCanonSeed(createNpcRecord('Argus Filch'), { likes: 'Mrs Norris; catching students', dislikes: 'Peeves' }, { isNew: true }).npc;
    assert.deepEqual(seeded.likes, ['Mrs Norris', 'catching students']);
    assert.deepEqual(seeded.dislikes, ['Peeves']);
    const npc = { beliefs: [{ id: 'b1', about: 'Kai', belief: 'is honest', basis: ['e1'] }] };
    assert.equal(beliefsToEditorText(npc), 'Kai: is honest');
    assert.deepEqual(beliefsFromEditorText('Kai: is honest\nthe Guild cannot be trusted', npc.beliefs).map(item => [item.about, item.belief, item.basis.length]),
        [['Kai', 'is honest', 1], ['world', 'the Guild cannot be trusted', 0]]);
});
