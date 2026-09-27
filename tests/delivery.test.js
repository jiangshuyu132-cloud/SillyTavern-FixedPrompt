import test from 'node:test';
import assert from 'node:assert/strict';
import { createDelivery, attachmentBlock, messageText } from '../delivery.js';

const base = '带我去城门。', fixed = '请用简体中文回复。';
const combined = base + attachmentBlock(fixed);
const asMessages = chat => chat.map(m => ({ role: m.is_user ? 'user' : 'assistant', content: m.mes }));
function fixture(patch = {}) {
    let settings = { enabled: true, text: fixed, role: 2, depth: 10, ...patch };
    const context = { mainApi: 'openai', name1: '旅人', name2: '向导',
        chat: [{ is_user: false, mes: '欢迎。' }, { is_user: true, mes: base }] };
    const delivery = createDelivery(() => context, () => settings);
    return { context, delivery, update(patch) { settings = { ...settings, ...patch }; delivery.changed(); } };
}

for (const type of ['normal', 'regenerate', 'swipe', 'continue', undefined]) {
    test('same user message carries one attachment for ' + type, () => {
        const { context, delivery } = fixture();
        const original = structuredClone(context.chat), copy = [...context.chat];
        delivery.begin(type);
        delivery.intercept(copy, type);
        delivery.intercept(copy, type);
        const request = { type: type || 'normal', messages: asMessages(copy) };
        delivery.verifyChat(request);
        delivery.verifyChat(request);
        const wire = JSON.parse(JSON.stringify(request));
        assert.deepEqual(wire.messages, [{ role: 'assistant', content: '欢迎。' }, { role: 'user', content: combined }]);
        assert.deepEqual(context.chat, original);
        assert.equal(delivery.report().state, 'attached');
        assert.equal(delivery.report().preview, combined);
    });
}

test('repeated generations never accumulate attachments in saved history', () => {
    const { context, delivery } = fixture();
    for (let turn = 0; turn < 4; turn++) {
        const copy = [...context.chat];
        delivery.begin(); delivery.intercept(copy);
        const data = { type: 'normal', messages: asMessages(copy) };
        delivery.verifyChat(data);
        assert.equal(data.messages.filter(m => m.content.includes(attachmentBlock(fixed))).length, 1);
        context.chat.push({ is_user: false, mes: '这是城门。' }, { is_user: true, mes: '下一轮 ' + turn });
    }
    assert.ok(context.chat.every(m => !m.mes.includes('【固定提示词】')));
});

test('history/system/assistant matches are never evidence that the current user carries the text', () => {
    const { delivery } = fixture();
    delivery.begin();
    const history = [{ role: 'system', content: fixed },
        { role: 'user', content: '我曾写过：' + fixed }, { role: 'assistant', content: fixed }];
    const data = { type: 'normal', messages: [...history, { role: 'user', content: base }] };
    delivery.verifyChat(data);
    assert.deepEqual(data.messages.slice(0, 3), history);
    assert.equal(data.messages[3].content, combined);
});

test('older identical attached turn cannot hide a newer bare turn', () => {
    const { delivery } = fixture();
    delivery.begin();
    const data = { type: 'normal', messages: [{ role: 'user', content: combined },
        { role: 'assistant', content: '回复' }, { role: 'user', content: base }] };
    delivery.verifyChat(data);
    assert.equal(data.messages[0].content, combined);
    assert.equal(data.messages[2].content, combined);
});

test('late repair targets this user turn and leaves a later preset user instruction intact', () => {
    const { context, delivery } = fixture();
    delivery.begin(); delivery.intercept([...context.chat]);
    const after = { role: 'user', content: '预设附加的格式说明' };
    const data = { type: 'normal', messages: [{ role: 'user', content: base }, after] };
    delivery.verifyChat(data);
    assert.equal(data.messages[0].content, combined);
    assert.equal(data.messages[1], after);
});

test('multimodal repair preserves images, audio, tool order, prefill and input objects', () => {
    const { delivery } = fixture();
    delivery.begin();
    const parts = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,EXAMPLE' } },
        { type: 'text', text: base }, { type: 'input_audio', input_audio: { data: 'EXAMPLE', format: 'wav' } }];
    const tail = [{ role: 'assistant', content: null, tool_calls: [{ id: 'call1' }] },
        { role: 'tool', content: 'result', tool_call_id: 'call1' }, { role: 'assistant', content: '回应：' }];
    const original = [{ role: 'system', content: '原有设定' }, { role: 'user', content: parts }, ...tail];
    const snapshot = structuredClone(original);
    const data = { type: 'normal', messages: original };
    delivery.verifyChat(data);
    assert.deepEqual(original, snapshot);
    assert.deepEqual(data.messages[1].content, [...parts, { type: 'text', text: attachmentBlock(fixed) }]);
    assert.deepEqual(data.messages.slice(2), tail);
    assert.ok(delivery.report().preview.includes(fixed));
    assert.ok(!delivery.report().preview.includes('base64'));
});

test('macros resolve once per generation; editing changes the next composition', () => {
    const { context, delivery, update } = fixture({ text: '你好 {{user}}、{{char}} {{random}}' });
    let calls = 0;
    context.substituteParams = text => { calls++; return text.replace('{{user}}', '旅人').replace('{{char}}', '向导').replace('{{random}}', String(calls)); };
    const copy = [...context.chat];
    delivery.begin(); delivery.intercept(copy);
    update({ text: '新文字 {{random}}' });
    const data = { type: 'normal', messages: asMessages(copy) };
    delivery.verifyChat(data);
    assert.equal(calls, 1);
    assert.equal(data.messages.at(-1).content, base + attachmentBlock('你好 旅人、向导 1'));
    const next = [...context.chat];
    delivery.begin(); delivery.intercept(next);
    const nextData = { type: 'normal', messages: asMessages(next) };
    delivery.verifyChat(nextData);
    assert.equal(calls, 2);
    assert.equal(nextData.messages.at(-1).content, base + attachmentBlock('新文字 2'));
});

test('a message split into text parts already carries the attachment and must not get a duplicate', () => {
    const { context, delivery } = fixture();
    delivery.begin(); delivery.intercept([...context.chat]);
    const parts = [{ type: 'text', text: base }, { type: 'text', text: attachmentBlock(fixed) }];
    const data = { type: 'normal', messages: [{ role: 'user', content: parts }] };
    delivery.verifyChat(data);
    assert.deepEqual(data.messages[0].content, parts);
    assert.equal(delivery.report().state, 'attached');
});

test('fallback macro handling preserves whitespace and Unicode', () => {
    const { context, delivery } = fixture({ text: '  {{user}}\n{{char}}✨  ' });
    const copy = [...context.chat];
    delivery.intercept(copy);
    assert.equal(copy.at(-1).mes, base + attachmentBlock('  旅人\n向导✨  '));
});

for (const settings of [{ enabled: false }, { text: '' }, { text: ' \n\t' }]) {
    test('disabled or blank text leaves requests alone: ' + JSON.stringify(settings), () => {
        const { context, delivery } = fixture(settings), copy = [...context.chat];
        delivery.begin(); delivery.intercept(copy);
        const data = { type: 'normal', messages: asMessages(copy) };
        delivery.verifyChat(data);
        assert.deepEqual(copy, context.chat);
        assert.equal(data.messages.at(-1).content, base);
        assert.notEqual(delivery.report().state, 'attached');
    });
}

for (const type of ['quiet', 'impersonate', 'unknown']) {
    test('excluded generation stays untouched: ' + type, () => {
        const { context, delivery } = fixture(), copy = [...context.chat];
        delivery.begin(type); delivery.intercept(copy, type);
        const data = { type, messages: asMessages(copy) };
        delivery.verifyChat(data);
        assert.deepEqual(copy, context.chat);
        assert.equal(data.messages.at(-1).content, base);
    });
}

test('dry run does not arm repair and unrelated types cannot consume pending delivery', () => {
    const { delivery } = fixture();
    delivery.begin('normal', true);
    const data = { type: 'normal', messages: [{ role: 'user', content: base }] };
    delivery.verifyChat(data);
    assert.equal(data.messages[0].content, base);
    delivery.begin('normal');
    for (const type of ['quiet', 'impersonate', 'continue', undefined]) {
        const other = { type, messages: [{ role: 'user', content: base }] };
        if (type === undefined) delete other.type;
        delivery.verifyChat(other);
        assert.equal(other.messages[0].content, base);
    }
    delivery.verifyChat(data);
    assert.equal(data.messages[0].content, combined);
});

test('nested quiet generation and its end event do not erase foreground delivery', () => {
    const { context, delivery } = fixture(), copy = [...context.chat];
    delivery.begin(); delivery.intercept(copy);
    delivery.begin('quiet'); delivery.intercept([...context.chat], 'quiet');
    const quiet = { type: 'quiet', messages: [{ role: 'user', content: '总结' }] };
    delivery.verifyChat(quiet); delivery.end();
    const data = { type: 'normal', messages: asMessages(copy) };
    delivery.verifyChat(data);
    assert.equal(data.messages.at(-1).content, combined);
    assert.equal(quiet.messages[0].content, '总结');
    assert.equal(delivery.report().state, 'attached');
});

test('without user history create a request-only user entry while keeping prefill last', () => {
    const { context, delivery } = fixture();
    context.chat = [{ is_user: false, mes: '开场白' }];
    const original = structuredClone(context.chat), copy = [...context.chat];
    delivery.begin('regenerate'); delivery.intercept(copy, 'regenerate');
    assert.deepEqual(context.chat, original);
    const data = { type: 'regenerate', messages: asMessages(copy) };
    delivery.verifyChat(data);
    assert.equal(data.messages.at(-1).content, attachmentBlock(fixed));
    delivery.begin('regenerate');
    const fallback = { type: 'regenerate', messages: [{ role: 'assistant', content: '开场：' }] };
    delivery.verifyChat(fallback);
    assert.deepEqual(fallback.messages, [{ role: 'user', content: attachmentBlock(fixed) }, { role: 'assistant', content: '开场：' }]);
});

test('missing current message reports failure without rewriting unrelated messages', () => {
    const { delivery } = fixture();
    delivery.begin();
    const data = { type: 'normal', messages: [{ role: 'system', content: fixed }, { role: 'user', content: '其他内容' }] };
    const original = structuredClone(data);
    delivery.verifyChat(data);
    assert.equal(delivery.report().state, 'error');
    assert.deepEqual(data, original);
});

test('readonly requests, macro failure and live chat references never produce false success', () => {
    const { context, delivery } = fixture();
    delivery.begin();
    const data = Object.freeze({ type: 'normal', messages: [{ role: 'user', content: base }] });
    delivery.verifyChat(data);
    assert.equal(delivery.report().state, 'error');
    assert.equal(data.messages[0].content, base);
    context.substituteParams = () => { throw new Error('macro'); };
    delivery.intercept([...context.chat]);
    assert.equal(delivery.report().state, 'error');
    delivery.intercept(context.chat);
    assert.equal(context.chat.at(-1).mes, base);
    assert.match(delivery.report().summary, /生成副本/);
});

test('text completion verifies combined text before the unchanged assistant prefix', () => {
    const { context, delivery } = fixture(), copy = [...context.chat];
    context.mainApi = 'textgenerationwebui';
    delivery.begin(); delivery.intercept(copy);
    const body = { prompt: 'User: ' + copy.at(-1).mes + '\nAssistant: ' }, original = structuredClone(body);
    delivery.verifyText({ prompt: '其他后台内容' });
    assert.equal(delivery.report().state, 'prepared');
    delivery.verifyText(body, true);
    assert.equal(delivery.report().state, 'prepared');
    delivery.verifyText(body);
    assert.equal(delivery.report().state, 'attached');
    assert.equal(delivery.report().preview, combined);
    assert.deepEqual(body, original);
    assert.ok(JSON.stringify(body).includes('【固定提示词】'));
});

test('stop and reset disarm repair without claiming success', () => {
    const { context, delivery } = fixture();
    for (const stop of [() => delivery.end(true), () => delivery.reset()]) {
        delivery.begin(); delivery.intercept([...context.chat]); stop();
        const data = { type: 'normal', messages: [{ role: 'user', content: base }] };
        delivery.verifyChat(data);
        assert.equal(data.messages[0].content, base);
        assert.notEqual(delivery.report().state, 'attached');
    }
    assert.equal(delivery.report().preview, '');
});

test('preview extracts text only', () => {
    assert.equal(messageText({ content: [{ type: 'image_url', image_url: { url: fixed } }, { type: 'text', text: '正文' }] }), '正文');
});
