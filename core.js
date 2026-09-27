import { createDelivery } from './delivery.js';

export const SETTINGS_KEY = 'fixed_prompt_extension';
export const PROMPT_KEY = 'fixed_prompt_extension_prompt';
export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    text: '',
    depth: 0,
    role: 0,
});

export function normalizeSettings(value) {
    const raw = value && typeof value === 'object' ? value : {};
    const depth = Number(raw.depth);
    const role = Number(raw.role);
    return {
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SETTINGS.enabled,
        text: typeof raw.text === 'string' ? raw.text : '',
        depth: Number.isFinite(depth) ? Math.min(100, Math.max(0, Math.trunc(depth))) : 0,
        role: [0, 1, 2].includes(role) ? role : 0,
    };
}

/** Saved settings stay compatible; delivery now appends to a request-only user message. */
export function createController(getContext, onReportChange = () => {}) {
    const delivery = createDelivery(getContext, settings, onReportChange);

    function settings() {
        return normalizeSettings(getContext()?.extensionSettings?.[SETTINGS_KEY]);
    }

    function clearLegacyPrompt() {
        const ctx = getContext();
        // Prevent simultaneous v1.1-style injection and the new user-message attachment.
        if (ctx?.extensionPrompts && PROMPT_KEY in ctx.extensionPrompts) {
            ctx.setExtensionPrompt?.(PROMPT_KEY, '', 1, 0, false, 0);
            delete ctx.extensionPrompts[PROMPT_KEY];
        }
    }

    function update(patch) {
        const ctx = getContext();
        if (!ctx?.extensionSettings) throw new Error('酒馆设置接口尚未就绪。');
        const next = normalizeSettings({ ...settings(), ...patch });
        ctx.extensionSettings[SETTINGS_KEY] = next;
        clearLegacyPrompt();
        ctx.saveSettingsDebounced();
        delivery.changed();
        return next;
    }

    function clear() {
        clearLegacyPrompt();
        delivery.reset();
    }

    return { settings, update, clear, clearLegacyPrompt, delivery };
}
