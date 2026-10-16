import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord, mergeScanResult } from '../core.js';
import { castDecisionsToScan } from '../cast.js';
import { applyEventDecisions, readEventDecisions, renderMemoryInjection } from '../memory.js';

const GATE = 'At the city gate Kai slipped the guard a silver coin, and the guard waved the party through. Aria grinned. Kael looked away, jaw tight.';

function cast() {
    const aria = createNpcRecord('Aria');
    const kael = createNpcRecord('Kael', [aria.id]);
    const mira = createNpcRecord('Mira', [aria.id, kael.id]);
    return { aria, kael, mira, npcs: [aria, kael, mira] };
}

test('one objective event, one view per witness; absent NPCs get no first-hand view', () => {
    const { npcs } = cast();
    const read = readEventDecisions({ events: [{
        op: 'add', what: 'Kai slipped the guard a silver coin to get the party through the gate', where: 'city gate',
        witnesses: ['Kai', 'Aria', 'Kael'],
        views: [
            { who: 'Aria', effect: 'thought it smart and pragmatic; respects Kai more', level: 'significant', fit: 'matches' },
            { who: 'Kael', effect: 'uneasy with the corruption; trusts Kai a little less', level: 'significant', fit: 'contradicts' },
            { who: 'Mira', effect: 'disapproves', level: 'minor' },
        ],
    }] }, { transcript: GATE, present: ['Aria', 'Kael'], npcs, userName: 'Kai' });
    assert.equal(read.events[0].views.length, 2);
    assert.ok(read.rejected.some(reason => /absent: Mira/.test(reason)));
    const out = applyEventDecisions(npcs, read, { turn: 4, sourceMessageId: 7, userName: 'Kai' });
    const [aria, kael, mira] = out.npcs;
    assert.equal(aria.episodes[0].eventId, 'e1');
    assert.equal(kael.episodes[0].eventId, 'e1');
    assert.equal(aria.episodes[0].event, kael.episodes[0].event, 'the objective fact is shared');
    assert.notEqual(aria.episodes[0].effect, kael.episodes[0].effect, 'each witness has their own view');
    assert.deepEqual(aria.episodes[0].witnesses, ['Kai', 'Aria', 'Kael']);
    assert.equal(mira.episodes.length, 0);
});

test('told-by: a holder tells a present listener; the listener gains hearsay; non-holders cannot tell', () => {
    let { npcs } = cast();
    npcs = applyEventDecisions(npcs, { events: [{ op: 'add', what: 'Kai bribed the gate guard', witnesses: ['Kai', 'Aria'], views: [{ who: 'Aria', effect: 'amused', level: 'defining' }] }] }, { turn: 4, userName: 'Kai' }).npcs;
    const told = readEventDecisions({ told: [{ event: 'e1', by: 'Aria', to: 'Mira', effect: 'worried about the party' }, { event: 'e9', by: 'Aria', to: 'Mira' }] },
        { transcript: 'Aria tells Mira about the guard.', present: ['Aria', 'Mira'], npcs, userName: 'Kai' });
    assert.equal(told.told.length, 1);
    const out = applyEventDecisions(npcs, told, { turn: 6, userName: 'Kai' });
    const mira = out.npcs[2];
    assert.equal(mira.episodes[0].eventId, 'e1');
    assert.equal(mira.episodes[0].toldBy, 'Aria');
    assert.equal(mira.episodes[0].level, 'significant', 'hearsay never lands as defining');
    assert.match(renderMemoryInjection(mira, { turn: 6 }), /worried about the party \(Kai bribed the gate guard; heard from Aria, just now\)/);
    const kaelCannot = applyEventDecisions(npcs, { told: [{ event: 'e1', by: 'Kael', to: 'Mira' }] }, { userName: 'Kai' });
    assert.ok(kaelCannot.rejected.some(reason => /does not hold/.test(reason)));
});

test('an update to the objective fact reaches every holder, first-hand or told', () => {
    let { npcs } = cast();
    npcs = applyEventDecisions(npcs, { events: [{ op: 'add', what: 'Kai bribed the gate guard', witnesses: ['Aria'], views: [{ who: 'Aria', effect: 'amused', level: 'minor' }] }], told: [] }, { userName: 'Kai' }).npcs;
    npcs = applyEventDecisions(npcs, { told: [{ event: 'e1', by: 'Aria', to: 'Kael' }] }, { userName: 'Kai' }).npcs;
    npcs = applyEventDecisions(npcs, { events: [{ op: 'update', id: 'e1', what: 'Kai bribed the gate guard with a forged writ, not silver', witnesses: ['Aria'], views: [{ who: 'Aria', effect: 'impressed', level: 'significant' }] }] }, { userName: 'Kai' }).npcs;
    assert.match(npcs[0].episodes[0].event, /forged writ/);
    assert.match(npcs[1].episodes[0].event, /forged writ/);
    assert.equal(npcs[0].episodes.length, 1);
});

test('keyword recall: an old minor memory surfaces when its people or topic return', () => {
    const npc = { ...createNpcRecord('Aria'), episodes: [
        { id: 'm1', event: 'shared a joke about the innkeeper goat', level: 'minor', turn: 2 },
        { id: 'm2', event: 'argued about the map route', level: 'minor', turn: 30 },
        { id: 'm3', event: 'sparred in the yard', level: 'minor', turn: 31 },
        { id: 'm4', event: 'bought rope', level: 'minor', turn: 32 },
        { id: 'm5', event: 'cleaned the blades', level: 'minor', turn: 33 },
        { id: 'm6', event: 'checked the horses', level: 'minor', turn: 34 },
    ] };
    assert.doesNotMatch(renderMemoryInjection(npc, { turn: 35 }), /goat/);
    assert.match(renderMemoryInjection(npc, { turn: 35, text: 'The innkeeper leads his goat past the table.' }), /goat/);
});

test('cast pass end to end: views resolve to dossiers after the merge', () => {
    const aria = createNpcRecord('Aria');
    const out = castDecisionsToScan({
        people: [{ ref: 'Aria', is: aria.id, present: true }, { ref: 'Kael', is: 'new', name: 'Kael', present: true }],
        events: [{ op: 'add', what: 'Kai slipped the guard a silver coin', witnesses: ['Kai', 'Aria', 'Kael'], views: [{ who: 'Aria', effect: 'respects Kai more', level: 'significant' }, { who: 'Kael', effect: 'uneasy', level: 'significant' }] }],
    }, { transcript: GATE, npcs: [aria], userName: 'Kai' });
    const merged = mergeScanResult({ npcs: [aria], candidates: [], dismissed: [], turn: 3 }, { npcs: out.npcs }, { turn: 3 });
    const applied = applyEventDecisions(merged.state.npcs, out.events, { turn: 3, userName: 'Kai' });
    assert.deepEqual(applied.npcs.map(npc => npc.episodes[0]?.effect), ['respects Kai more', 'uneasy']);
});

test('a retelling the model files as a new event becomes told-by on the stored event (live Flash output)', () => {
    const priya = { ...createNpcRecord('Priya Nair'), episodes: [{ id: 'm1', eventId: 'e1', event: 'Filch caught an unknown second-year scrawling on a portrait frame; Kai stepped in and lied, claiming the mark was his own and offering to clean it, so Filch released the boy', level: 'significant', witnesses: ['Kai', 'Priya Nair', 'Argus Filch'] }] };
    const quill = createNpcRecord('Idris Quill', [priya.id]);
    const read = readEventDecisions({ events: [{ op: 'add', what: 'Priya told Professor Quill that Kai lied to Filch to shield a second-year; Quill set him the levitation charm without comment', witnesses: ['Kai', 'Priya Nair', 'Idris Quill'], views: [{ who: 'Idris Quill', effect: 'Marks Kai as worth watching', level: 'significant' }] }] },
        { transcript: 'Priya Nair says Kai lied to Filch this morning to save a second-year from detention. Professor Quill set the levitation charm without comment.', present: ['Priya Nair', 'Idris Quill'], npcs: [priya, quill], userName: 'Kai' });
    assert.equal(read.events.length, 0);
    assert.deepEqual(read.told, [{ event: 'e1', by: 'Priya Nair', to: 'Idris Quill', effect: 'Marks Kai as worth watching' }]);
    const out = applyEventDecisions([priya, quill], read, { turn: 8, userName: 'Kai' });
    assert.equal(out.npcs[1].episodes[0].eventId, 'e1');
    assert.equal(out.npcs[1].episodes[0].toldBy, 'Priya Nair');
});
