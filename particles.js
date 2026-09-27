// Animation geometry, timing and colors from the approved particle preview.
import { createDissolve, clearDissolveMask, drawDissolveParticle } from './dissolve.js';

export function createParticlePanel(root) {
    const q = selector => root.querySelector(selector);
    const stage = q('.stage');
    const shell = q('.shell');
    const main = q('.square');
    const adv = q('.advanced');
    const inner = q('.advanced-inner');
    const toggle = q('.advanced-toggle');
    const handle = q('.handle');
    const viewport = q('.viewport');
    const canvas = q('canvas');
    let ctx = null;
    try { ctx = canvas.getContext('2d'); }
    catch { /* Privacy settings may reject Canvas. Keep the panel and delivery usable. */ }
    const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    let drawingFailed = false;
    const reduced = () => !ctx || drawingFailed || motion?.matches;
    let mode = 'closed', advanced = false, raf = 0, start = 0, last = 0;
    let particles = [], width = 0, height = 0, extension = null, burn = null;
    const clamp = x => Math.max(0, Math.min(1, x));
    const ease = x => x * x * (3 - 2 * x);

    function rect(element) {
        const a = element.getBoundingClientRect(), b = stage.getBoundingClientRect();
        // Bounding rects include page/CSS scaling; Canvas uses local layout pixels.
        const sx = b.width ? stage.clientWidth / b.width : 1;
        const sy = b.height ? stage.clientHeight / b.height : 1;
        return { x: (a.left - b.left) * sx, y: (a.top - b.top) * sy, w: a.width * sx, h: a.height * sy };
    }

    function resize() {
        width = stage.clientWidth;
        height = stage.clientHeight;
        const d = Math.min(globalThis.devicePixelRatio || 1, 2);
        if (canvas.width !== Math.round(width * d) || canvas.height !== Math.round(height * d)) {
            canvas.width = Math.round(width * d);
            canvas.height = Math.round(height * d);
        }
        ctx?.setTransform(width ? canvas.width / width : 1, 0, 0, height ? canvas.height / height : 1, 0, 0);
        if (advanced && !extension && !burn) adv.style.height = `${inner.offsetHeight}px`;
    }

    function clearCanvas() {
        // Reset the backing bitmap and drawing state, not just a transformed area.
        // Explicitly hide it at rest so a retained compositor frame cannot overlay chat.
        canvas.style.visibility = 'hidden';
        canvas.width = canvas.width;
    }

    function clearFrame() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(width ? canvas.width / width : 1, 0, 0, height ? canvas.height / height : 1, 0, 0);
    }

    function access() {
        main.inert = mode !== 'open';
        main.setAttribute('aria-hidden', String(main.inert));
        handle.setAttribute('aria-expanded', String(mode !== 'closed'));
        handle.setAttribute('aria-label', mode === 'closed' ? '展开固定提示词' : '粒子消散收起固定提示词');
        handle.title = handle.getAttribute('aria-label');
        viewport.dataset.visible = String(mode !== 'closed' || particles.length > 0);
        adv.inert = mode !== 'open' || !advanced || !!extension || !!burn;
        adv.setAttribute('aria-hidden', String(adv.inert));
        toggle.setAttribute('aria-expanded', String(advanced));
        q('.toggle-label').textContent = advanced ? '收起' : '展开';
        q('.toggle-side svg').style.transform = advanced ? 'rotate(180deg)' : '';
        main.style.borderRadius = advanced ? '9px 9px 0 0' : '9px';
    }

    function emit(x, y, down = false) {
        particles.push({ x, y, vx: down ? (Math.random() - .5) * 38 : 20 + Math.random() * 45,
            vy: down ? 20 + Math.random() * 35 : (Math.random() - .5) * 35,
            age: 0, life: .4 + Math.random() * .7, r: .6 + Math.random() * 1.6 });
    }

    function line(x1, y1, x2, y2, opacity) {
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#dbb36c';
        ctx.strokeStyle = '#efd18f';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.restore();
    }

    function drawFrame(now) {
        const dt = Math.min((now - last) / 1000 || .016, .04);
        last = now;
        resize();
        clearFrame();
        if (mode === 'opening') {
            const t = clamp((now - start) / 4500), g = rect(main);
            const v = ease(clamp(t / .35)), h = ease(clamp((t - .13) / .83));
            const anchor = Math.min(170, g.h / 2), top = anchor * (1 - v);
            const bottom = g.h - (g.h - anchor - 40) * (1 - v);
            main.style.clipPath = `inset(${top}px ${(1 - h) * 100}% ${g.h - bottom}px 0 round 8px)`;
            const x = g.x + g.w * h, y = g.y + top, b = g.y + bottom;
            if (t > .05 && t < .98) {
                for (let i = 0; i < 9; i++) emit(x, y + Math.random() * (b - y));
                line(x, y, x, b, Math.sin(Math.PI * t));
            }
            if (t === 1) {
                mode = 'open';
                main.style.clipPath = 'none';
                access();
            }
        }
        if (extension) {
            const e = extension, t = clamp((now - e.start) / e.duration), p = ease(t);
            const target = advanced ? inner.offsetHeight : 0, value = e.from + (target - e.from) * p;
            adv.style.height = `${value}px`;
            resize();
            const g = rect(adv);
            if (t < .99) {
                const edge = g.y + value - 3, energy = Math.sin(Math.PI * t) ** .6;
                for (let i = 0; i < Math.ceil(25 * energy) + 5; i++) {
                    emit(g.x + 4 + Math.random() * (g.w - 8), edge - 8 - Math.random() * 24, true);
                    const dot = particles[particles.length - 1];
                    dot.vy = advanced ? -12 - Math.random() * 28 : 12 + Math.random() * 25;
                    dot.r = 1 + Math.random() * 2;
                    dot.life = .6 + Math.random() * .85;
                }
                ctx.save();
                ctx.globalAlpha = energy;
                const glow = ctx.createLinearGradient(0, edge - 65, 0, edge + 7);
                glow.addColorStop(0, '#d6ae6200');
                glow.addColorStop(.75, '#d6ae6220');
                glow.addColorStop(.94, '#e3bd7860');
                glow.addColorStop(1, '#d6ae6200');
                ctx.fillStyle = glow;
                ctx.fillRect(g.x, Math.max(g.y, edge - 65), g.w, Math.min(value, 72));
                for (let x = g.x + 4; x < g.x + g.w - 4; x += 7) {
                    const noise = (Math.sin(x * 12.9 + now * .025) + 1) / 2;
                    ctx.fillStyle = '#171717';
                    ctx.fillRect(x, Math.max(g.y, edge - noise * 23), 5, noise * 23);
                    if (noise > .63) {
                        ctx.fillStyle = '#efce89';
                        ctx.fillRect(x, edge - noise * 27, 2, 2);
                    }
                }
                ctx.restore();
                line(g.x + 2, edge, g.x + g.w - 2, edge, energy);
                line(g.x + 2, g.y, g.x + 2, edge, energy * .4);
                line(g.x + g.w - 2, g.y, g.x + g.w - 2, edge, energy * .4);
            }
            if (t === 1) {
                extension = null;
                access();
            }
        }
        if (burn) {
            let finished = false;
            try { finished = burn.draw(now, dt); }
            catch { finished = true; } // A blocked canvas mask must not leave an inert panel stranded.
            if (finished) finishBurn();
        }
        for (let i = particles.length - 1; i >= 0; i--) {
            const dot = particles[i];
            dot.age += dt;
            if (dot.age >= dot.life) { particles.splice(i, 1); continue; }
            dot.x += dot.vx * dt;
            dot.y += dot.vy * dt;
            if (dot.type) {
                drawDissolveParticle(ctx, dot, 1 - dot.age / dot.life, now);
                continue;
            }
            ctx.globalAlpha = (1 - dot.age / dot.life) ** 1.5;
            ctx.fillStyle = '#efd292';
            ctx.shadowColor = '#d6ae62';
            ctx.shadowBlur = 8;
            ctx.fillRect(dot.x, dot.y, dot.r, dot.r);
            ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1;
        viewport.dataset.visible = String(mode !== 'closed' || particles.length > 0);
    }

    function tick(now) {
        raf = 0;
        try {
            drawFrame(now);
            if (mode === 'opening' || extension || burn || particles.length) raf = requestAnimationFrame(tick);
            else clearCanvas();
        } catch {
            // A failed frame must never leave a bright edge or unusable controls behind.
            drawingFailed = true;
            finishMotion();
        }
    }

    function run() {
        canvas.style.visibility = 'visible';
        if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    }

    function reset() {
        cancelAnimationFrame(raf);
        raf = 0;
        extension = null;
        burn?.clear();
        burn = null;
        clearDissolveMask(shell);
        clearDissolveMask(adv);
        particles = [];
        advanced = false;
        adv.style.height = '0px';
        clearCanvas();
    }

    function open() {
        if (mode !== 'closed') return;
        reset();
        viewport.scrollTop = 0;
        mode = reduced() ? 'open' : 'opening';
        start = performance.now();
        main.style.clipPath = reduced() ? 'none' : 'inset(0 100% 0 0)';
        access();
        resize();
        if (!reduced()) run();
    }

    function finishClosed() {
        mode = 'closed';
        advanced = false;
        adv.style.height = '0px';
        main.style.clipPath = 'inset(0 100% 0 0)';
        access();
    }

    function finishBurn() {
        const all = burn?.target === shell;
        burn?.clear();
        burn = null;
        if (all) finishClosed();
        else {
            advanced = false;
            adv.style.height = '0px';
            access();
        }
    }

    function startBurn(part) {
        if (burn || mode === 'closed') return;
        const all = part === 'all';
        const hadFocus = (all && main.contains(root.activeElement)) || adv.contains(root.activeElement);
        extension = null;
        particles = [];
        if (all) mode = 'closing';
        if (!reduced()) {
            try { burn = createDissolve(all ? shell : adv, 3500 * (all ? 1 : .82), rect, ctx, particles); }
            catch { burn = null; }
        }
        if (!burn) {
            if (all) { reset(); finishClosed(); }
            else { advanced = false; adv.style.height = '0px'; access(); }
        } else { access(); run(); }
        if (hadFocus) (all ? handle : toggle).focus({ preventScroll: true });
    }

    function close() {
        if (mode === 'opening') {
            reset();
            finishClosed();
        } else if (mode === 'open') startBurn('all');
    }

    function toggleAdvanced() {
        if (mode !== 'open' || burn || extension) return;
        if (advanced) { startBurn('advanced'); return; }
        const from = rect(adv).h;
        advanced = true;
        extension = reduced() ? null : { start: performance.now(), duration: 3500, from };
        access();
        if (reduced()) adv.style.height = advanced ? `${inner.offsetHeight}px` : '0px';
        else run();
    }

    function finishMotion() {
        if (!reduced()) return;
        cancelAnimationFrame(raf);
        raf = 0;
        particles = [];
        extension = null;
        clearCanvas();
        if (burn) { finishBurn(); return; }
        if (mode === 'closed') { access(); return; }
        mode = 'open';
        main.style.clipPath = 'none';
        adv.style.height = advanced ? `${inner.offsetHeight}px` : '0px';
        access();
    }

    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    observer.observe(inner);
    motion?.addEventListener?.('change', finishMotion);
    const onHandle = () => mode === 'closed' ? open() : close();
    const onEscape = event => {
        if (event.key !== 'Escape' || mode === 'closed') return;
        event.stopPropagation();
        close();
    };
    handle.addEventListener('click', onHandle);
    toggle.addEventListener('click', toggleAdvanced);
    q('.collapse').addEventListener('click', close);
    root.addEventListener('keydown', onEscape);
    clearCanvas();
    access();
    resize();

    return { open, close, destroy() {
        reset();
        observer.disconnect();
        motion?.removeEventListener?.('change', finishMotion);
        handle.removeEventListener('click', onHandle);
        toggle.removeEventListener('click', toggleAdvanced);
        q('.collapse').removeEventListener('click', close);
        root.removeEventListener('keydown', onEscape);
    } };
}
