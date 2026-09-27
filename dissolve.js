// Ported from the approved “粒子展开与不规则消散-3.5秒” preview.
const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => x * x * (3 - 2 * x);
const sites = [[.49, .47], [0, .23], [1, .77]];

function noise(x, y) {
    const hash = (a, b) => {
        const z = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
        return z - Math.floor(z);
    };
    const ix = Math.floor(x), iy = Math.floor(y), fx = ease(x - ix), fy = ease(y - iy);
    return (hash(ix, iy) * (1 - fx) + hash(ix + 1, iy) * fx) * (1 - fy)
        + (hash(ix, iy + 1) * (1 - fx) + hash(ix + 1, iy + 1) * fx) * fy;
}

/** Weighted propagation from the same three origins, with locally uneven speed. */
export function growIrregularField(field, w, h) {
    const n = w * h, cost = new Float32Array(n), flowX = new Float32Array(n);
    const flowY = new Float32Array(n), done = new Uint8Array(n), position = new Int32Array(n);
    position.fill(-1);
    field.fill(Infinity);
    const heap = [], shift = Math.random() * 31;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = x / w, v = y / w, i = y * w + x;
        const wx = u * 8 + noise(u * 3 + shift, v * 3) * 2.6;
        const wy = v * 8 + noise(u * 3 + 13, v * 3 + shift) * 2.6;
        const broad = noise(wx + shift, wy), fine = noise(u * 37 + shift, v * 37 + 7);
        const angle = noise(u * 5 + shift, v * 5 + 19) * Math.PI * 2;
        cost[i] = Math.exp((broad - .48) * 5.5) * (.48 + fine * 1.15) * (1 + .45 * u);
        flowX[i] = Math.cos(angle);
        flowY[i] = Math.sin(angle);
    }
    function swap(a, b) {
        const t = heap[a]; heap[a] = heap[b]; heap[b] = t;
        position[heap[a]] = a; position[heap[b]] = b;
    }
    function up(k) {
        while (k > 0) {
            const p = (k - 1) >> 1;
            if (field[heap[p]] <= field[heap[k]]) break;
            swap(k, p); k = p;
        }
    }
    function insert(i) {
        if (position[i] < 0) { position[i] = heap.length; heap.push(i); }
        up(position[i]);
    }
    function pop() {
        const result = heap[0], tail = heap.pop();
        position[result] = -1;
        if (heap.length) {
            heap[0] = tail; position[tail] = 0;
            let k = 0;
            for (;;) {
                let a = k * 2 + 1;
                const b = a + 1;
                if (a >= heap.length) break;
                if (b < heap.length && field[heap[b]] < field[heap[a]]) a = b;
                if (field[heap[k]] <= field[heap[a]]) break;
                swap(k, a); k = a;
            }
        }
        return result;
    }
    for (const [sx, sy] of sites) {
        const i = Math.round(sy * (h - 1)) * w + Math.round(sx * (w - 1));
        field[i] = 0;
        insert(i);
    }
    const moves = [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
        [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2]];
    let max = 0;
    while (heap.length) {
        const i = pop();
        done[i] = 1;
        const x = i % w, y = Math.floor(i / w), arrival = field[i];
        max = Math.max(max, arrival);
        for (const [dx, dy, length] of moves) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
            const j = yy * w + xx;
            if (done[j]) continue;
            const cross = (flowX[i] * dy - flowY[i] * dx) / length;
            const direction = .42 + 1.8 * cross * cross;
            const next = arrival + length * (cost[i] + cost[j]) * .5 * direction;
            if (next < field[j]) { field[j] = next; insert(j); }
        }
    }
    if (max === 0) { field.fill(.025); return; }
    const bins = new Uint32Array(512), cdf = new Float32Array(512);
    for (let i = 0; i < n; i++) bins[Math.min(511, Math.floor(field[i] / max * 511))]++;
    let sum = 0;
    for (let k = 0; k < 512; k++) { sum += bins[k]; cdf[k] = sum / n; }
    for (let i = 0; i < n; i++) {
        const t = field[i] / max * 511, k = Math.floor(t), f = t - k;
        const area = cdf[k] + ((cdf[Math.min(511, k + 1)] || 1) - cdf[k]) * f;
        field[i] = .025 + .84 * (.34 * t / 511 + .66 * area);
    }
}

export function clearDissolveMask(element) {
    for (const property of ['mask-image', '-webkit-mask-image', 'mask-size', '-webkit-mask-size',
        'mask-repeat', '-webkit-mask-repeat']) element.style.removeProperty(property);
}

/** Masks the actual live panel, so saved text and controls dissolve together. */
export function createDissolve(target, duration, geometry, ctx, particles) {
    const g = geometry(target);
    if (!(g.w > 0 && g.h > 0)) return null;
    let mw = Math.min(360, Math.ceil(g.w * .6));
    // A manually enlarged preview must not create an unbounded mask.
    const ratio = g.h / g.w;
    mw = Math.max(1, Math.min(mw, Math.floor(Math.sqrt(360000 / ratio))));
    const mh = Math.max(1, Math.min(360000, Math.round(mw * ratio)));
    const make = () => {
        const canvas = target.ownerDocument.createElement('canvas');
        canvas.width = mw; canvas.height = mh;
        return canvas;
    };
    const mc = make(), ec = make(), mctx = mc.getContext('2d'), ectx = ec.getContext('2d');
    if (!mctx || !ectx) return null;
    const mi = mctx.createImageData(mw, mh), ei = ectx.createImageData(mw, mh);
    const field = new Float32Array(mw * mh);
    growIrregularField(field, mw, mh);
    for (let i = 0; i < field.length; i++) {
        const j = i * 4;
        mi.data[j] = mi.data[j + 1] = mi.data[j + 2] = 255;
    }
    const started = performance.now();
    let lastMask = -100, front = [];
    return { target, clear: () => clearDissolveMask(target), draw(now, dt) {
        const t = clamp((now - started) / duration), g = geometry(target), threshold = t * .92 - .025;
        if (now - lastMask > 32 || t === 1) {
            lastMask = now;
            const m = mi.data, e = ei.data;
            front = [];
            for (let i = 0; i < field.length; i++) {
                const d = field[i] - threshold, j = i * 4;
                const hash = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
                const grain = ((hash ^ (hash >>> 16)) >>> 0) / 4294967295;
                m[j + 3] = Math.round(clamp(d / .007) * 255 * (d < .012 ? (.38 + .62 * grain) : 1));
                let r = 0, gr = 0, bl = 0, a = 0;
                if (d >= .008 && d < .036) {
                    r = 35; gr = 31; bl = 23; a = clamp((.036 - d) / .028) * 105;
                } else if (d > -.012 && d < .008) {
                    const hot = clamp(1 - Math.abs(d + .002) / .011);
                    r = 224 + hot * 24; gr = 187 + hot * 41; bl = 112 + hot * 64;
                    a = grain > .54 ? (110 + 145 * hot) : 24;
                    if (i % 3 === 0) front.push(i);
                } else if (d > -.027 && d <= -.012) {
                    r = 205; gr = 170; bl = 99; a = clamp((d + .027) / .015) * 35;
                }
                e[j] = r; e[j + 1] = gr; e[j + 2] = bl; e[j + 3] = a;
            }
            mctx.putImageData(mi, 0, 0); ectx.putImageData(ei, 0, 0);
            const url = 'url("' + mc.toDataURL('image/png') + '")';
            target.style.setProperty('mask-image', url);
            target.style.setProperty('-webkit-mask-image', url);
            target.style.setProperty('mask-size', '100% 100%');
            target.style.setProperty('-webkit-mask-size', '100% 100%');
            target.style.setProperty('mask-repeat', 'no-repeat');
            target.style.setProperty('-webkit-mask-repeat', 'no-repeat');
        }
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.filter = 'blur(5px)'; ctx.globalAlpha = .35; ctx.drawImage(ec, g.x, g.y, g.w, g.h);
        ctx.filter = 'none'; ctx.globalAlpha = 1; ctx.drawImage(ec, g.x, g.y, g.w, g.h);
        ctx.restore();
        const count = Math.ceil(Math.min(17, front.length / 35) * dt * 60);
        for (let k = 0; k < count; k++) {
            const i = front[Math.floor(Math.random() * front.length)];
            if (i === undefined) continue;
            const x = g.x + (i % mw) / mw * g.w, y = g.y + Math.floor(i / mw) / mh * g.h;
            particles.push({ type: 'mote', x, y, vx: (Math.random() - .5) * 40, vy: -8 - Math.random() * 29,
                age: 0, life: .35 + Math.random() * 1.2, r: .4 + Math.random() ** 2 * 2.9, phase: Math.random() * 6.28 });
            if (Math.random() < .12) particles.push({ type: 'fragment', x, y,
                vx: (Math.random() - .5) * 24, vy: -10 - Math.random() * 20,
                age: 0, life: .7 + Math.random() * .6, r: 1 + Math.random() ** 2 * 4, phase: Math.random() * 6 });
        }
        return t === 1;
    } };
}

export function drawDissolveParticle(ctx, p, remain, now) {
    ctx.save();
    if (p.type === 'mote') {
        const flicker = .72 + .28 * Math.sin(now * .006 + p.phase), size = p.r * (.6 + .4 * remain);
        ctx.globalAlpha = remain ** 1.3 * flicker;
        ctx.fillStyle = p.age < p.life * .5 ? '#eed9a1' : '#b9a06b';
        ctx.shadowColor = '#d6b66e'; ctx.shadowBlur = 5;
        const x = p.x + Math.sin(now * .002 + p.phase) * 2;
        ctx.fillRect(x, p.y, size, size); ctx.shadowBlur = 0;
        if (p.r > 1.8) {
            ctx.globalAlpha *= .15;
            ctx.fillRect(x, p.y + size, size * .55, 3 + remain * 4);
        }
    } else {
        ctx.globalAlpha = remain * .5;
        ctx.translate(p.x, p.y); ctx.rotate(p.age * 1.4 + p.phase);
        ctx.fillStyle = '#b6a074';
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * .6);
    }
    ctx.restore();
}
