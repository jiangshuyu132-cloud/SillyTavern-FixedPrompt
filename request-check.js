// Checks the actual Chat Completion request at SillyTavern's last pre-send hook.
// No requests, transcripts or prompt text are logged or persisted here.
const conversationTypes = new Set(['normal', 'regenerate', 'swipe', 'continue']);
const normalize = text => text.replace(/\r\n?/g, '\n').trim();

function expectedText(text, context) {
    let unresolved = false;
    const resolved = text.replace(/\{\{\s*(user|char)\s*\}\}/gi, (match, name) => {
        const value = name.toLowerCase() === 'user' ? context?.name1 : context?.name2;
        if (typeof value !== 'string') { unresolved = true; return match; }
        return value;
    });
    // Do not evaluate random, time, variable or side-effect macros a second time.
    if (unresolved || resolved.includes('{{')) return null;
    return normalize(resolved);
}

function messageText(message) {
    if (typeof message?.content === 'string') return message.content;
    if (!Array.isArray(message?.content)) return '';
    return message.content.filter(part => part?.type === 'text' && typeof part.text === 'string')
        .map(part => part.text).join('\n');
}

export function createRequestCheck(getContext, getSettings, onChange = () => {}) {
    let armed = false;
    let report = { state: 'waiting', summary: '已启用 · 等待下一次发送检查',
        detail: '填写和保存不代表已发送。下一次聊天请求会在发送前检查；检查结果不代表模型已接收或执行。' };
    function setReport(state, summary, detail) {
        report = { state, summary, detail, time: Date.now() };
        onChange();
        return report;
    }
    function reset(disarm = true) {
        if (disarm) armed = false;
        if (armed) return setReport('pending', '生成中 · 等待发送前检查', '将按当前保存的设置核对本次待发送请求。');
        return setReport('waiting', '已启用 · 等待下一次发送检查',
            '填写和保存不代表已发送。下一次聊天请求会在发送前检查；检查结果不代表模型已接收或执行。');
    }
    function begin(type = 'normal', dryRun = false) {
        if (dryRun || !conversationTypes.has(type || 'normal')) return;
        armed = true;
        setReport('pending', '生成中 · 等待发送前检查', '正在等待酒馆组装本次聊天请求。');
    }
    function verify(data) {
        // The request's own type is authoritative. A quiet task may have run in between.
        if (!armed || !data || data.dryRun || !Object.hasOwn(data, 'type')
            || !conversationTypes.has(data.type || 'normal')) return report;
        armed = false;
        const settings = getSettings();
        if (!settings.enabled || !settings.text.trim()) return reset();
        if (!Array.isArray(data.messages)) return setReport('unverified', '未核验 · 请求格式不受支持', '没有读取到本次请求的消息列表，不能确认是否携带。');
        const text = expectedText(settings.text, getContext());
        if (text === null || !text) return setReport('unverified', '未核验 · 提示词包含动态宏',
            '继续使用酒馆原生注入。为避免重复执行动态宏，本次未自动比对或补回；{{user}} 和 {{char}} 可自动核验。');
        const present = data.messages.some(message => normalize(messageText(message)).includes(text));
        if (present) return setReport('found', '已检查 · 待发送请求中已找到提示词',
            '在酒馆待发送给后端的消息中找到了当前提示词。后端或中转服务仍可能处理请求；这不等于模型一定执行。');
        // Nonzero depth cannot be reconstructed reliably from the final merged messages.
        // Keep its configured position rather than silently moving it to the end.
        if (settings.depth !== 0) return setReport('missing', '未找到 · 本次请求没有匹配到提示词',
            `当前插入深度为 ${settings.depth}，可能被截断或改写。可改为深度 0 后重试；未改变你的设置或消息。`);
        if (data.messages.some(message => Array.isArray(message?.tool_calls) && message.tool_calls.length)) {
            return setReport('missing', '未找到 · 工具调用请求需核对', '为避免改变工具调用顺序，本次仅报告缺失，不自动插入。');
        }
        const role = ['system', 'user', 'assistant'][settings.role] ?? 'system';
        let index = data.messages.length;
        // Keep an assistant continuation/prefill last, as required by some providers.
        if (data.messages.at(-1)?.role === 'assistant') index--;
        try {
            data.messages.splice(index, 0, { role, content: text });
        } catch {
            return setReport('missing', '未找到 · 本次请求无法补回', '待发送的消息列表不可修改，未能补回提示词。');
        }
        return setReport('repaired', '已补回 · 待发送请求已加入提示词',
            '发送前没有找到当前提示词，已按深度 0 和所选身份补入一次。补入内容仍占用上下文；模型是否执行需看回复。');
    }
    function end(cancel = false) {
        // GENERATION_ENDED has no request ID/type and may belong to a nested quiet task.
        // Keep the pending check armed until a real chat request, explicit stop or reset.
        if (cancel) armed = false;
        if (report.state === 'pending') setReport('unverified', '未核验 · 未取得发送前检查结果',
            '本次生成结束或被停止，但未取得受支持的请求检查事件；不能把它当作已发送成功。');
    }
    return { begin, verify, reset, end, report: () => ({ ...report }) };
}
