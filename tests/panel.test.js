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

function fixture({ reduced = false, canvasAvailable = true, saved } = {}) {
    const { window, document } = parseHTML('<html><body><div id="extensions_settings2"></div><main id="chat"><p>示例聊天</p></main></body></html>');
    let now = 0, frameId = 0, drawCount = 0, saves = 0;
    const frames = new Map(), observers = new Set();
    const bounds = { left: 200, top: 80, right: 1100, bottom: 880, width: 900, height: 800 };
    const media = new window.EventTarget();
    media.matches = reduced;
    const drawing = {
        setTransform() {}, clearRect() {}, save() {}, restore() {}, beginPath() {},
        moveTo() {}, lineTo() {}, stroke() {},
        createLinearGradient() { return { addColorStop() {} }; },
        fillRect() { drawCount++; },
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
    window.HTMLCanvasElement.prototype.getContext = () => canvasAvailable ? drawing : null;
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
        if (element.classList.contains('square')) return { left: bounds.left + 24, top: bounds.top + 16, width: side, height: side };
        if (element.classList.contains('advanced')) return { left: bounds.left + 24, top: bounds.top + 16 + side, width: side, height: adv };
        if (element.classList.contains('advanced-inner')) return { left: 0, top: 0, width: side, height: 360 };
        return { left: 0, top: 0, width: 0, height: 0 };
    }
    window.HTMLElement.prototype.getBoundingClientRect = function () { return size(this); };
    for (const [property, axis] of [['clientWidth', 'width'], ['clientHeight', 'height'], ['offsetHeight', 'height']]) {
        Object.defineProperty(window.HTMLElement.prototype, property, { configurable: true, get() { return size(this)[axis]; } });
    }
    const context = {
        extensionSettings: { [SETTINGS_KEY]: saved ?? { text: '原来保存的 {{char}} 规则', enabled: true, depth: 3, role: 1 } },
        extensionPrompts: { unrelated: { value: 'keep' } },
        eventTypes: { GENERATION_AFTER_COMMANDS: 'generate', CHAT_CHANGED: 'chat' },
        eventSource: new EventEmitter(),
        setExtensionPrompt(key, value, position, depth, scan, role) {
            this.extensionPrompts[key] = { value, position, depth, scan, role };
        },
        saveSettingsDebounced() { saves++; },
    };
    globalThis.SillyTavern = { getContext: () => context };
    plugin.init();
    const host = document.getElementById('fixed_prompt_extension_panel');
    const root = host.shadowRoot;
    const q = selector => root.querySelector(selector);
    return { context, document, window, host, root, q, bounds, media, frames, observers,
        get draws() { return drawCount; }, get saves() { return saves; },
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
    assert.equal(env.q('[data-setting="role"]').value, '1');
    assert.equal(env.q('[data-setting="depth"]').value, '3');
    assert.equal(env.saves, 0);
    assert.equal(env.q('.viewport').dataset.visible, 'false');
    assert.equal(env.q('.square').inert, true);
    assert.equal(env.q('.advanced').inert, true);
    assert.equal(env.q('.advanced').style.height, '');
    assert.equal(env.q('.advanced-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(env.host.style.left, '200px');
    assert.equal(env.context.extensionPrompts[PROMPT_KEY].value, '原来保存的 {{char}} 规则');
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

test('advanced opens downwards for 3.5 seconds and closes in 0.9 seconds', () => {
    env.click('.handle'); env.advance(4500); env.click('.advanced-toggle');
    env.advance(1750);
    assert.ok(Math.abs(parseFloat(env.q('.advanced').style.height) - 180) < 1);
    assert.equal(env.q('.advanced').inert, true);
    env.advance(1750);
    assert.equal(env.q('.advanced').style.height, '360px');
    assert.equal(env.q('.advanced').inert, false);
    assert.equal(env.q('.toggle-label').textContent, '收起');
    env.click('.advanced-toggle'); env.advance(450);
    assert.ok(Math.abs(parseFloat(env.q('.advanced').style.height) - 180) < 1);
    env.advance(450);
    assert.equal(env.q('.advanced').style.height, '0px');
    assert.equal(env.q('.advanced').inert, true);
});

test('closing midway cancels particles; reopening resets advanced but keeps saved text', () => {
    env.click('.handle'); env.advance(1500); env.click('.handle');
    assert.equal(env.frames.size, 0);
    assert.equal(env.q('.viewport').dataset.visible, 'false');
    env.click('.handle'); env.advance(4500); env.click('.advanced-toggle'); env.advance(1000);
    env.click('.advanced-toggle'); env.advance(900);
    assert.equal(env.q('.advanced').style.height, '0px');
    env.click('.advanced-toggle'); env.advance(3500); env.click('.collapse');
    env.click('.handle'); env.advance(4500);
    assert.equal(env.q('.advanced-toggle').getAttribute('aria-expanded'), 'false');
    assert.equal(env.q('[data-setting="text"]').value, '原来保存的 {{char}} 规则');
    assert.equal(env.saves, 0);
});

test('real controls save text literally and update prompt injection including all three roles', () => {
    const text = '<img src=x onerror=alert(1)>✨\n{{user}}';
    env.change('text', text);
    assert.equal(env.q('[data-count]').textContent, `${Array.from(text).length} 字符`);
    assert.equal(env.root.querySelector('img'), null);
    assert.equal(env.context.extensionSettings[SETTINGS_KEY].text, text);
    for (const role of [0, 1, 2]) {
        env.change('role', String(role));
        assert.equal(env.context.extensionPrompts[PROMPT_KEY].role, role);
    }
    env.change('depth', '900');
    assert.equal(env.q('[data-setting="depth"]').value, '100');
    assert.equal(env.context.extensionPrompts[PROMPT_KEY].depth, 100);
    env.change('enabled', false);
    assert.equal(env.context.extensionPrompts[PROMPT_KEY].value, '');
    assert.equal(env.context.extensionSettings[SETTINGS_KEY].text, text);
    env.change('enabled', true);
    assert.equal(env.context.extensionPrompts[PROMPT_KEY].value, text);
    assert.equal(env.saves, 7);
});

test('generation and chat changes still use live saved settings through the original hooks', () => {
    env.context.eventSource.emit('generate', 'quiet');
    assert.equal(env.context.extensionPrompts[PROMPT_KEY].value, '');
    env.change('text', '在后台任务期间修改');
    assert.equal(env.context.extensionPrompts[PROMPT_KEY].value, '');
    globalThis.sillytavernFixedPromptInterceptor([], 0, null, 'swipe');
    assert.equal(env.context.extensionPrompts[PROMPT_KEY].value, '在后台任务期间修改');
    env.context.extensionSettings[SETTINGS_KEY] = { text: '切换后的规则', enabled: false, role: 2, depth: 2 };
    env.context.eventSource.emit('chat');
    assert.equal(env.q('[data-setting="text"]').value, '切换后的规则');
    assert.equal(env.q('[data-setting="role"]').value, '2');
    assert.equal(env.context.extensionPrompts[PROMPT_KEY].value, '');
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
    assert.equal(globalThis.sillytavernFixedPromptInterceptor, undefined);
    assert.equal(env.context.extensionPrompts[PROMPT_KEY], undefined);
    assert.equal(env.context.extensionPrompts.unrelated.value, 'keep');
    plugin.init();
    assert.equal(env.context.extensionPrompts[PROMPT_KEY].value, '重启后保留');
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
