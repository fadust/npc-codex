import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');

test('the post-reply scan runs fire-and-forget so the host event chain is not held', () => {
    const start = index.indexOf('source.on(events.MESSAGE_RECEIVED');
    const listener = index.slice(start, index.indexOf('});', start));
    assert.ok(start > 0);
    // The host awaits each listener in turn; this one must return before the LLM scan finishes.
    assert.doesNotMatch(listener, /async|await/);
    assert.match(listener, /handleAssistantMessageReceived\(messageId\)\.catch\(/);
    // Overlapping replies still queue behind the running scan instead of starting another.
    assert.match(index, /if \(isScanBusy\(scanChatKey\)\) \{[\s\S]{0,200}queuePendingAutoScan\(scanChatKey, messageId, 'busy-auto-scan'\)/);
});
