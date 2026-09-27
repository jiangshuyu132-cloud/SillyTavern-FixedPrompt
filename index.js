import { createController } from './core.js';
import { mountPanel } from './panel.js';

const INTERCEPTOR = 'sillytavernFixedPromptInterceptor';
const context = () => globalThis.SillyTavern?.getContext?.();
const controller = createController(context);
let initialized = false;
let listeners = [];
let panel = null;

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
    panel = mountPanel(controller);
    // The event covers prompt previews too; the interceptor refreshes before assembly.
    subscribe(ctx, 'GENERATION_AFTER_COMMANDS', (type) => controller.sync(type));
    subscribe(ctx, 'CHAT_CHANGED', () => {
        controller.sync('normal');
        panel?.refresh();
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
    panel?.destroy();
    panel = null;
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
