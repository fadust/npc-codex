import test from 'node:test';
import assert from 'node:assert/strict';
import { stripBaiBaiImageTags, narrativeLineage, destructiveMutationSettled } from '../destructive-settlement-core.js';
import { fingerprintMessage, chatLineage, migrateLegacyLineage, lineageCheckpointKeys } from '../branch.js';
import { stripUiNoise } from '../core.js';

const image = '<bbi_image>blue ribbon<nl>Ari at the river</nl><size>portrait</size></bbi_image>';
const message = mes => ({ is_user: false, mes });

test('BaiBai image insertion, replacement and removal preserve story identity and scanner evidence', () => {
    for (const eol of ['\n', '\r\n']) {
        const story = `Ari Vale speaks softly.${eol}${eol}Kai listens.`;
        const tagged = `Ari Vale speaks softly.${eol}${image}${eol}${eol}Kai listens.${eol}${image}`;
        for (const text of [story, tagged, tagged.replaceAll('blue ribbon', 'red cloak')]) {
            assert.equal(stripBaiBaiImageTags(text), story);
            assert.equal(fingerprintMessage(message(text)), fingerprintMessage(message(story)));
            assert.deepEqual(narrativeLineage([message(text)]), narrativeLineage([message(story)]));
            assert.equal(stripUiNoise(text), stripUiNoise(story));
        }
        const edited = tagged.replace('speaks softly', 'shouts angrily');
        assert.notEqual(fingerprintMessage(message(edited)), fingerprintMessage(message(story)));
        assert.equal(destructiveMutationSettled('edit', narrativeLineage([message(story)]), narrativeLineage([message(edited)])), true);
    }
    assert.equal(stripBaiBaiImageTags(`A${image} B`), 'A B');
    assert.equal(stripBaiBaiImageTags('A <bbi_image>unfinished story'), 'A <bbi_image>unfinished story');
    assert.notEqual(fingerprintMessage(message('Ari leaves.')), fingerprintMessage(message('Ari stays.')));
});

function oldFingerprint(mes) {
    const text = JSON.stringify({ user: false, system: false, text: mes });
    const hash = seed => { let h = seed; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0; return h.toString(36); };
    return `${hash(0x811c9dc5)}.${hash(0x9e3779b9)}`;
}

test('upgrade remaps proven old image-bearing keys but does not bless changed story content', () => {
    const text = `Ari listens.\n${image}`;
    const from = [oldFingerprint(text)];
    const key = lineageCheckpointKeys(from)[0];
    const state = { lineage: from, checkpoints: [{ messageId: 0, lineageKey: key }], rollbackJournal: [{ messageId: 0, lineageKey: key }], inlineCards: [{ messageId: 0, lineageKey: key }], rollbackHead: { messageId: 0, lineageKey: key } };
    const changed = structuredClone(state);
    assert.equal(migrateLegacyLineage(changed, [message(text.replace('listens', 'leaves'))]), false);
    assert.deepEqual(changed, state);
    assert.equal(migrateLegacyLineage(state, [message(text)]), true);
    assert.deepEqual(state.lineage, chatLineage([message('Ari listens.')]));
    const next = lineageCheckpointKeys(state.lineage)[0];
    for (const row of [...state.checkpoints, ...state.rollbackJournal, ...state.inlineCards, state.rollbackHead]) assert.equal(row.lineageKey, next);
    assert.equal(migrateLegacyLineage(state, [message(text)]), false);
});
