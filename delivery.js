const supportedTypes = new Set(['normal', 'regenerate', 'swipe', 'continue']);
const normalType = type => type || 'normal';
const normalize = text => String(text).replace(/\r\n?/g, '\n');
export const attachmentBlock = text => `\n\n【固定提示词】\n${text}`;

export function messageText(message) {
    if (typeof message?.content === 'string') return message.content;
    if (!Array.isArray(message?.content)) return '';
    return message.content.filter(part => part?.type === 'text' && typeof part.text === 'string')
        .map(part => part.text).join('\n');
}

/** Only modifies generation copies / outgoing payloads. Never mutates context.chat. */
export function createDelivery(getContext, getSettings, onChange = () => {}) {
    let pending = null;
    let coreRecords = new WeakMap();
    let handledRequests = new WeakSet();
    let report = waiting();

    function waiting() {
        return { state: 'waiting', summary: '已启用 · 下次发送自动附带',
            detail: '发送时将固定提示词附在本次用户消息后面。这里会显示组合后的内容。', preview: '' };
    }
    function publish(state, summary, detail, preview = '') {
        report = { state, summary, detail, preview };
        onChange();
        return { ...report };
    }
    function reset() {
        pending = null;
        coreRecords = new WeakMap();
        handledRequests = new WeakSet();
        report = waiting();
        onChange();
    }
    function changed() {
        // A generation already being assembled keeps its snapshot; edits apply next time.
        report = waiting();
        onChange();
    }
    function begin(type = 'normal', dryRun = false) {
        if (dryRun || !supportedTypes.has(normalType(type))) return;
        pending = { type: normalType(type), record: null };
        publish('pending', '准备发送 · 正在组合消息', '本轮正在准备用户消息和固定提示词。');
    }
    function makeRecord(base, type) {
        const settings = getSettings();
        if (!settings.enabled || !settings.text.trim()) return null;
        const context = getContext();
        // Resolve macros once for this request, then reuse the same snapshot at the final hook.
        const text = typeof context?.substituteParams === 'function'
            ? String(context.substituteParams(settings.text))
            : settings.text.replace(/\{\{\s*(user|char)\s*\}\}/gi, (match, name) => {
                const value = name.toLowerCase() === 'user' ? context?.name1 : context?.name2;
                return typeof value === 'string' ? value : match;
            });
        if (!text.trim()) return null;
        return { type: normalType(type), base, block: attachmentBlock(text), composed: base + attachmentBlock(text) };
    }
    function intercept(chat, type = 'normal') {
        if (!supportedTypes.has(normalType(type)) || !Array.isArray(chat)) return;
        if (chat === getContext()?.chat) {
            publish('error', '未附带 · 收到的不是生成副本', '为保护聊天记录，本次没有修改原始聊天。');
            return;
        }
        const existing = coreRecords.get(chat);
        if (existing) { pending = { type: existing.type, record: existing }; return; }
        const index = chat.findLastIndex(message => message?.is_user && !message.is_system);
        const base = index < 0 ? '' : String(chat[index].mes ?? '');
        let record;
        try { record = makeRecord(base, type); }
        catch { publish('error', '未附带 · 提示词宏处理失败', '固定文本已保存，但本轮无法完成宏替换。'); return; }
        if (!record) { pending = null; return; }
        // Replace the object: even a shallow copy of saved messages is safe.
        if (index >= 0) chat[index] = { ...chat[index], mes: record.composed };
        else chat.push({ is_user: true, is_system: false, name: getContext()?.name1 || 'User', mes: record.composed });
        coreRecords.set(chat, record);
        pending = { type: record.type, record };
        publish('prepared', '已组合 · 等待发送前核对', '已在生成副本中附带；下面是本轮组合预览。', record.composed);
    }

    function verifyChat(data) {
        if (!pending || !data || handledRequests.has(data) || data.dryRun
            || !Object.hasOwn(data, 'type') || !supportedTypes.has(normalType(data.type))
            || normalType(data.type) !== pending.type) return { ...report };
        if (!Array.isArray(data.messages)) return publish('error', '未附带 · 请求格式无法识别', '本轮没有读取到用户消息列表。');
        let record = pending.record;
        if (!record) {
            const latest = getContext()?.chat?.findLast(message => message?.is_user && !message.is_system);
            try { record = makeRecord(String(latest?.mes ?? ''), data.type); }
            catch { return publish('error', '未附带 · 提示词宏处理失败', '本轮没有完成提示词组合。'); }
            if (!record) { pending = null; return { ...report }; }
            pending.record = record;
        }
        // Match only the current user message. Identical text in history/system/assistant
        // messages is never proof that this message carries the attachment.
        const composed = normalize(record.composed);
        // Locate the newest occurrence of the base first. An older, identical turn
        // carrying the attachment must never hide a newer turn that lost it.
        const needle = record.base.trim() ? normalize(record.base) : composed;
        let index = data.messages.findLastIndex(message => message?.role === 'user'
            && normalize(messageText(message)).includes(needle));
        if (index < 0 && record.base.trim()) {
            return publish('error', '未附带 · 本次用户消息未找到',
                '本次用户消息可能被其他扩展移除或改写，不能把历史里相同的提示词当成本次已附带。');
        }
        try {
            const messages = [...data.messages];
            if (index < 0) {
                // First-message regeneration / no user history: create a request-only user entry.
                index = messages.length;
                if (messages.at(-1)?.role === 'assistant') index--;
                messages.splice(index, 0, { role: 'user', content: record.composed });
            } else if (!normalize(messageText(messages[index])).includes(normalize(record.block))) {
                const target = messages[index];
                if (typeof target.content === 'string') {
                    messages[index] = { ...target, content: target.content + record.block };
                } else if (Array.isArray(target.content)) {
                    messages[index] = { ...target, content: [...target.content, { type: 'text', text: record.block }] };
                } else {
                    return publish('error', '未附带 · 用户消息格式无法识别', '没有更改其他消息或媒体附件。');
                }
            }
            data.messages = messages;
            handledRequests.add(data);
            pending = null;
            return publish('attached', '已附带 · 本次用户消息已包含固定提示词',
                '下面是待发送请求中这条用户消息的文字。图片、音频等附件保留在原请求中；预览和复制仅包含文字。', messageText(messages[index]));
        } catch {
            return publish('error', '未附带 · 请求无法修改', '本次请求为只读，未能附带固定提示词。');
        }
    }
    function verifyText(data, dryRun = false) {
        if (dryRun || !pending?.record || getContext()?.mainApi === 'openai') return;
        const prompt = typeof data?.prompt === 'string' ? data.prompt : data?.input;
        if (typeof prompt !== 'string') return;
        const record = pending.record;
        // No type is supplied by this event. A nested quiet request cannot satisfy this
        // check unless it contains this generation's complete composed user message.
        if (!normalize(prompt).includes(normalize(record.composed))) return;
        pending = null;
        publish('attached', '已附带 · 生成内容已包含本次组合消息',
            '已在待发送文本中核对到本次用户消息与固定提示词。下面只预览组合后的用户消息。', record.composed);
    }
    function end(cancel = false) {
        if (cancel) pending = null;
        if (['pending', 'prepared'].includes(report.state)) {
            publish('unverified', '未核验 · 未取得最终发送内容', '尚未取得发送前核对结果，不能据此认定已发送。', report.preview);
        }
    }
    return { begin, intercept, verifyChat, verifyText, reset, changed, end, report: () => ({ ...report }) };
}
