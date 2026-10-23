import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNpcPortraitPrompts, createNpcRecord } from '../core.js';

function indexOfOrFail(text, fragment) {
    const index = text.toLowerCase().indexOf(fragment.toLowerCase());
    assert.notEqual(index, -1, 'Expected prompt to contain: ' + fragment);
    return index;
}

test('semantic portraits use the BaiBai identity sentence without inventing missing traits', () => {
    const options = { format: 'natural', stylePositive: '', styleNegative: '', composition: '', useMood: false };
    const prompt = buildNpcPortraitPrompts({ name: 'Toma', species: 'Human', gender: 'male', age: '80', apparentAge: '35',
        appearance: 'deep brown skin; an angular face with a scar across the nose; short curly black hair; green eyes' }, options).positive;
    assert.ok(prompt.startsWith('Toma (original character) is an adult human man in his mid thirties with '), prompt);
    // Looks follow face, hair, skin, body order; one visible adult cue is added because age words alone do not hold.
    for (const [a, b] of [['angular face', 'short curly black hair'], ['short curly black hair', 'deep brown skin']]) assert.ok(prompt.indexOf(a) < prompt.indexOf(b), `${a} before ${b}`);
    assert.match(prompt, /adult proportions and a mature face/);
    assert.doesNotMatch(prompt, /\b80\b|eighties/);
    assert.equal(buildNpcPortraitPrompts({}, options).positive, '');
    // A long-lived species with only a chronological age gets no human age words, and no race is invented.
    assert.equal(buildNpcPortraitPrompts({ name: 'Elowen', species: 'Elf', age: '300', appearance: 'silver hair' }, options).positive,
        'Elowen (original character) is an elf with silver hair.');
    assert.equal(buildNpcPortraitPrompts({ name: 'Mara', gender: 'female', appearance: 'red hair' }, options).positive,
        'Mara (original character) is a human woman with red hair.');
    assert.doesNotMatch(buildNpcPortraitPrompts({ name: 'Bram', species: 'Human', gender: 'male', apparentAge: '~40', appearance: 'grey beard' }, options).positive, /mature face/);
    assert.match(buildNpcPortraitPrompts({ name: 'Pip', gender: 'male', apparentAge: '15', appearance: 'brown hair' }, options).positive, /^Pip \(original character\) is a teenage human boy with brown hair\.$/);
});

test('portrait prompt assembly is deterministic, subject-first, label-free in tag formats, and style-last', () => {
    const prompts = buildNpcPortraitPrompts({
        species: 'Half-elf',
        apparentAge: '18',
        role: 'Civilian Guild Intake Clerk',
        appearance: 'Tangled red hair coming loose from lost hair ribbons; pointed ears; pale hazel eyes; ample bust. Wears a slightly crooked rough wool tunic beneath a leather vest pinned with an Ardelian registration badge.',
        mood: 'Harried, observant, practical',
        location: 'Adventurer Guildhall, Rimecross Waystation',
    }, {
        stylePositive: 'STYLE_SENTINEL',
        styleNegative: 'BASE_NEGATIVE',
        composition: 'solo portrait, face visible',
        format: 'hybrid',
        useMood: true,
        useLocation: true,
    });

    const order = [
        'Half-elf',
        'Tangled red hair',
        'Civilian Guild Intake Clerk',
        'rough wool tunic',
        'Harried, observant, practical',
        'Adventurer Guildhall, Rimecross Waystation',
        'solo portrait, face visible',
        'STYLE_SENTINEL',
    ].map(fragment => indexOfOrFail(prompts.positive, fragment));
    for (let i = 1; i < order.length; i += 1) assert.ok(order[i - 1] < order[i], 'portrait sections must remain in deterministic subject-first order');

    assert.doesNotMatch(prompts.positive, /\brole\s*:/i);
    assert.doesNotMatch(prompts.positive, /expression\s*\/\s*bearing\s*:/i);
    assert.doesNotMatch(prompts.positive, /background\s*\/\s*location\s*:/i);
    assert.match(prompts.negative, /white hair/);
    assert.match(prompts.negative, /silver hair/);
    assert.match(prompts.negative, /blonde hair/);
    assert.match(prompts.negative, /blue hair/);
    assert.match(prompts.negative, /purple hair/);
    assert.doesNotMatch(prompts.negative, /^red hair(?:,|$)/i);
});

test('portrait prompt appearance splitting deduplicates strong-boundary repeats and separates clear clothing', () => {
    const prompts = buildNpcPortraitPrompts({
        species: 'Human',
        appearance: 'red hair; red hair; green eyes. Wears a blue wool dress; blue wool dress',
    }, {
        stylePositive: 'STYLE_LAST',
        styleNegative: '',
        composition: '',
        format: 'tags',
    });

    assert.equal((prompts.positive.match(/red hair/gi) || []).length, 1);
    assert.equal((prompts.positive.match(/blue wool dress/gi) || []).length, 1);
    assert.ok(indexOfOrFail(prompts.positive, 'green eyes') < indexOfOrFail(prompts.positive, 'blue wool dress'));
    assert.ok(indexOfOrFail(prompts.positive, 'blue wool dress') < indexOfOrFail(prompts.positive, 'STYLE_LAST'));
});

test('resolved human form excludes alternate-form anatomy and turns explicit absent anatomy into safe negatives', () => {
    const npc = createNpcRecord('Sora');
    Object.assign(npc, {
        species: 'Stormcrown Thunderbird Chimera',
        overallAppearance: 'shoulder-length distinctly golden-blue hair with warm gold and blue pigmentation',
        appearanceForms: [
            { name: 'Thunderbird', appearance: 'vast cobalt wings, bright feathers, hooked talons' },
            { name: 'Human', appearance: 'young human girl with ordinary human ears, two arms, two legs, no avian wings or feathers, no tail' },
        ],
        currentForm: 'Human',
        currentFormUnknown: false,
        appearanceModelVersion: 1,
    });

    const prompts = buildNpcPortraitPrompts(npc, {
        stylePositive: 'anime portrait',
        styleNegative: 'low quality',
        composition: 'face visible',
        format: 'hybrid',
    });
    assert.match(prompts.positive, /golden-blue/i);
    assert.match(prompts.positive, /ordinary human ears/i);
    assert.doesNotMatch(prompts.positive, /vast cobalt wings|hooked talons|Stormcrown Thunderbird Chimera/i);
    assert.match(prompts.negative, /\bwings\b/i);
    assert.match(prompts.negative, /\bfeathers\b/i);
    assert.match(prompts.negative, /\btail\b/i);
    assert.doesNotMatch(prompts.negative, /\bblue hair\b/i, 'explicit blue pigmentation must never be negated');
});

test('comma tags promote explicit visual anchors from prose without dropping the accepted appearance', () => {
    const prompts = buildNpcPortraitPrompts({
        species: 'Half-elf',
        apparentAge: '~18',
        role: 'Civilian Guild Intake Clerk',
        appearance: 'A young half-elf with tangled auburn curls coming loose from lost hair ribbons, pointed ears, pale hazel eyes, and an ample bust. Wears a slightly crooked rough wool tunic beneath a leather vest pinned with an Ardelian registration badge.',
        mood: 'Harried, observant, practical',
        location: 'Adventurer Guildhall, Rimecross Waystation',
    }, {
        stylePositive: 'STYLE_SENTINEL',
        styleNegative: 'BASE_NEGATIVE',
        composition: '',
        format: 'tags',
        useMood: true,
        useLocation: true,
    });

    assert.match(prompts.positive, /auburn hair/i);
    assert.match(prompts.positive, /curly hair/i);
    assert.match(prompts.positive, /tangled hair/i);
    assert.match(prompts.positive, /loose hair/i);
    assert.match(prompts.positive, /hair ribbons/i);
    assert.match(prompts.positive, /pointed ears/i);
    assert.doesNotMatch(prompts.positive, /A young half-elf with tangled auburn curls/i);
    assert.match(prompts.positive, /pale hazel eyes/i);
    assert.match(prompts.positive, /ample bust/i);
    assert.match(prompts.positive, /rough wool tunic/i);
    assert.ok(indexOfOrFail(prompts.positive, 'auburn hair') < indexOfOrFail(prompts.positive, 'STYLE_SENTINEL'));

    assert.match(prompts.negative, /white hair/i);
    assert.match(prompts.negative, /silver hair/i);
    assert.match(prompts.negative, /blonde hair/i);
    assert.match(prompts.negative, /blue hair/i);
    assert.match(prompts.negative, /purple hair/i);
    assert.doesNotMatch(prompts.negative, /(?:^|,\s*)auburn hair(?:,|$)/i);
});

test('comma tags preserve explicit multicolor hair as one standalone anchor and do not negate its components', () => {
    const prompts = buildNpcPortraitPrompts({
        species: 'Human',
        appearance: 'shoulder-length distinctly golden-blue hair with warm gold and blue pigmentation; silvery-gray eyes',
    }, {
        stylePositive: 'STYLE_LAST',
        styleNegative: '',
        composition: '',
        format: 'tags',
    });

    assert.match(prompts.positive, /golden-blue hair/i);
    assert.match(prompts.positive, /shoulder-length hair/i);
    assert.doesNotMatch(prompts.negative, /\b(?:golden|blue) hair\b/i);
});

test('comma tags retain unparsed appearance fragments instead of dropping them with parsed anchors', () => {
    const prompts = buildNpcPortraitPrompts({
        species: 'Human',
        appearance: 'long black hair, freckles, a thin scar across the nose',
    }, {
        stylePositive: '',
        styleNegative: '',
        composition: '',
        format: 'tags',
    });

    assert.match(prompts.positive, /black hair/i);
    assert.match(prompts.positive, /long hair/i);
    assert.match(prompts.positive, /freckles/i);
    assert.match(prompts.positive, /thin scar across the nose/i);
    assert.doesNotMatch(prompts.positive, /long black hair, freckles/i);
});

test('image prompts assume human when no race is recorded, but never for a withheld form species', () => {
    const options = { stylePositive: '', styleNegative: '', composition: '', useMood: false, format: 'natural' };
    assert.equal(buildNpcPortraitPrompts({ name: 'Old', age: '300', appearance: 'silver hair' }, options).positive, 'Old (original character) is a human with silver hair.');
    assert.equal(buildNpcPortraitPrompts({ name: 'Rook', gender: 'male', apparentAge: '~45', appearance: 'grey beard' }, options).positive, 'Rook (original character) is an adult human man in his mid forties with grey beard.');
    assert.match(buildNpcPortraitPrompts({ gender: 'female', appearance: 'red hair' }, { ...options, format: 'tags' }).positive, /^human, female, /);
    const dragon = buildNpcPortraitPrompts({ name: 'Ari', species: 'Dragon', gender: 'female', currentForm: 'Dragon',
        appearanceForms: [{ name: 'Dragon', appearance: 'silver scales and huge wings' }] }, options).positive;
    assert.equal(dragon, 'Ari (original character) is a woman with silver scales and huge wings.');
});

test('image prompts carry the Class custom field verbatim and no other custom field', () => {
    const options = { stylePositive: '', styleNegative: '', composition: '', useMood: false };
    const npc = { name: 'Sigrid', species: 'Human', gender: 'female', apparentAge: '~32', customFields: { Class: 'Arcane Archer', Level: '12' }, appearance: 'grey eyes' };
    const natural = buildNpcPortraitPrompts(npc, { ...options, format: 'natural' }).positive;
    assert.equal(natural, 'Sigrid (original character) is an adult human woman in her early thirties, an Arcane Archer, with adult proportions and a mature face, grey eyes.');
    assert.equal(buildNpcPortraitPrompts({ name: 'Vex', customFields: { class: 'Ranger' } }, { ...options, format: 'natural' }).positive, 'Vex (original character) is a human Ranger.');
    assert.equal(buildNpcPortraitPrompts({ name: 'Vex', customFields: { class: 'Ranger' }, appearance: 'Wears a green cloak.' }, { ...options, format: 'natural' }).positive, 'Vex (original character) is a human Ranger wearing green cloak.');
    for (const format of ['hybrid', 'tags']) {
        const prompt = buildNpcPortraitPrompts(npc, { ...options, format }).positive;
        assert.match(prompt, /Arcane Archer/);
        assert.ok(prompt.indexOf('Arcane Archer') < prompt.indexOf('grey eyes'), format);
        assert.doesNotMatch(prompt, /\b12\b|Level/);
    }
});

test('natural portrait format names the character in every sentence and ends with framing, place and style', () => {
    const prompts = buildNpcPortraitPrompts({
        name: 'Kael',
        species: 'Half-elf',
        apparentAge: '24',
        role: 'Knight',
        mood: 'wary',
        location: 'the north gate',
        appearance: 'long black hair; gray eyes. Wears a dark leather coat.',
        portraitPromptPositive: 'holding a lantern',
    }, {
        stylePositive: 'STYLE_SENTINEL',
        styleNegative: '',
        composition: 'waist-up portrait',
        format: 'natural',
        useLocation: true,
    });
    assert.equal(prompts.positive, 'Kael (original character) is an adult half-elf in their mid twenties with adult proportions and a mature face, gray eyes, long black hair, wearing dark leather coat. '
        + 'Kael’s expression is wary. Holding a lantern. Kael appears alone in waist-up portrait, at the north gate, drawn as STYLE_SENTINEL.');
    assert.doesNotMatch(prompts.positive, /Knight|Subject:|Role:/, 'role is not visible and labels are not captions');
});
