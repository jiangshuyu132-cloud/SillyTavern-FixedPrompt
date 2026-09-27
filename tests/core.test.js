import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, normalizeSettings, promptForGeneration, PROMPT_KEY, SETTINGS_KEY } from '../core.js';

function fixture(saved = {}) {
    const state = {
        extensionSettings: { [SETTINGS_KEY]: saved },
        extensionPrompts: { another_extension: { value: 'other prompt' } },
        chat: [{ is_user: true, mes: 'Hello' }],
        saves: 0,
    };
    const getContext = () => ({
        ...state,
        setExtensionPrompt(key, value, position, depth, scan, role) {
            state.extensionPrompts[key] = { value, position, depth, scan, role };
        },
        saveSettingsDebounced() { state.saves += 1; },
    });
    return { state, controller: createController(getContext), getContext };
}

test('first installation has an empty prompt and safe defaults', () => {
    for (const input of [undefined, null, [], 123]) {
        assert.deepEqual(normalizeSettings(input), { enabled: true, text: '', depth: 0, role: 0 });
    }
});

test('invalid stored values cannot send objects, invalid roles or unbounded depths', () => {
    assert.deepEqual(normalizeSettings({ text: {}, enabled: 'false', depth: Infinity, role: 2 }),
        { enabled: true, text: '', depth: 0, role: 0 });
    assert.equal(normalizeSettings({ depth: -50 }).depth, 0);
    assert.equal(normalizeSettings({ depth: 1000 }).depth, 100);
    assert.equal(normalizeSettings({ depth: '5.6', role: '1' }).depth, 5);
    assert.equal(normalizeSettings({ role: '1' }).role, 1);
});

test('prompts preserve newlines, Unicode, formatting and macros', () => {
    const text = '  请用中文回复 {{user}}。\n角色是 {{char}}。\n格式：<tag>✨</tag>\n';
    assert.equal(promptForGeneration({ text }), text);
});

test('disabled and whitespace-only prompts are not sent', () => {
    assert.equal(promptForGeneration({ text: '规则', enabled: false }), '');
    assert.equal(promptForGeneration({ text: ' \n\t ' }), '');
});

for (const type of ['normal', 'regenerate', 'swipe', 'continue', undefined]) {
    test(`conversational generation ${String(type)} carries the fixed prompt`, () => {
        const { controller, state } = fixture({ text: '始终用中文回复。' });
        controller.sync(type);
        assert.deepEqual(state.extensionPrompts[PROMPT_KEY], {
            value: '始终用中文回复。', position: 1, depth: 0, scan: false, role: 0,
        });
    });
}

test('repeated generations replace one entry without altering chat or other extensions', () => {
    const { controller, state } = fixture({ text: '规则' });
    const originalChat = structuredClone(state.chat);
    for (let i = 0; i < 20; i += 1) controller.sync('normal');
    assert.equal(Object.keys(state.extensionPrompts).length, 2);
    assert.equal(state.extensionPrompts[PROMPT_KEY].value, '规则');
    assert.deepEqual(state.chat, originalChat);
    assert.deepEqual(state.extensionPrompts.another_extension, { value: 'other prompt' });
});

test('quiet and impersonation clear stale prompts; next chat generation restores them', () => {
    const { controller, state } = fixture({ text: '聊天规则' });
    for (const type of ['quiet', 'impersonate']) {
        controller.sync('normal');
        controller.sync(type);
        assert.equal(state.extensionPrompts[PROMPT_KEY].value, '');
        controller.update({ text: '修改后的规则' });
        assert.equal(state.extensionPrompts[PROMPT_KEY].value, '');
        controller.sync('regenerate');
        assert.equal(state.extensionPrompts[PROMPT_KEY].value, '修改后的规则');
    }
});

test('editing saves immediately and uses the latest text on the next request', () => {
    const { controller, state } = fixture({ text: '旧规则' });
    controller.sync();
    controller.update({ text: '新规则', role: '1', depth: '3' });
    assert.equal(state.saves, 1);
    assert.equal(state.extensionSettings[SETTINGS_KEY].text, '新规则');
    assert.deepEqual(state.extensionPrompts[PROMPT_KEY], {
        value: '新规则', position: 1, depth: 3, scan: false, role: 1,
    });
});

test('disabling or clearing removes the current injection immediately', () => {
    const { controller, state } = fixture({ text: '规则' });
    controller.sync();
    controller.update({ enabled: false });
    assert.equal(state.extensionPrompts[PROMPT_KEY].value, '');
    assert.equal(controller.settings().text, '规则');
    controller.update({ enabled: true });
    assert.equal(state.extensionPrompts[PROMPT_KEY].value, '规则');
    controller.update({ text: '' });
    assert.equal(state.extensionPrompts[PROMPT_KEY].value, '');
});

test('settings survive a new controller / page reload', () => {
    const { controller, getContext, state } = fixture();
    controller.update({ text: '长期规则', depth: 2, role: 1 });
    const nextController = createController(getContext);
    nextController.sync();
    assert.equal(nextController.settings().text, '长期规则');
    assert.equal(state.extensionPrompts[PROMPT_KEY].depth, 2);
});

test('fresh contexts are read after switching accounts or chats', () => {
    const first = fixture({ text: '一号规则' });
    const second = fixture({ text: '二号规则' });
    let active = first;
    const controller = createController(() => active.getContext());
    controller.sync();
    active = second;
    controller.sync('normal');
    assert.equal(second.state.extensionPrompts[PROMPT_KEY].value, '二号规则');
});

test('cleanup removes only this extension injection and keeps saved settings', () => {
    const { controller, state } = fixture({ text: '保留规则' });
    controller.sync();
    controller.clear();
    assert.equal(PROMPT_KEY in state.extensionPrompts, false);
    assert.equal(state.extensionSettings[SETTINGS_KEY].text, '保留规则');
    assert.equal(state.extensionPrompts.another_extension.value, 'other prompt');
});
