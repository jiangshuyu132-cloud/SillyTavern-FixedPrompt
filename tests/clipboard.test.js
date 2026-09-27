import test from 'node:test';
import assert from 'node:assert/strict';
import { copyText } from '../clipboard.js';

test('HTTP fallback copies inside the user click and removes its temporary field', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    try {
        for (const mode of ['missing-api', 'rejected-api', 'copy-denied']) {
            let removed = false, selected = false, restored = false, copied;
            Object.defineProperty(globalThis, 'navigator', { configurable: true, value: mode === 'rejected-api'
                ? { clipboard: { async writeText() { throw new Error('denied'); } } } : {} });
            const input = { style: {}, setAttribute() {}, focus() {}, select() { selected = true; }, remove() { removed = true; } };
            const document = { body: { append() {} }, createElement() { return input; },
                execCommand(command) { assert.equal(command, 'copy'); copied = input.value; return mode !== 'copy-denied'; } };
            const result = await copyText('用户文字\n\n固定文字', document, { focus() { restored = true; } });
            assert.equal(result, mode !== 'copy-denied');
            assert.equal(copied, '用户文字\n\n固定文字');
            assert.ok(selected && removed && restored);
        }
    } finally {
        if (original) Object.defineProperty(globalThis, 'navigator', original);
        else delete globalThis.navigator;
    }
});
