import { createController } from './core.js';

const PANEL_ID = 'fixed_prompt_extension_panel';
const INTERCEPTOR = 'sillytavernFixedPromptInterceptor';
const context = () => globalThis.SillyTavern?.getContext?.();
const controller = createController(context);
let initialized = false;
let listeners = [];

function renderStatus() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const settings = controller.settings();
    const ready = settings.enabled && settings.text.trim().length > 0;
    const status = panel.querySelector('[data-status]');
    status.textContent = !settings.enabled
        ? '已暂停 · 保留提示词，下次启用即可继续'
        : ready ? '已启用 · 下一次聊天生成将自动携带' : '等待填写 · 输入固定提示词后自动生效';
    status.dataset.active = String(ready);
    panel.querySelector('[data-count]').textContent = `${Array.from(settings.text).length} 字符`;
}

function refreshPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel) return;
    const settings = controller.settings();
    panel.querySelector('[data-setting="enabled"]').checked = settings.enabled;
    panel.querySelector('[data-setting="text"]').value = settings.text;
    panel.querySelector('[data-setting="depth"]').value = String(settings.depth);
    panel.querySelector('[data-setting="role"]').value = String(settings.role);
    renderStatus();
}

function mountPanel() {
    if (document.getElementById(PANEL_ID)) return;
    const host = document.querySelector('#extensions_settings2')
        || document.querySelector('#extensions_settings');
    if (!host) throw new Error('未找到酒馆扩展设置面板。请刷新页面后重试。');
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    // Only static UI is HTML. User-supplied prompts are assigned with .value.
    panel.innerHTML = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>固定提示词</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <p class="fp-description">写一次，每次聊天自动带给 AI。</p>
                <label class="checkbox_label fp-enabled">
                    <input type="checkbox" data-setting="enabled">
                    <span>启用固定提示词</span>
                </label>
                <p class="fp-status" data-status role="status" aria-live="polite"></p>
                <label for="fp-extension-text">固定提示词内容</label>
                <textarea id="fp-extension-text" class="text_pole" data-setting="text"
                    rows="10" placeholder="在这里输入每轮都要给 AI 的提示词……"></textarea>
                <div class="fp-meta"><span>修改后自动保存并生效</span><span data-count></span></div>
                <p class="fp-hint">应用于当前酒馆账号的所有聊天；不会作为消息显示在聊天窗口。支持 {{user}} 和 {{char}}。</p>
                <details class="fp-advanced">
                    <summary>高级设置</summary>
                    <label for="fp-extension-role">发送身份</label>
                    <select id="fp-extension-role" class="text_pole" data-setting="role">
                        <option value="0">系统提示（推荐）</option>
                        <option value="1">用户提示</option>
                    </select>
                    <label for="fp-extension-depth">插入深度</label>
                    <input id="fp-extension-depth" type="number" class="text_pole"
                        data-setting="depth" min="0" max="100" step="1">
                    <p class="fp-hint">默认 0，放在最近一条聊天之后。数值越大，位置越靠前；通常保持默认即可。</p>
                    <p class="fp-hint">普通发送、重新生成、滑动回复和继续回复都会携带。后台静默任务和 AI 代写用户消息不携带。</p>
                </details>
            </div>
        </div>`;
    host.append(panel);
    for (const input of panel.querySelectorAll('[data-setting]')) {
        const event = input.dataset.setting === 'text' ? 'input' : 'change';
        input.addEventListener(event, () => {
            const key = input.dataset.setting;
            const value = key === 'enabled' ? input.checked : input.value;
            controller.update({ [key]: value });
            if (key === 'depth') input.value = String(controller.settings().depth);
            renderStatus();
        });
    }
    refreshPanel();
}

function subscribe(ctx, key, handler) {
    const name = ctx.eventTypes[key];
    if (!name) return;
    ctx.eventSource.on(name, handler);
    listeners.push({ source: ctx.eventSource, name, handler });
}

export function init() {
    if (initialized) return;
    const ctx = context();
    if (!ctx?.extensionSettings || !ctx?.setExtensionPrompt || !ctx?.saveSettingsDebounced
        || !ctx?.eventSource || !ctx?.eventTypes) {
        throw new Error('固定提示词：无法读取酒馆扩展接口，请更新酒馆后重试。');
    }
    mountPanel();
    // The event covers prompt previews too; the interceptor refreshes before assembly.
    subscribe(ctx, 'GENERATION_AFTER_COMMANDS', (type) => controller.sync(type));
    subscribe(ctx, 'CHAT_CHANGED', () => {
        controller.sync('normal');
        refreshPanel();
    });
    globalThis[INTERCEPTOR] = (_chat, _contextSize, _abort, type) => controller.sync(type);
    controller.sync('normal');
    initialized = true;
}

export function cleanup() {
    for (const { source, name, handler } of listeners) source.removeListener(name, handler);
    listeners = [];
    controller.clear();
    delete globalThis[INTERCEPTOR];
    document.getElementById(PANEL_ID)?.remove();
    initialized = false;
}

function start() {
    try {
        init();
    } catch (error) {
        console.error('[固定提示词]', error);
        globalThis.toastr?.error?.(error.message, '固定提示词');
    }
}

// Also supports releases that do not invoke manifest lifecycle hooks.
if (typeof globalThis.jQuery === 'function') globalThis.jQuery(start);
else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
