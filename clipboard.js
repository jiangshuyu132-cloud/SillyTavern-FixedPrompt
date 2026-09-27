/** Clipboard API on HTTPS; a user-triggered copy fallback for HTTP-hosted taverns. */
export async function copyText(text, document, activeElement) {
    try {
        if (globalThis.navigator?.clipboard?.writeText) {
            await globalThis.navigator.clipboard.writeText(text);
            return true;
        }
    } catch { /* Fall back when the browser rejects clipboard access. */ }
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('aria-hidden', 'true');
    input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;font-size:16px';
    document.body.append(input);
    try {
        input.focus();
        input.select();
        return document.execCommand?.('copy') === true;
    } catch {
        return false;
    } finally {
        input.remove();
        activeElement?.focus?.({ preventScroll: true });
    }
}
