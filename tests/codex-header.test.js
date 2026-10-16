import test from 'node:test';
import assert from 'node:assert/strict';
import { codexHeaderHtml, codexLayoutStyles } from '../codex-header.js';
import { normalizeRole } from '../cast.js';
import { createNpcRecord, normalizeNpcRecord } from '../core.js';

test('header: name, identity chips, escaped tags and quote, tab slot', () => {
    const html = codexHeaderHtml({ id: 'grukk', name: 'Grukk', gender: 'male', species: 'orc', faction: 'Smiths Guild', location: 'forge', occupation: 'blacksmith', role: 'blacksmith of the guild forge', sheet: { rank: 'D' }, tags: ['<b>x</b>', 'veteran'], quote: 'Iron "remembers"', bucket: 'present', statusLabel: 'In chat' });
    assert.match(html, /<h2>Grukk<\/h2>/);
    for (const text of ['Smiths Guild', 'forge', 'orc', 'blacksmith', 'D', 'veteran', '+ Add tag', 'codex-tabs-slot']) assert.ok(html.includes(text), text);
    assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;') && !html.includes('<b>x</b>'), 'tags are escaped');
    assert.match(html, /<textarea data-codex-quote[^>]*>Iron &quot;remembers&quot;<\/textarea>/);
    assert.match(codexHeaderHtml({ id: 'a', name: 'Ann' }), /codex-chip is-empty[^>]*><i aria-hidden="true">⚑<\/i>Faction/);
    assert.match(codexHeaderHtml(null), /No dossier selected/);
    assert.match(codexLayoutStyles('root'), /grid-template-columns:270px minmax\(0,1fr\)/);
});

test('a role title that repeats its org is trimmed ("messenger of guild" + guild)', () => {
    assert.deepEqual(normalizeRole({ title: 'messenger of guild', org: 'guild' }), { title: 'messenger', org: 'guild' });
    assert.equal(normalizeRole({ title: 'Captain of the Guard', org: 'Guard' }).title, 'Captain');
    assert.equal(normalizeRole({ title: 'Head of House', org: 'House' }).title, 'Head');
    assert.equal(normalizeRole({ title: 'guild', org: 'guild' }).title, 'guild');
});

test('quote and tags are stored, trimmed and capped', () => {
    const npc = normalizeNpcRecord({ ...createNpcRecord('Grukk'), quote: '  Iron remembers.  ', tags: ['smith', 'smith', '', 'x'.repeat(50), ...Array.from({ length: 10 }, (_, i) => `t${i}`)] });
    assert.equal(npc.quote, 'Iron remembers.');
    assert.equal(npc.tags.length, 8);
    assert.equal(npc.tags[0], 'smith');
    assert.ok(npc.tags.every(tag => tag.length <= 32));
});
