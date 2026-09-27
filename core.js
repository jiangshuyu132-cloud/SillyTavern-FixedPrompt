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

export function promptForGeneration(settings, type = 'normal') {
    const normalized = normalizeSettings(settings);
    // Background summaries and impersonation are separate tasks, not chat replies.
    const excluded = ['quiet', 'impersonate'].includes(String(type).toLowerCase());
    return normalized.enabled && !excluded && normalized.text.trim()
        ? normalized.text
        : '';
}

/** Uses SillyTavern's own prompt store; never edits or appends chat messages. */
export function createController(getContext) {
    let currentType = 'normal';

    function settings() {
        return normalizeSettings(getContext()?.extensionSettings?.[SETTINGS_KEY]);
    }

    function sync(type = currentType) {
        currentType = type || 'normal';
        const ctx = getContext();
        if (!ctx?.setExtensionPrompt) return '';
        const value = settings();
        const prompt = promptForGeneration(value, currentType);
        // IN_CHAT = 1; SYSTEM = 0; USER = 1; ASSISTANT = 2. No world-info scan.
        ctx.setExtensionPrompt(PROMPT_KEY, prompt, 1, value.depth, false, value.role);
        return prompt;
    }

    function update(patch) {
        const ctx = getContext();
        if (!ctx?.extensionSettings) throw new Error('酒馆设置接口尚未就绪。');
        const next = normalizeSettings({ ...settings(), ...patch });
        ctx.extensionSettings[SETTINGS_KEY] = next;
        sync();
        ctx.saveSettingsDebounced();
        return next;
    }

    function clear() {
        const ctx = getContext();
        ctx?.setExtensionPrompt?.(PROMPT_KEY, '', 1, 0, false, 0);
        // Removing our own entry also releases any future filter or metadata.
        if (ctx?.extensionPrompts) delete ctx.extensionPrompts[PROMPT_KEY];
    }

    return { settings, sync, update, clear };
}
