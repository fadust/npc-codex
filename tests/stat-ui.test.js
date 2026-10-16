import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeRoles, currentRoleText } from '../cast.js';
import { normalizeSheet } from '../sheet.js';
import { addStatRow, applyStatEdit, removeStatRow, statPaneHtml, DEFAULT_ATTRIBUTES } from '../stat-sheet-ui.js';

test('one role in two wordings is stored once, in the more specific wording (live: Priya)', () => {
    const roles = mergeRoles([{ title: 'Prefect', org: 'Ravenclaw' }], [{ title: 'Prefect of Ravenclaw', org: 'Hogwarts' }], { turn: 3 });
    assert.equal(roles.length, 1);
    assert.equal(currentRoleText(roles), 'Prefect of Ravenclaw of Hogwarts');
    assert.equal(mergeRoles([{ title: 'Prefect', org: 'Ravenclaw' }, { title: 'Prefect of Ravenclaw', org: 'Hogwarts' }], []).length, 1, 'stored duplicates fold too');
    assert.equal(mergeRoles([{ title: 'Seeker', org: 'Ravenclaw' }], [{ title: 'Prefect', org: 'Ravenclaw' }]).length, 2, 'different roles stay apart');
});

test('Stat tab: mockup sections, default or world-schema attribute names', () => {
    const npc = { id: 'n1', name: 'Priya Nair', role: 'Prefect', faction: 'Ravenclaw', location: 'Ravenclaw Tower', species: 'human', sheet: { rank: 'Prefect', attributes: [{ name: 'Strength', value: '12' }], pools: [{ name: 'HP', current: 31, max: 40 }] } };
    const html = statPaneHtml(npc);
    for (const text of ['Core Attributes', 'Skills', 'Magic / Techniques', 'Active Status', 'Passive Status', 'Faction', 'Occupation', ...DEFAULT_ATTRIBUTES, 'MP', 'Stamina']) assert.ok(html.includes(text), text);
    assert.match(html, /data-stat-path="attr:Strength" value="12"/);
    assert.match(html, /aria-valuenow="31"/);
    const schema = { attributes: ['Spellwork', 'Courage'], pools: ['Stamina'], ranks: ['First-year', 'Prefect'], skills: [] };
    const themed = statPaneHtml(npc, { schema });
    assert.match(themed, /Spellwork/);
    assert.match(themed, /world schema/);
    assert.match(themed, /<datalist id="delta-stat-ranks-n1"><option value="First-year">/);
    assert.match(themed, /data-stat-path="attr:Strength" value="12"/, 'a stored attribute outside the schema still shows');
});

test('Stat tab edits: attributes, pools, rank, rows; an emptied name removes the row', () => {
    let sheet = applyStatEdit({}, 'attr:Strength', '12');
    sheet = applyStatEdit(sheet, 'pool:HP:max', '40');
    sheet = applyStatEdit(sheet, 'pool:HP:current', '31');
    sheet = applyStatEdit(sheet, 'rank', 'Bronze');
    sheet = addStatRow(sheet, 'skills');
    sheet = applyStatEdit(sheet, 'skills:0:name', 'Charms');
    sheet = applyStatEdit(sheet, 'skills:0:level', '3');
    sheet = addStatRow(sheet, 'passives');
    sheet = applyStatEdit(sheet, 'passives:0:effect', 'resists cold');
    let normal = normalizeSheet(sheet);
    assert.deepEqual(normal.attributes, [{ name: 'Strength', value: '12' }]);
    assert.deepEqual(normal.pools, [{ name: 'HP', current: 31, max: 40 }]);
    assert.equal(normal.rank, 'Bronze');
    assert.deepEqual(normal.skills, [{ name: 'Charms', level: '3' }]);
    assert.deepEqual(normal.passives, [{ name: 'New passive', effect: 'resists cold' }]);
    normal = normalizeSheet(applyStatEdit(normal, 'attr:Strength', ''));
    assert.equal(normal.attributes.length, 0, 'clearing a value removes it');
    normal = normalizeSheet(applyStatEdit(normal, 'skills:0:name', ''));
    assert.equal(normal.skills.length, 0);
    assert.equal(normalizeSheet(removeStatRow(normal, 'passives', 0)).passives.length, 0);
});
