import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseHTML } from 'linkedom';
import { SETTINGS_KEY, PROMPT_KEY } from '../core.js';

// Exercise the real extension and event handlers with a deterministic animation clock.
// Geometry is a fixture, not a browser rendering/screenshot assertion.
globalThis.jQuery = () => {};
const plugin = await import('../index.js');
let env;

function fixture({ reduced = false, canvasAvailable = true, canvasThrows = false, maskThrows = false, rectScale = 1, saved } = {}) {
    const { window, document } = parseHTML('<html><body><div id="extensions_settings2"></div><main id="chat"><p>示例聊天</p></main></body></html>');
    let now = 0, frameId = 0, drawCount = 0, saves = 0, maskFrames = 0, latestMask = null;
    const canvasImages = new WeakMap(), canvasContexts = new WeakMap();
    let failDraw = false;
    const clearCalls = [], lines = [];
    const frames = new Map(), observers = new Set();
    const bounds = { left: 200, top: 80, right: 1100, bottom: 880, width: 900, height: 800 };
    const media = new window.EventTarget();
    media.matches = reduced;
    const drawing = {
        setTransform(...args) { this.transform = args; },
        clearRect(...args) { clearCalls.push({ args, transform: this.transform?.slice() }); },
        save() {}, restore() {}, beginPath() {},
        moveTo(x, y) { lines.push([x, y]); }, lineTo() {}, stroke() {}, drawImage() {}, translate() {}, rotate() {},
        createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
        createLinearGradient() { return { addColorStop() {} }; },
        fillRect() { if (failDraw) throw new Error('Drawing interrupted'); drawCount++; },
    };
    Object.assign(globalThis, { window, document, devicePixelRatio: 2,
        matchMedia: () => media,
        requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
        cancelAnimationFrame(id) { frames.delete(id); },
        ResizeObserver: class {
            targets = new Set();
            constructor(callback) { this.callback = callback; observers.add(this); }
            observe(element) { this.targets.add(element); }
            unobserve(element) { this.targets.delete(element); }
            disconnect() { this.targets.clear(); observers.delete(this); }
        },
    });
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
    window.innerWidth = 1280;
    window.innerHeight = 960;
    window.HTMLCanvasElement.prototype.getContext = function () {
        if (canvasThrows) throw new Error('Canvas blocked');
        const canvas = this;
        if (!canvasAvailable) return null;
        if (!canvasContexts.has(canvas)) canvasContexts.set(canvas, { ...drawing, putImageData(data) { canvasImages.set(canvas, data); } });
        return canvasContexts.get(canvas);
    };
    window.HTMLCanvasElement.prototype.toDataURL = function () {
        if (maskThrows) throw new Error('Canvas export blocked');
        maskFrames++;
        const data = canvasImages.get(this).data;
        let transparent = 0, opaque = 0;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] === 0) transparent++;
            if (data[i] === 255) opaque++;
        }
        latestMask = { transparent, opaque, pixels: data.length / 4, width: this.width, height: this.height };
        return 'data:image/png;base64,mock' + maskFrames;
    };
    // linkedom does not implement these browser properties.
    Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
        configurable: true,
        get() { return this.querySelector('option[selected]')?.value ?? this.querySelector('option')?.value ?? ''; },
        set(value) { for (const option of this.querySelectorAll('option')) option.toggleAttribute('selected', option.value === String(value)); },
    });
    Object.defineProperty(window.HTMLElement.prototype, 'inert', {
        configurable: true, get() { return this.hasAttribute('inert'); },
        set(value) { this.toggleAttribute('inert', !!value); },
    });
    function size(element) {
        const host = document.getElementById('fixed_prompt_extension_panel');
        const side = (parseFloat(host?.style.width) || 516) - 36;
        const adv = parseFloat(host?.shadowRoot.querySelector('.advanced')?.style.height) || 0;
        if (element.id === 'chat') return { ...bounds };
        if (element.classList.contains('stage')) return { left: bounds.left, top: bounds.top, width: side + 36, height: side + adv + 32 };
        if (element.classList.contains('shell')) return { left: bounds.left + 24, top: bounds.top + 16, width: side, height: side + adv };
        if (element.classList.contains('square')) return { left: bounds.left + 24, top: bounds.top + 16, width: side, height: side };
        if (element.classList.contains('advanced')) return { left: bounds.left + 24, top: bounds.top + 16 + side, width: side, height: adv };
        if (element.classList.contains('advanced-inner')) return { left: 0, top: 0, width: side, height: 360 };
        return { left: 0, top: 0, width: 0, height: 0 };
    }
    window.HTMLElement.prototype.getBoundingClientRect = function () {
        const result = size(this);
        if (this.id === 'chat') return result;
        return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, value * rectScale]));
    };
    for (const [property, axis] of [['clientWidth', 'width'], ['clientHeight', 'height'], ['offsetHeight', 'height']]) {
        Object.defineProperty(window.HTMLElement.prototype, property, { configurable: true, get() { return size(this)[axis]; } });
    }
    const context = {
        extensionSettings: { [SETTINGS_KEY]: saved ?? { text: '原来保存的 {{char}} 规则', enabled: true, depth: 3, role: 1 } },
        extensionPrompts: { unrelated: { value: 'keep' }, [PROMPT_KEY]: { value: 'old injection' } },
        chat: [{ is_user: true, is_system: false, mes: '带我去城门。' }],
        mainApi: 'openai', name1: '旅人', name2: '向导',
        eventTypes: { GENERATION_AFTER_COMMANDS: 'generate', CHAT_CHANGED: 'chat',
            CHAT_COMPLETION_SETTINGS_READY: 'request', GENERATE_AFTER_DATA: 'data',
            GENERATION_ENDED: 'ended', GENERATION_STOPPED: 'stopped' },
        eventSource: new EventEmitter(),
        setExtensionPrompt(key, value, position, depth, scan, role) {
            this.extensionPrompts[key] = { value, position, depth, scan, role };
        },
        saveSettingsDebounced() { saves++; },
    };
    context.eventSource.makeLast = function (name, handler) {
        this.removeListener(name, handler);
        this.on(name, handler);
    };
    globalThis.SillyTavern = { getContext: () => context };
    plugin.init();
    const host = document.getElementById('fixed_prompt_extension_panel');
    const root = host.shadowRoot;
    const q = selector => root.querySelector(selector);
    return { context, document, window, host, root, q, bounds, media, frames, observers, clearCalls, lines,
        failNextDraw() { failDraw = true; },
        get draws() { return drawCount; }, get saves() { return saves; },
        get maskFrames() { return maskFrames; }, get mask() { return latestMask; },
        click(selector) { q(selector).click(); },
        change(key, value) {
            const input = q(`[data-setting="${key}"]`);
            if (key === 'enabled') input.checked = value;
            else input.value = value;
            input.dispatchEvent(new window.Event(key === 'text' ? 'input' : 'change'));
        },
        advance(ms) {
            const target = now + ms;
            while (now < target) {
                now = Math.min(target, now + 1000 / 60);
                const callbacks = [...frames.values()];
                frames.clear();
                callbacks.forEach(callback => callback(now));
            }
        },
    };
}

beforeEach(() => { env = fixture(); });
afterEach(() => { plugin.cleanup(); });

test('upgrade restores existing settings without writing them; initial panel and advanced are closed', () => {
    assert.equal(env.q('[data-setting="text"]').value, '原来保存的 {{char}} 规则');
    assert.equal(env.q('[data-setting="role"]'), null);
    assert.equal(env.q('[data-setting="depth"]'), null);
    assert.equal(env.context.extensionSettings[SETTINGS_KEY].role, 1);
    assert.equal(env.context.extensionSettings[SETTINGS_KEY].depth, 3);
    assert.equal(env.q('[data-copy]').disabled, true);
    assert.equal(env.saves, 0);
    assert.equal(env.q('.viewport').dataset.visible, 'false');
    assert.equal(env.q('.square').inert, true);
    assert.equal(env.q('.advanced').inert, true);
    assert.equal(env.q('.advanced').style.height, '');
    assert.equal(env.q('.advanced-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(env.host.style.left, '200px');
    assert.equal(env.context.extensionPrompts[PROMPT_KEY], undefined);
});

test('main opens for 4.5 seconds with particles and releases its animation loop at rest', () => {
    env.click('.handle');
    env.advance(2250);
    assert.equal(env.q('.square').inert, true);
    assert.match(env.q('.square').style.clipPath, /^inset/);
    assert.ok(env.draws > 0);
    env.advance(2240);
    assert.equal(env.q('.square').inert, true);
    env.advance(20);
    assert.equal(env.q('.square').inert, false);
    assert.equal(env.q('.square').style.clipPath, 'none');
    assert.equal(env.q('.advanced').getAttribute('aria-hidden'), 'true');
    env.advance(2000);
    assert.equal(env.frames.size, 0);
});

test('particle canvas is hidden at every idle state, including reopening and advanced collapse', () => {
    const canvas = env.q('canvas');
    assert.equal(canvas.style.visibility, 'hidden');
    for (let cycle = 0; cycle < 2; cycle++) {
        env.click('.handle'); env.advance(500);
        assert.equal(canvas.style.visibility, 'visible');
        env.advance(6000);
        assert.equal(canvas.style.visibility, 'hidden');
        env.click('.advanced-toggle'); env.advance(5500);
        assert.equal(canvas.style.visibility, 'hidden');
        env.click('.advanced-toggle'); env.advance(5000);
        assert.equal(canvas.style.visibility, 'hidden');
        env.click('.collapse'); env.advance(5500);
        assert.equal(canvas.style.visibility, 'hidden');
        assert.equal(env.q('.viewport').dataset.visible, 'false');
        assert.equal(env.frames.size, 0);
    }
});

test('each frame clears the entire high-DPI bitmap even if its prior transform changed', () => {
    env.click('.handle'); env.advance(500);
    const canvas = env.q('canvas'), ctx = canvas.getContext('2d');
    ctx.setTransform(.5, 0, 0, .5, 100, 50);
    env.clearCalls.length = 0;
    env.advance(17);
    for (const clear of env.clearCalls) {
        assert.deepEqual(clear.transform, [1, 0, 0, 1, 0, 0]);
        assert.deepEqual(clear.args, [0, 0, canvas.width, canvas.height]);
    }
    assert.ok(env.clearCalls.length > 0);
    assert.deepEqual(ctx.transform, [2, 0, 0, 2, 0, 0]);
});

test('scaled panel geometry keeps the gold edge aligned with the local reveal boundary', () => {
    env.click('.handle'); env.advance(2250);
    const expectedLine = env.lines.at(-1), expectedClip = env.q('.square').style.clipPath;
    for (const rectScale of [.5, 1.25, 2]) {
        plugin.cleanup(); env = fixture({ rectScale });
        env.click('.handle'); env.advance(2250);
        assert.deepEqual(env.lines.at(-1), expectedLine);
        assert.equal(env.q('.square').style.clipPath, expectedClip);
    }
});

test('an interrupted opening frame clears the overlay and leaves settings and delivery usable', () => {
    env.click('.handle'); env.advance(500);
    env.failNextDraw();
    assert.doesNotThrow(() => env.advance(50));
    assert.equal(env.q('canvas').style.visibility, 'hidden');
    assert.equal(env.q('.square').style.clipPath, 'none');
    assert.equal(env.q('.square').inert, false);
    assert.equal(env.frames.size, 0);
    env.change('text', '绘图失败后仍发送。');
    env.context.eventSource.emit('generate', 'normal', {}, false);
    const chat = [...env.context.chat];
    globalThis.sillytavernFixedPromptInterceptor(chat, 8192, () => {}, 'normal');
    assert.match(chat.at(-1).mes, /绘图失败后仍发送。/);
    env.click('.collapse');
    assert.equal(env.q('.viewport').dataset.visible, 'false');
    env.click('.handle');
    assert.equal(env.q('.square').inert, false);
    assert.equal(env.q('canvas').style.visibility, 'hidden');
});

test('drawing failure during advanced opening or whole-panel closing leaves no frozen layer', () => {
    for (const transition of ['advanced', 'closing']) {
        plugin.cleanup(); env = fixture();
        env.click('.handle'); env.advance(6500);
        env.click(transition === 'advanced' ? '.advanced-toggle' : '.collapse');
        env.failNextDraw();
        assert.doesNotThrow(() => env.advance(2000));
        assert.equal(env.q('canvas').style.visibility, 'hidden');
        assert.equal(env.frames.size, 0);
        assert.equal(env.q('.shell').style.getPropertyValue('mask-image') || '', '');
        assert.equal(env.q('.viewport').dataset.visible, transition === 'advanced' ? 'true' : 'false');
        if (transition === 'advanced') assert.equal(env.q('.advanced').inert, false);
    }
});

test('advanced opens for 3.5 seconds then dissolves in the reference 2.87 seconds', () => {
    env.click('.handle'); env.advance(4500); env.click('.advanced-toggle');
    env.advance(1750);
    assert.ok(Math.abs(parseFloat(env.q('.advanced').style.height) - 180) < 1);
    assert.equal(env.q('.advanced').inert, true);
    env.advance(1750);
    assert.equal(env.q('.advanced').style.height, '360px');
    assert.equal(env.q('.advanced').inert, false);
    assert.equal(env.q('.toggle-label').textContent, '收起');
    env.click('.advanced-toggle'); env.advance(1400);
    assert.equal(env.q('.advanced').style.height, '360px');
    assert.equal(env.q('.advanced').inert, true);
    assert.match(env.q('.advanced').style.getPropertyValue('mask-image'), /data:image\/png/);
    assert.ok(env.mask.transparent > 0 && env.mask.opaque > 0);
    assert.equal(env.q('.shell').style.getPropertyValue('mask-image') || '', '');
    env.advance(1460);
    assert.equal(env.q('.advanced').style.height, '360px');
    env.advance(20);
    assert.equal(env.q('.advanced').style.height, '0px');
    assert.equal(env.q('.advanced').inert, true);
    assert.equal(env.q('.advanced').style.getPropertyValue('mask-image') || '', '');
    assert.equal(env.q('.square').inert, false);
    env.advance(2000);
    assert.equal(env.frames.size, 0);
});

test('opening can be cancelled; repeated clicks cannot restart closing; saved text survives', () => {
    env.click('.handle'); env.advance(1500); env.click('.handle');
    assert.equal(env.frames.size, 0);
    assert.equal(env.q('.viewport').dataset.visible, 'false');
    env.click('.handle'); env.advance(4500); env.click('.advanced-toggle'); env.advance(3500);
    env.click('.collapse'); env.advance(1700);
    assert.equal(env.q('.square').inert, true);
    assert.equal(env.q('.advanced').style.height, '360px');
    assert.match(env.q('.shell').style.getPropertyValue('mask-image'), /data:image\/png/);
    assert.ok(env.mask.height > env.mask.width);
    assert.ok(env.mask.transparent > 0 && env.mask.opaque > 0);
    env.click('.handle'); env.click('.collapse'); env.click('.advanced-toggle');
    env.advance(1790);
    assert.equal(env.q('.handle').getAttribute('aria-expanded'), 'true');
    env.advance(20);
    assert.equal(env.q('.handle').getAttribute('aria-expanded'), 'false');
    assert.equal(env.q('.shell').style.getPropertyValue('mask-image') || '', '');
    env.advance(2000);
    assert.equal(env.q('.viewport').dataset.visible, 'false');
    assert.equal(env.frames.size, 0);
    env.click('.handle'); env.advance(4500);
    assert.equal(env.q('.advanced-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(env.q('[data-setting="text"]').value, '原来保存的 {{char}} 规则');
    assert.equal(env.saves, 0);
});

test('closing while advanced is still opening dissolves the currently visible whole panel', () => {
    env.click('.handle'); env.advance(4500); env.click('.advanced-toggle'); env.advance(1000);
    const visibleHeight = env.q('.advanced').style.height;
    env.click('.collapse'); env.advance(1750);
    assert.equal(env.q('.advanced').style.height, visibleHeight);
    assert.ok(env.maskFrames > 0);
    env.advance(1750);
    assert.equal(env.q('.handle').getAttribute('aria-expanded'), 'false');
    assert.equal(env.q('.advanced').style.height, '0px');
    assert.equal(env.context.extensionSettings[SETTINGS_KEY].enabled, true);
});

test('resizing during dissolution keeps the mask scaled and releases it on completion', () => {
    env.click('.handle'); env.advance(4500); env.click('.collapse'); env.advance(1000);
    Object.assign(env.bounds, { left: 0, width: 390, right: 390 });
    env.window.innerWidth = 390;
    env.window.dispatchEvent(new env.window.Event('resize'));
    env.advance(1000);
    assert.equal(env.q('.shell').style.getPropertyValue('mask-size'), '100% 100%');
    assert.equal(env.host.style.width, '390px');
    env.advance(1500);
    assert.equal(env.q('.handle').getAttribute('aria-expanded'), 'false');
    assert.equal(env.q('.shell').style.getPropertyValue('-webkit-mask-image') || '', '');
});

test('cleanup midway through dissolution removes masks and all scheduled frames', () => {
    env.click('.handle'); env.advance(4500); env.click('.collapse'); env.advance(1000);
    const shell = env.q('.shell');
    assert.ok(env.maskFrames > 0);
    plugin.cleanup();
    assert.equal(shell.style.getPropertyValue('mask-image') || '', '');
    assert.equal(shell.style.getPropertyValue('-webkit-mask-image') || '', '');
    assert.equal(env.frames.size, 0);
    assert.equal(env.observers.size, 0);
    assert.equal(env.document.getElementById('fixed_prompt_extension_panel'), null);
});

test('reduced-motion change finishes an active main or advanced dissolution immediately', () => {
    for (const part of ['main', 'advanced']) {
        plugin.cleanup();
        env = fixture();
        env.click('.handle'); env.advance(4500);
        if (part === 'advanced') { env.click('.advanced-toggle'); env.advance(3500); env.click('.advanced-toggle'); }
        else env.click('.collapse');
        env.advance(700);
        env.media.matches = true;
        env.media.dispatchEvent(new env.window.Event('change'));
        assert.equal(env.frames.size, 0);
        assert.equal(env.q('.shell').style.getPropertyValue('mask-image') || '', '');
        assert.equal(env.q('.advanced').style.getPropertyValue('mask-image') || '', '');
        assert.equal(env.q('.handle').getAttribute('aria-expanded'), String(part === 'advanced'));
        assert.equal(env.q('.advanced').style.height, '0px');
    }
});

test('real controls auto-save literal text; disabling retains it without creating a separate prompt', () => {
    const text = '<img src=x onerror=alert(1)>✨\n{{user}}';
    env.change('text', text);
    assert.equal(env.q('[data-count]').textContent, `${Array.from(text).length} 字符`);
    assert.equal(env.root.querySelector('img'), null);
    assert.equal(env.context.extensionSettings[SETTINGS_KEY].text, text);
    env.change('enabled', false);
    assert.match(env.q('[data-status]').textContent, /已暂停/);
    assert.equal(env.context.extensionSettings[SETTINGS_KEY].text, text);
    env.change('enabled', true);
    assert.equal(env.context.extensionPrompts[PROMPT_KEY], undefined);
    assert.equal(env.context.extensionSettings[SETTINGS_KEY].enabled, true);
    assert.equal(env.saves, 3);
});

test('generation and chat changes still use live saved settings through the original hooks', () => {
    env.context.eventSource.emit('generate', 'quiet');
    assert.equal(env.context.extensionPrompts[PROMPT_KEY], undefined);
    env.change('text', '在后台任务期间修改');
    const copy = [...env.context.chat];
    globalThis.sillytavernFixedPromptInterceptor(copy, 0, null, 'swipe');
    assert.equal(copy[0].mes, '带我去城门。\n\n【固定提示词】\n在后台任务期间修改');
    assert.equal(env.context.chat[0].mes, '带我去城门。');
    env.context.extensionSettings[SETTINGS_KEY] = { text: '切换后的规则', enabled: false, role: 2, depth: 2 };
    env.context.eventSource.emit('chat');
    assert.equal(env.q('[data-setting="text"]').value, '切换后的规则');
    assert.equal(env.context.extensionPrompts[PROMPT_KEY], undefined);
    assert.equal(env.q('[data-preview]').value, '');
});

test('mobile resize follows the chat edge and keeps panel within visible width', () => {
    Object.assign(env.bounds, { left: 0, top: 48, right: 390, width: 390, bottom: 700, height: 652 });
    env.window.innerWidth = 390;
    env.window.innerHeight = 740;
    env.window.dispatchEvent(new env.window.Event('resize'));
    env.advance(20);
    assert.equal(env.host.style.left, '0px');
    assert.equal(env.host.style.top, '48px');
    assert.equal(env.host.style.width, '390px');
    assert.equal(env.host.style.getPropertyValue('--fp-available-height'), '652px');
});

test('cleanup removes all owned events, observers and frames; reinit keeps saved settings', () => {
    env.change('text', '重启后保留');
    env.click('.handle'); env.advance(500);
    plugin.init();
    assert.equal(env.document.querySelectorAll('#fixed_prompt_extension_panel').length, 1);
    assert.equal(env.context.eventSource.listenerCount('chat'), 1);
    plugin.cleanup();
    assert.equal(env.frames.size, 0);
    assert.equal(env.observers.size, 0);
    assert.equal(env.document.getElementById('fixed_prompt_extension_panel'), null);
    assert.equal(env.document.getElementById('fixed_prompt_extension_shortcut'), null);
    assert.equal(env.context.eventSource.listenerCount('chat'), 0);
    assert.equal(env.context.eventSource.listenerCount('generate'), 0);
    assert.equal(env.context.eventSource.listenerCount('request'), 0);
    assert.equal(env.context.eventSource.listenerCount('data'), 0);
    assert.equal(env.context.eventSource.listenerCount('ended'), 0);
    assert.equal(env.context.eventSource.listenerCount('stopped'), 0);
    assert.equal(globalThis.sillytavernFixedPromptInterceptor, undefined);
    assert.equal(env.context.extensionPrompts[PROMPT_KEY], undefined);
    assert.equal(env.context.extensionPrompts.unrelated.value, 'keep');
    plugin.init();
    assert.equal(env.context.extensionPrompts[PROMPT_KEY], undefined);
    assert.equal(env.document.getElementById('fixed_prompt_extension_panel').shadowRoot.querySelector('textarea').value, '重启后保留');
});

test('reduced motion and unavailable canvas keep all controls usable without animation', () => {
    for (const options of [{ reduced: true }, { canvasAvailable: false }]) {
        plugin.cleanup();
        env = fixture(options);
        env.click('.handle');
        assert.equal(env.q('.square').inert, false);
        assert.equal(env.frames.size, 0);
        env.click('.advanced-toggle');
        assert.equal(env.q('.advanced').style.height, '360px');
        assert.equal(env.q('.advanced').inert, false);
        env.click('.collapse');
        assert.equal(env.q('.viewport').dataset.visible, 'false');
    }
});

test('switching reduced motion on while animating completes the active transition', () => {
    env.click('.handle'); env.advance(500);
    env.media.matches = true;
    env.media.dispatchEvent(new env.window.Event('change'));
    assert.equal(env.q('.square').inert, false);
    assert.equal(env.frames.size, 0);
});

test('actual pre-send event attaches to user content and updates the preview after a nested quiet task', () => {
    env.change('text', '请用简体中文回复。');
    const events = env.context.eventSource;
    events.emit('generate', 'normal', {}, false);
    events.emit('generate', 'quiet', {}, false);
    assert.equal(env.context.extensionPrompts[PROMPT_KEY], undefined);
    const quiet = { type: 'quiet', messages: [{ role: 'user', content: '后台测试' }] };
    events.emit('request', quiet);
    events.emit('ended');
    const foreground = { type: 'normal', messages: [{ role: 'user', content: '带我去城门。' }] };
    events.emit('request', foreground);
    assert.equal(quiet.messages.length, 1);
    assert.equal(foreground.messages[0].content, '带我去城门。\n\n【固定提示词】\n请用简体中文回复。');
    assert.match(env.q('[data-status]').textContent, /已附带/);
    assert.match(env.q('[data-check-detail]').textContent, /待发送请求/);
    assert.equal(env.q('[data-preview]').value, foreground.messages[0].content);
    assert.equal(env.q('[data-copy]').disabled, false);
    events.emit('request', foreground);
    assert.equal(foreground.messages.length, 1);
    env.change('text', '新的设置');
    assert.match(env.q('[data-status]').textContent, /下次发送/);
    assert.equal(env.q('[data-preview]').value, '');
    assert.equal(env.q('[data-copy]').disabled, true);
});

test('matching only a system message reports failure, and stopping never claims success', () => {
    env.change('text', '请用简体中文回复。');
    const events = env.context.eventSource;
    events.emit('generate', 'normal', {}, false);
    const request = { type: 'normal', messages: [{ role: 'system', content: '请用简体中文回复。' }] };
    events.emit('request', request);
    assert.match(env.q('[data-status]').textContent, /本次用户消息未找到/);
    assert.equal(request.messages.length, 1);
    events.emit('generate', 'normal', {}, false);
    events.emit('stopped');
    assert.match(env.q('[data-status]').textContent, /未核验/);
    plugin.cleanup();
    const later = { type: 'normal', messages: [] };
    events.emit('request', later);
    assert.equal(later.messages.length, 0);
});

test('verification runs after a later-loaded request editor without duplicate listeners', () => {
    env.change('text', '请用简体中文回复。');
    const events = env.context.eventSource;
    const editor = data => { data.messages = [{ role: 'user', content: '带我去城门。' }]; };
    events.on('request', editor);
    for (let i = 0; i < 2; i++) {
        events.emit('generate', 'normal', {}, false);
        const copy = [...env.context.chat];
        globalThis.sillytavernFixedPromptInterceptor(copy, 8192, () => {}, 'normal');
        const data = { type: 'normal', messages: [{ role: 'user', content: copy[0].mes }] };
        events.emit('request', data);
        assert.equal(data.messages.length, 1);
        assert.equal(data.messages[0].content, '带我去城门。\n\n【固定提示词】\n请用简体中文回复。');
        assert.equal(events.listenerCount('request'), 2);
    }
    plugin.cleanup();
    assert.equal(events.listenerCount('request'), 1);
});

test('copy button copies the exact outgoing preview as text', async () => {
    let copied;
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
        clipboard: { async writeText(text) { copied = text; } },
    } });
    try {
        env.change('text', '<b>请用简体中文回复。</b>');
        const events = env.context.eventSource;
        events.emit('generate', 'normal', {}, false);
        const copy = [...env.context.chat];
        globalThis.sillytavernFixedPromptInterceptor(copy, 8192, null, 'normal');
        const data = { type: 'normal', messages: [{ role: 'user', content: copy[0].mes }] };
        events.emit('request', data);
        env.click('[data-copy]');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(copied, data.messages[0].content);
        assert.equal(env.q('[data-copy-status]').textContent, '已复制');
        assert.equal(env.q('[data-preview]').value, copied);
        assert.equal(env.context.chat[0].mes, '带我去城门。');
    } finally {
        if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
        else delete globalThis.navigator;
    }
});

test('a browser rejecting Canvas does not stop saved settings or prompt delivery', () => {
    plugin.cleanup();
    env = fixture({ canvasThrows: true });
    env.click('.handle');
    assert.equal(env.q('.square').inert, false);
    env.change('text', '新的固定文字');
    const events = env.context.eventSource;
    events.emit('generate', 'normal', {}, false);
    const copy = [...env.context.chat];
    globalThis.sillytavernFixedPromptInterceptor(copy, 8192, null, 'normal');
    const data = { type: 'normal', messages: [{ role: 'user', content: copy[0].mes }] };
    events.emit('request', data);
    assert.equal(data.messages[0].content, '带我去城门。\n\n【固定提示词】\n新的固定文字');
    assert.equal(env.saves, 1);
    env.click('.collapse');
    assert.equal(env.q('.viewport').dataset.visible, 'false');
});

test('mask export failure closes the panel without leaving an inert visible layer', () => {
    plugin.cleanup();
    env = fixture({ maskThrows: true });
    env.click('.handle'); env.advance(4500); env.click('.collapse'); env.advance(30);
    assert.equal(env.q('.viewport').dataset.visible, 'false');
    assert.equal(env.frames.size, 0);
    assert.equal(env.q('.shell').style.getPropertyValue('mask-image') || '', '');
    env.click('.handle'); env.advance(4500);
    assert.equal(env.q('.square').inert, false);
});

test('text completion verification runs after later payload editors', () => {
    env.context.mainApi = 'textgenerationwebui';
    env.change('text', '固定文字');
    const events = env.context.eventSource;
    const editor = data => { data.prompt = 'User: 带我去城门。\nAssistant:'; };
    events.on('data', editor);
    events.emit('generate', 'normal', {}, false);
    const copy = [...env.context.chat];
    globalThis.sillytavernFixedPromptInterceptor(copy, 8192, null, 'normal');
    const data = { prompt: 'User: ' + copy[0].mes + '\nAssistant:' };
    events.emit('data', data, false); events.emit('ended');
    assert.match(env.q('[data-status]').textContent, /未核验/);
    assert.equal(data.prompt, 'User: 带我去城门。\nAssistant:');
    plugin.cleanup();
    assert.equal(events.listenerCount('data'), 1);
});
