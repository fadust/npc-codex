import test from 'node:test';
import assert from 'node:assert/strict';
import { createNpcRecord, mergeScanResult } from '../core.js';
import { inverseSocialRelation } from '../social.js';
import {
    buildCastPassPrompt,
    buildCastShortlist,
    castDecisionsToScan,
    castSignals,
    mergeCastIntoScan,
    mergeRoles,
    normalizeRoles,
    rankCanonEntries,
    resolveKnowledgeKeys,
    transferExclusiveRoles,
} from '../cast.js';

function npc(name, fields = {}, ids = []) {
    return { ...createNpcRecord(name, ids), ...fields };
}

function stateWith(...npcs) {
    return { npcs, candidates: [], dismissed: [], turn: 5 };
}

const HP_CANON = [
    { world: 'HP', uid: 1, comment: 'Albus Dumbledore', key: ['Dumbledore', 'Albus'], content: 'Albus Dumbledore is the Headmaster of Hogwarts School of Witchcraft and Wizardry, an elderly wizard with a long silver beard and half-moon spectacles.' },
    { world: 'HP', uid: 2, comment: 'Minerva McGonagall', key: ['McGonagall', 'Minerva'], content: 'Minerva McGonagall is Deputy Headmistress of Hogwarts and head of Gryffindor house; strict, fair, a Transfiguration master.' },
    { world: 'HP', uid: 3, comment: 'Argus Filch', key: ['Filch'], content: 'Argus Filch is the caretaker of Hogwarts, a bitter Squib who patrols the corridors with his cat.' },
    { world: 'HP', uid: 4, comment: 'Hogsmeade', key: ['Hogsmeade'], content: 'The only all-wizarding village in Britain, near the school; the Three Broomsticks and Honeydukes.' },
];

test('signals catch unknown names, tie references of any kind, and titles', () => {
    const text = 'Later, Martha\'s older daughter waved. Dumbledore\'s first student was there, and so was her ex-wife. Tomas\'s younger brother laughed. Then the headmaster of Hogwarts arrived with Rennick.';
    const signals = castSignals(text, { knownLabels: ['Martha', 'Tomas Vantrell'], userName: 'Kai', charName: 'Narrator' });
    assert.ok(signals.any);
    assert.ok(signals.unknownNames.includes('Rennick'));
    assert.ok(!signals.unknownNames.includes('Martha'), 'known dossier names are not unknown');
    for (const phrase of ['Martha\'s older daughter', 'Dumbledore\'s first student', 'her ex-wife', 'Tomas\'s younger brother']) {
        assert.ok(signals.tiePhrases.some(item => item.includes(phrase)), phrase);
    }
    assert.ok(signals.titlePhrases.some(item => /headmaster of Hogwarts/i.test(item)));
    assert.equal(castSignals('The rain kept on. She slept.', {}).any, false);
});

test('qualifiers survive the relationship mirror', () => {
    assert.equal(inverseSocialRelation('ex-wife'), 'ex-spouse');
    assert.equal(inverseSocialRelation('younger brother'), 'older sibling');
    assert.equal(inverseSocialRelation('eldest sister'), 'younger sibling');
    assert.equal(inverseSocialRelation('first student'), 'mentor', 'ordinals belong to one side only');
    assert.equal(inverseSocialRelation('estranged father'), 'estranged child');
    assert.equal(inverseSocialRelation('daughter'), 'parent');
});

test('shortlist pulls in every tie of a named anchor with gender and age, plus NPCs placed at the scene', () => {
    const martha = npc('Martha', { gender: 'female', age: '52', keyRelationships: ['Anna — daughter', 'Beth — daughter', 'Carl — ex-husband'] });
    const anna = npc('Anna', { gender: 'female', age: '30', keyRelationships: ['Martha — mother'] }, [martha.id]);
    const beth = npc('Beth', { gender: 'female', age: '24' }, [martha.id, anna.id]);
    const carl = npc('Carl', { gender: 'male', age: '55' }, [martha.id, anna.id, beth.id]);
    const haneul = npc('Ha-neul', { role: 'Barista', location: 'Coffee shop with the red awning' }, [martha.id, anna.id, beth.id, carl.id]);
    const stranger = npc('Pell', { role: 'locksmith', location: 'Cobble Market' }, [martha.id, anna.id, beth.id, carl.id, haneul.id]);
    const list = buildCastShortlist({ npcs: [martha, anna, beth, carl, haneul, stranger], transcript: 'Martha\'s older daughter waved from the counter.', sceneLocation: 'Coffee shop with the red awning' });
    const ids = list.map(item => item.id);
    assert.equal(ids[0], martha.id);
    for (const id of [anna.id, beth.id, carl.id, haneul.id]) assert.ok(ids.includes(id));
    assert.ok(!ids.includes(stranger.id));
    const card = list.find(item => item.id === anna.id);
    assert.equal(card.gender, 'female');
    assert.equal(card.age, '30');
});

test('canon ranking finds the entry that defines a title even though it is keyed by name only', () => {
    const ranked = rankCanonEntries(HP_CANON, 'The headmaster of Hogwarts stepped into the hall.', {});
    assert.equal(ranked[0].name, 'Albus Dumbledore');
    assert.equal(ranked[0].id, 'canon:HP#1');
    assert.ok(!ranked.some(item => item.name === 'Hogsmeade'));
    const existing = npc('Albus Dumbledore', { aliases: ['Dumbledore'] });
    assert.equal(rankCanonEntries(HP_CANON, 'Dumbledore smiled.', { npcs: [existing] })[0].dossierId, existing.id);
    assert.deepEqual(rankCanonEntries(HP_CANON, 'Rain fell on the road.', {}), []);
});

test('canon-first: "the headmaster" creates Albus Dumbledore from canon with an exclusive role', () => {
    const canon = rankCanonEntries(HP_CANON, 'The headmaster of Hogwarts arrived.', {});
    const cast = castDecisionsToScan({ people: [{ ref: 'The headmaster of Hogwarts', is: 'canon:HP#1', name: 'Albus Dumbledore', gender: 'male', present: true, roles: [{ title: 'Headmaster', org: 'Hogwarts', exclusive: true, status: 'current' }] }] },
        { transcript: 'The headmaster of Hogwarts arrived.', npcs: [], canon, userName: 'Harry', charName: 'Narrator' });
    const merged = mergeScanResult(stateWith(), mergeCastIntoScan({ npcs: [] }, cast), { turn: 5 });
    const dumbledore = merged.state.npcs.find(item => item.name === 'Albus Dumbledore');
    assert.ok(dumbledore, 'created under the canonical name');
    assert.deepEqual(dumbledore.canonRef, { world: 'HP', uid: 1, name: 'Albus Dumbledore' });
    assert.equal(dumbledore.role, 'Headmaster of Hogwarts');
    assert.equal(dumbledore.roles[0].exclusive, true);
    assert.equal(dumbledore.present, true);
});

test('an exclusive title has one current holder: the newer holder takes it, the old one becomes former', () => {
    const dumbledore = npc('Albus Dumbledore', { roles: normalizeRoles([{ title: 'Headmaster', org: 'Hogwarts', exclusive: true, since: 1 }]) });
    const snape = npc('Severus Snape', {}, [dumbledore.id]);
    const merged = mergeScanResult(stateWith(dumbledore, snape), { npcs: [{ id: snape.id, name: 'Severus Snape', present: true, roles: [{ title: 'Headmaster', org: 'Hogwarts', exclusive: true }] }] }, { turn: 9 });
    const d = merged.state.npcs.find(item => item.id === dumbledore.id);
    const s = merged.state.npcs.find(item => item.id === snape.id);
    assert.equal(s.role, 'Headmaster of Hogwarts');
    assert.equal(d.roles[0].until, 9);
    assert.equal(d.role, '', 'no current title left');
    assert.equal(transferExclusiveRoles(merged.state.npcs, { turn: 9 }).changes.length, 0, 'stable after transfer');
});

test('roles merge: a former status ends a title; non-exclusive titles can be shared', () => {
    const roles = mergeRoles([{ title: 'Professor', org: 'Hogwarts' }], [{ title: 'Professor', org: 'Hogwarts', status: 'former' }], { turn: 7 });
    assert.equal(roles[0].until, 7);
    assert.equal(normalizeRoles([{ title: 'Professor', org: 'Hogwarts' }])[0].exclusive, undefined);
    assert.equal(normalizeRoles([{ title: 'Captain', org: 'the Merry Wind' }])[0].exclusive, true);
});

test('"Martha\'s older daughter" resolves to the older daughter on file; with none on file it becomes a linked role label', () => {
    const martha = npc('Martha', { gender: 'female', age: '52' });
    const anna = npc('Anna', { gender: 'female', age: '30' }, [martha.id]);
    const text = 'Martha\'s older daughter came in with the bread.';
    const cast = castDecisionsToScan({ people: [{ ref: 'Martha\'s older daughter', is: anna.id, gender: 'female', present: true, ties: [{ is: 'older daughter', of: 'Martha' }] }] },
        { transcript: text, npcs: [martha, anna] });
    const { matchLabels, ...row } = cast.npcs[0];
    assert.deepEqual(row, { id: anna.id, name: 'Anna', sameIndividual: true, present: true });
    assert.ok(matchLabels.includes("Martha's older daughter"));
    assert.deepEqual(cast.keyRelationshipEdges, [{ a: 'Martha', b: 'Anna', aToB: 'older daughter', reason: 'cast: Martha\'s older daughter' }]);
    const merged = mergeScanResult(stateWith(martha, anna), mergeCastIntoScan({ npcs: [] }, cast), { turn: 5 });
    const m = merged.state.npcs.find(item => item.id === martha.id);
    assert.ok(m.keyRelationships.some(line => /Anna/.test(line) && /daughter/.test(line)));

    const fresh = castDecisionsToScan({ people: [{ ref: 'Martha\'s older daughter', is: 'new', gender: 'female', ties: [{ is: 'older daughter', of: 'Martha' }] }] },
        { transcript: text, npcs: [martha] });
    assert.equal(fresh.npcs[0].name, 'Martha\'s older daughter');
    assert.equal(fresh.npcs[0].identityKind, 'role_label');
});

test('validation: references must appear in the exchange, ties must agree with gender, the player is never cast', () => {
    const tomas = npc('Tomas Vantrell', { gender: 'male' });
    const text = 'Tomas\'s younger brother grinned at Kai.';
    const cast = castDecisionsToScan({ people: [
        { ref: 'Tomas\'s younger brother', is: 'new', gender: 'male', ties: [{ is: 'younger sister', of: 'Tomas Vantrell' }] },
        { ref: 'somebody not in the text', is: 'new', name: 'Ghost' },
        { ref: 'Kai', is: 'new', name: 'Kai' },
    ] }, { transcript: text, npcs: [tomas], userName: 'Kai' });
    assert.equal(cast.npcs.length, 1);
    assert.equal(cast.keyRelationshipEdges.length, 0, 'a "sister" tie on a male is rejected');
    assert.ok(cast.report.rejected.some(item => /not in exchange/.test(item.reason)));
});

test('a revealed name promotes a role-labelled dossier (grey suit man -> Bae) and keeps the old label', () => {
    const grey = npc('man in a grey suit', { identityKind: 'role_label' });
    const text = '"Choi\'s errand boy," Ha-neul said. "His name\'s Bae."';
    const cast = castDecisionsToScan({ people: [{ ref: 'Bae', is: grey.id, name: 'Bae', gender: 'male', roles: [{ title: 'errand boy', org: 'Hanseong Capital' }] }] }, { transcript: text, npcs: [grey] });
    const merged = mergeScanResult(stateWith(grey), mergeCastIntoScan({ npcs: [] }, cast), { turn: 5 });
    const bae = merged.state.npcs.find(item => item.id === grey.id);
    assert.equal(bae.name, 'Bae');
    assert.ok(bae.aliases.includes('man in a grey suit'));
    assert.equal(bae.role, 'errand boy of Hanseong Capital');
});

test('folding cast rows into the scanner result never undoes presence and appends new people', () => {
    const scan = { npcs: [{ id: 'npc_a', name: 'Anna', present: true, mood: 'tired' }], keyRelationshipEdges: [] };
    const folded = mergeCastIntoScan(scan, { npcs: [{ id: 'npc_a', name: 'Anna', sameIndividual: true, roles: [{ title: 'Baker' }] }, { name: 'Rennick', identityKind: 'proper_name' }], keyRelationshipEdges: [{ a: 'Anna', b: 'Rennick', aToB: 'employer' }] });
    assert.equal(folded.npcs.length, 2);
    assert.equal(folded.npcs[0].present, true);
    assert.equal(folded.npcs[0].mood, 'tired');
    assert.deepEqual(folded.npcs[0].roles, [{ title: 'Baker' }]);
    assert.equal(folded.keyRelationshipEdges.length, 1);
});

test('the Kim edge: a scanner that swaps parent/child direction is corrected by age order', () => {
    const soojin = npc('Soo-jin', { gender: 'female', apparentAge: '~44' });
    const eunji = npc('Eun-ji', { gender: 'female', apparentAge: '~22' }, [soojin.id]);
    // aToB must be "b's role to a" = Eun-ji's role to Soo-jin = daughter; the scanner said mother.
    const merged = mergeScanResult(stateWith(soojin, eunji), { npcs: [], keyRelationshipEdges: [{ aId: soojin.id, a: 'Soo-jin', bId: eunji.id, b: 'Eun-ji', aToB: 'mother', bToA: 'daughter', reason: 'scanner edge' }] }, { turn: 5 });
    const s = merged.state.npcs.find(item => item.id === soojin.id);
    const e = merged.state.npcs.find(item => item.id === eunji.id);
    assert.ok(s.keyRelationships.some(line => /^Eun-ji — daughter/.test(line)), s.keyRelationships.join(' / '));
    assert.ok(e.keyRelationships.some(line => /^Soo-jin — mother/.test(line)), e.keyRelationships.join(' / '));
});

test("card canon outranks lorebook canon: in a 2026 AU 'the headmistress' is the card's Miriam Harcourt", async () => {
    const { cardCanonEntries } = await import('../cast.js');
    const card = cardCanonEntries('Expanded facilities and 2026 appointments are established facts of this AU. Miriam Harcourt is the headmistress, with Idris Quill as deputy. The 1998 war is history.');
    assert.deepEqual(card.map(entry => entry.comment), ['Miriam Harcourt', 'Idris Quill']);
    const ranked = rankCanonEntries([...HP_CANON, ...card], 'The headmistress rose at the high table.', {});
    assert.equal(ranked[0].name, 'Miriam Harcourt');
    assert.equal(ranked[0].source, 'card');
});

test('same-turn duplicates fold by label and titles never become aliases', () => {
    const canon = rankCanonEntries(HP_CANON, 'Filch glared. The headmaster of Hogwarts rose.', {});
    const cast = castDecisionsToScan({ people: [
        { ref: 'Filch', is: 'canon:HP#3', name: 'Argus Filch', present: true, roles: [{ title: 'Caretaker', org: 'Hogwarts' }] },
        { ref: 'The headmaster of Hogwarts', is: 'canon:HP#1', name: 'Albus Dumbledore', present: true, roles: [{ title: 'Headmaster', org: 'Hogwarts' }] },
    ] }, { transcript: 'Filch glared. The headmaster of Hogwarts rose.', npcs: [], canon });
    const scanner = { npcs: [{ name: 'Filch', present: true }, { name: 'Headmaster', aliases: ['headmaster of Hogwarts'], present: true }] };
    const folded = mergeCastIntoScan(scanner, cast);
    assert.equal(folded.npcs.length, 2);
    const merged = mergeScanResult(stateWith(), folded, { turn: 5 });
    const names = merged.state.npcs.map(item => item.name).sort();
    assert.deepEqual(names, ['Albus Dumbledore', 'Argus Filch']);
    const dumbledore = merged.state.npcs.find(item => item.name === 'Albus Dumbledore');
    assert.ok(!dumbledore.aliases.some(alias => /headmaster/i.test(alias)), dumbledore.aliases.join(', '));
    assert.ok(dumbledore.aliases.includes('Dumbledore'));
    assert.equal(normalizeRoles([{ title: 'Prefect', org: 'Ravenclaw', exclusive: true }])[0].exclusive, undefined, 'model cannot make a shared title exclusive');
});

test('cast prompt states the resolution order and carries candidates, canon and signals; name-keyed knowledge resolves after merge', () => {
    const prompt = buildCastPassPrompt({ transcript: 'The headmaster nodded.', shortlist: [{ id: 'npc_x', name: 'X' }], canon: [{ id: 'canon:HP#1', name: 'Albus Dumbledore', keys: ['Dumbledore'], snippet: 'Headmaster' }], signals: { titlePhrases: ['The headmaster'] }, userName: 'Harry' });
    assert.match(prompt, /1\. a CANON entry[\s\S]*2\. an existing DOSSIER[\s\S]*3\. "is":"new"/);
    assert.match(prompt, /canon:HP#1/);
    assert.match(prompt, /title references: The headmaster/);
    const keys = resolveKnowledgeKeys(new Map([['name:rennick', [{ fact: 'x', kind: 'knows' }]], ['npc_a', [{ fact: 'y', kind: 'knows' }]]]), [{ id: 'npc_r', name: 'Rennick' }]);
    assert.deepEqual([...keys.keys()].sort(), ['npc_a', 'npc_r']);
});
