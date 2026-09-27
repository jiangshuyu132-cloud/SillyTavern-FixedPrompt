import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, SETTINGS_KEY, PROMPT_KEY } from '../core.js';

function fixture(patch = {}) {
    let notifications = 0;
    const context = {
        name1: '读者', name2: '向导',
        extensionSettings: { [SETTINGS_KEY]: { enabled: true, text: '请用简体中文回复。', depth: 0, role: 0, ...patch } },
        extensionPrompts: {},
        chat: [{ is_user: true, mes: '你好' }],
        setExtensionPrompt(key, value, position, depth, scan, role) {
            this.extensionPrompts[key] = { value, position, depth, scan, role };
        },
        saveSettingsDebounced() {},
    };
    const controller = createController(() => context, () => notifications++);
    const request = (type = 'normal') => ({ type, messages: [{ role: 'user', content: '你好' }],
        model: 'test-model', stream: true, temperature: .7 });
    return { context, controller, check: controller.requestCheck, request, get notifications() { return notifications; } };
}

test('regression: nested quiet generation clears native slot; final normal request is repaired once', () => {
    const { context, controller, check, request } = fixture();
    const originalChat = structuredClone(context.chat);
    controller.sync('normal');
    check.begin('normal');
    assert.equal(context.extensionPrompts[PROMPT_KEY].value, '请用简体中文回复。');
    controller.sync('quiet');
    check.begin('quiet');
    assert.equal(context.extensionPrompts[PROMPT_KEY].value, '');
    const quiet = request('quiet'), originalQuiet = structuredClone(quiet);
    check.verify(quiet);
    assert.deepEqual(quiet, originalQuiet);
    check.end(); // A nested completion cannot disarm the foreground check.
    const normal = request();
    assert.equal(check.verify(normal).state, 'repaired');
    assert.deepEqual(normal.messages.at(-1), { role: 'system', content: '请用简体中文回复。' });
    check.verify(normal);
    assert.equal(normal.messages.length, 2);
    assert.deepEqual(context.chat, originalChat);
    assert.equal(context.extensionPrompts[PROMPT_KEY].value, '');
    assert.equal(normal.temperature, .7);
    assert.equal(normal.model, 'test-model');
});

for (const type of ['normal', 'regenerate', 'swipe', 'continue']) {
    test(`${type}: already present prompt is verified without changing the request`, () => {
        const { check, request } = fixture();
        check.begin(type);
        const data = request(type);
        data.messages.push({ role: 'system', content: '其他规则\n请用简体中文回复。\n后续规则' });
        const original = structuredClone(data);
        assert.equal(check.verify(data).state, 'found');
        assert.deepEqual(data, original);
    });
}

test('multimodal text is checked without reading image URLs or attachments as prompt text', () => {
    const { check, request } = fixture();
    check.begin();
    const data = request();
    data.messages[0].content = [{ type: 'image_url', image_url: { url: 'data:test' } }, { type: 'text', text: '请用简体中文回复。' }];
    assert.equal(check.verify(data).state, 'found');
    assert.equal(data.messages.length, 1);
});

test('checks and repairs supported name macros without re-evaluating dynamic macros', () => {
    const { context, check, request } = fixture({ text: '{{user}} 和 {{char}} 使用中文交流。' });
    context.substituteParams = () => { throw new Error('must not evaluate arbitrary macros'); };
    check.begin();
    const data = request();
    check.verify(data);
    assert.equal(data.messages.at(-1).content, '读者 和 向导 使用中文交流。');
    context.extensionSettings[SETTINGS_KEY].text = '{{random::a::b}} {{setvar::key::value}}';
    check.begin();
    const dynamic = request();
    assert.equal(check.verify(dynamic).state, 'unverified');
    assert.equal(dynamic.messages.length, 1);
});

test('nonzero depth, tool calls, and immutable requests report missing without corrupting content', () => {
    const { context, check, request } = fixture({ depth: 4 });
    check.begin();
    const deep = request(), originalDeep = structuredClone(deep);
    assert.equal(check.verify(deep).state, 'missing');
    assert.deepEqual(deep, originalDeep);
    context.extensionSettings[SETTINGS_KEY].depth = 0;
    check.begin();
    const tools = request();
    tools.messages.push({ role: 'assistant', tool_calls: [{ id: '1' }] });
    const originalTools = structuredClone(tools);
    assert.equal(check.verify(tools).state, 'missing');
    assert.deepEqual(tools, originalTools);
    check.begin();
    const frozen = request();
    Object.freeze(frozen.messages);
    assert.equal(check.verify(frozen).state, 'missing');
});

test('continuation keeps the assistant prefill last and respects the selected role', () => {
    const { check, request } = fixture({ role: 1 });
    check.begin('continue');
    const data = request('continue');
    data.messages.push({ role: 'assistant', content: '还未完成的句子' });
    check.verify(data);
    assert.deepEqual(data.messages[1], { role: 'user', content: '请用简体中文回复。' });
    assert.equal(data.messages.at(-1).content, '还未完成的句子');
    check.begin('normal');
    const prefilled = request('normal');
    prefilled.messages.push({ role: 'assistant', content: '回复前缀' });
    check.verify(prefilled);
    assert.equal(prefilled.messages.at(-1).content, '回复前缀');
    assert.equal(prefilled.messages[1].content, '请用简体中文回复。');
});

test('disabled, empty, preview, quiet, impersonation and unrecognized requests are never supplemented', () => {
    for (const settings of [{ enabled: false }, { text: ' \n ' }]) {
        const { check, request } = fixture(settings);
        check.begin();
        const data = request(), original = structuredClone(data);
        check.verify(data);
        assert.deepEqual(data, original);
    }
    const { check, request } = fixture();
    check.begin('normal', true);
    const preview = request();
    assert.equal(check.verify(preview).state, 'waiting');
    check.begin();
    for (const type of ['quiet', 'impersonate', 'raw', 'unknown']) {
        const data = request(type), original = structuredClone(data);
        check.verify(data);
        assert.deepEqual(data, original);
    }
    const unknown = request();
    delete unknown.type;
    check.verify(unknown);
    assert.equal(unknown.messages.length, 1);
    const raw = fixture();
    const rawData = raw.request();
    raw.check.verify(rawData); // No foreground generation event occurred.
    assert.equal(rawData.messages.length, 1);
});

test('editing invalidates old results; updates during generation are checked with current settings', () => {
    const { controller, check, request } = fixture();
    check.begin(); check.verify(request());
    controller.update({ text: '使用短句。' });
    assert.equal(check.report().state, 'waiting');
    check.begin();
    controller.update({ text: '每段一句。' });
    const data = request();
    check.verify(data);
    assert.equal(data.messages.at(-1).content, '每段一句。');
});

test('stopping or resetting cancels stale checks; unsupported interfaces never claim verified', () => {
    const { check, request } = fixture();
    check.begin(); check.end(true);
    assert.equal(check.report().state, 'unverified');
    const stopped = request(); check.verify(stopped);
    assert.equal(stopped.messages.length, 1);
    check.begin(); check.reset();
    const afterChatSwitch = request(); check.verify(afterChatSwitch);
    assert.equal(afterChatSwitch.messages.length, 1);
    check.begin();
    assert.equal(check.verify({ type: 'normal', prompt: 'plain text API' }).state, 'unverified');
});

test('verification report contains no saved prompt text or full request', () => {
    const secretText = '本地测试私有文本-0123456789';
    const { check, request } = fixture({ text: secretText });
    check.begin(); check.verify(request());
    assert.equal(JSON.stringify(check.report()).includes(secretText), false);
    const copy = check.report(); copy.state = 'changed';
    assert.equal(check.report().state, 'repaired');
});
