import { createParticlePanel } from './particles.js';

export const PANEL_ID = 'fixed_prompt_extension_panel';
const chevron = direction => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${direction === 'up' ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'}"/></svg>`;

export function mountPanel(controller) {
    const host = document.createElement('div');
    host.id = PANEL_ID;
    const root = host.attachShadow({ mode: 'open' });
    // Static markup only. Saved prompts are always assigned through .value.
    root.innerHTML = `
        <style>:host{position:fixed;pointer-events:none}.viewport{visibility:hidden}</style>
        <link rel="stylesheet" href="${new URL('./style.css', import.meta.url).href}">
        <div id="square-prompt-particles" role="region" aria-label="固定提示词">
            <button class="handle" type="button" aria-label="展开固定提示词" aria-expanded="false" aria-controls="square-prompt-main"></button>
            <div class="viewport" data-visible="false"><div class="stage"><div class="shell">
                <section class="square" id="square-prompt-main" inert aria-hidden="true">
                    <header><h3>固定提示词</h3><button class="collapse" type="button" aria-label="收起插件">${chevron('up')}</button></header>
                    <p class="intro">写一次，每次聊天自动带给 AI。</p>
                    <label class="enabled"><input type="checkbox" data-setting="enabled">启用固定提示词</label>
                    <div class="notice" data-status role="status" aria-live="polite"></div>
                    <div class="editor"><label for="square-prompt-text">固定提示词内容</label><textarea id="square-prompt-text" data-setting="text" placeholder="在这里输入每轮都要给 AI 的提示词……"></textarea></div>
                    <div class="meta"><span>修改后自动保存并生效</span><span data-count>0 字符</span></div>
                    <button class="advanced-toggle" type="button" aria-expanded="false" aria-controls="square-prompt-advanced"><span>高级设置</span><span class="toggle-side"><span class="toggle-label">展开</span>${chevron('down')}</span></button>
                </section>
                <section class="advanced" id="square-prompt-advanced" inert aria-hidden="true"><div class="advanced-inner">
                    <label class="field" for="square-prompt-role">发送身份</label>
                    <select id="square-prompt-role" data-setting="role"><option value="0">系统提示（推荐）</option><option value="1">用户</option><option value="2">助手</option></select>
                    <label class="field depth" for="square-prompt-depth">插入深度</label>
                    <input id="square-prompt-depth" data-setting="depth" type="number" value="0" min="0" max="100" step="1">
                    <p class="help">默认 0，放在最近一条聊天之后。数值越大，位置越靠前；通常保持默认即可。</p>
                    <div class="divider"></div>
                    <p class="help">写一次，每次聊天自动带给 AI。应用于当前酒馆账号的所有聊天；不会作为消息显示在聊天窗口。支持 {{user}} 和 {{char}}。</p>
                    <p class="help">普通发送、重新生成、滑动回复和继续回复都会携带。后台静默任务和 AI 代写用户消息不携带。</p>
                </div></section>
            </div><canvas aria-hidden="true"></canvas></div></div>
        </div>`;
    document.body.append(host);
    const q = selector => root.querySelector(selector);
    const disposers = [];
    function listen(element, type, handler) {
        element.addEventListener(type, handler);
        disposers.push(() => element.removeEventListener(type, handler));
    }

    function renderStatus() {
        const settings = controller.settings();
        const ready = settings.enabled && settings.text.trim().length > 0;
        const status = q('[data-status]');
        status.textContent = !settings.enabled ? '已暂停 · 保留提示词，下次启用即可继续'
            : ready ? '已启用 · 下一次聊天生成将自动携带' : '等待填写 · 输入固定提示词后自动生效';
        status.dataset.active = String(ready);
        q('[data-count]').textContent = `${Array.from(settings.text).length} 字符`;
    }

    function refresh() {
        const settings = controller.settings();
        for (const input of root.querySelectorAll('[data-setting]')) {
            const key = input.dataset.setting;
            if (key === 'enabled') input.checked = settings.enabled;
            else if (input.value !== String(settings[key])) input.value = String(settings[key]);
        }
        renderStatus();
    }

    for (const input of root.querySelectorAll('[data-setting]')) {
        const key = input.dataset.setting;
        listen(input, key === 'text' ? 'input' : 'change', () => {
            controller.update({ [key]: key === 'enabled' ? input.checked : input.value });
            if (key === 'depth') input.value = String(controller.settings().depth);
            renderStatus();
        });
    }

    let layoutFrame = 0;
    let anchor = null;
    const positionObserver = new ResizeObserver(scheduleLayout);
    function layout() {
        layoutFrame = 0;
        const nextAnchor = document.getElementById('chat') || document.getElementById('sheld');
        if (anchor !== nextAnchor) {
            if (anchor) positionObserver.unobserve(anchor);
            anchor = nextAnchor;
            if (anchor) positionObserver.observe(anchor);
        }
        const view = globalThis.visualViewport;
        const x = view?.offsetLeft || 0, y = view?.offsetTop || 0;
        const vw = view?.width || window.innerWidth, vh = view?.height || window.innerHeight;
        const bounds = anchor?.getBoundingClientRect();
        const usable = bounds && bounds.width > 0 && bounds.height > 0;
        const left = usable ? Math.max(x, Math.min(bounds.left, x + vw - 40)) : x;
        const top = usable ? Math.max(y, Math.min(bounds.top, y + vh - 80)) : y + 64;
        const availableWidth = Math.max(1, Math.min(usable ? bounds.right - left : vw, x + vw - left));
        const availableHeight = Math.max(1, Math.min(usable ? bounds.bottom - top : vh - 64, y + vh - top));
        // Preserve the square on phones; scroll the secondary panel on short screens.
        const side = Math.max(1, Math.min(480, availableWidth - 36));
        host.style.left = `${left}px`;
        host.style.top = `${top}px`;
        host.style.width = `${side + 36}px`;
        host.style.setProperty('--fp-available-height', `${availableHeight}px`);
        host.style.setProperty('--fp-handle-top', `${Math.max(0, Math.min(125, availableHeight - 125))}px`);
    }
    function scheduleLayout() {
        if (!layoutFrame) layoutFrame = requestAnimationFrame(layout);
    }
    layout();
    listen(window, 'resize', scheduleLayout);
    // Capturing scroll also tracks a movable/scrolling chat container, without changing it.
    document.addEventListener('scroll', scheduleLayout, true);
    disposers.push(() => document.removeEventListener('scroll', scheduleLayout, true));
    if (globalThis.visualViewport) {
        listen(globalThis.visualViewport, 'resize', scheduleLayout);
        listen(globalThis.visualViewport, 'scroll', scheduleLayout);
    }
    const animation = createParticlePanel(root);
    const settingsHost = document.querySelector('#extensions_settings2') || document.querySelector('#extensions_settings');
    const shortcut = document.createElement('div');
    shortcut.id = 'fixed_prompt_extension_shortcut';
    shortcut.innerHTML = '<b>固定提示词</b><p>点击聊天正文左侧的金色长条，展开提示词面板。</p>';
    settingsHost?.append(shortcut);
    refresh();

    return { refresh() { refresh(); scheduleLayout(); }, open: animation.open, destroy() {
        animation.destroy();
        positionObserver.disconnect();
        cancelAnimationFrame(layoutFrame);
        disposers.forEach(dispose => dispose());
        shortcut.remove();
        host.remove();
    } };
}
