import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, normalizeSettings, PROMPT_KEY, SETTINGS_KEY } from '../core.js';

function fixture(saved = {}) {
    const context = {
        extensionSettings: { [SETTINGS_KEY]: saved },
        extensionPrompts: { other: { value: 'keep' }, [PROMPT_KEY]: { value: 'legacy' } },
        chat: [{ is_user: true, mes: 'Hello' }],
        saves: 0,
        saveSettingsDebounced() { context.saves++; },
        setExtensionPrompt(key, value) { context.extensionPrompts[key] = { value }; },
    };
    const getContext = () => ({ ...context });
    return { context, getContext, controller: createController(getContext) };
}

test('empty installation and invalid settings normalize safely', () => {
    for (const input of [undefined, null, [], 123]) {
        assert.deepEqual(normalizeSettings(input), { enabled: true, text: '', depth: 0, role: 0 });
    }
    assert.deepEqual(normalizeSettings({ text: {}, enabled: 'false', depth: Infinity, role: 3 }),
        { enabled: true, text: '', depth: 0, role: 0 });
    assert.equal(normalizeSettings({ depth: -50 }).depth, 0);
    assert.equal(normalizeSettings({ depth: 1000 }).depth, 100);
});

test('upgrade retains saved settings and removes only our legacy injection', () => {
    const saved = { text: '  提示词\n{{char}}✨  ', enabled: false, depth: 4, role: 2 };
    const { controller, context } = fixture(saved);
    controller.clearLegacyPrompt();
    assert.deepEqual(controller.settings(), saved);
    assert.equal(context.saves, 0);
    assert.equal(PROMPT_KEY in context.extensionPrompts, false);
    assert.equal(context.extensionPrompts.other.value, 'keep');
});

test('editing auto-saves literal text and survives reinitialization', () => {
    const { controller, context, getContext } = fixture({ text: '旧文字', depth: 3, role: 1 });
    controller.update({ text: '<b>纯文本</b>\n新文字✨', enabled: false });
    const next = createController(getContext);
    assert.deepEqual(next.settings(), { text: '<b>纯文本</b>\n新文字✨', enabled: false, depth: 3, role: 1 });
    assert.equal(context.saves, 1);
    assert.equal(PROMPT_KEY in context.extensionPrompts, false);
    next.update({ enabled: true });
    assert.equal(next.settings().text, '<b>纯文本</b>\n新文字✨');
});

test('fresh context is used after switching chats; cleanup keeps saved text', () => {
    const first = fixture({ text: '甲' }), second = fixture({ text: '乙' });
    let active = first;
    const controller = createController(() => active.getContext());
    assert.equal(controller.settings().text, '甲');
    active = second;
    controller.delivery.intercept([...second.context.chat]);
    assert.equal(controller.delivery.report().preview, 'Hello\n\n【固定提示词】\n乙');
    controller.clear();
    assert.equal(controller.delivery.report().preview, '');
    assert.equal(controller.settings().text, '乙');
    assert.equal(second.context.extensionPrompts.other.value, 'keep');
});
