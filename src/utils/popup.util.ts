import { IDP_OAUTH2_MESSAGE_SOURCE, IIdpOAuth2CallbackMessage } from '../types';
import { POPUP_POLL_INTERVAL_MS } from '../constants';

export class PopupBlockedError extends Error {
    constructor() {
        super('Popup was blocked by the browser. Trigger login from a direct user click.');
        this.name = 'PopupBlockedError';
    }
}

export class PopupClosedByUserError extends Error {
    constructor() {
        super('User closed the popup before completing sign-in.');
        this.name = 'PopupClosedByUserError';
    }
}

export class PopupTimeoutError extends Error {
    constructor() {
        super('Timed out waiting for the sign-in popup to complete.');
        this.name = 'PopupTimeoutError';
    }
}

export function openCenteredPopup(url: string, name: string, width: number, height: number): Window {
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const features = `width=${width},height=${height},left=${left},top=${top},resizable,scrollbars`;
    const popup = window.open(url, name, features);
    if (!popup) throw new PopupBlockedError();
    return popup;
}

/**
 * Best-effort placeholder shown in a freshly-opened `about:blank` popup
 * while the authorize URL is still being prepared. The popup is same-origin
 * at this point (it hasn't navigated anywhere yet), so this is safe — but
 * it's cosmetic, so any failure here is swallowed rather than breaking sign-in.
 */
export function writeLoadingState(popup: Window): void {
    try {
        popup.document.title = 'Signing in…';
        popup.document.body.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui,sans-serif;color:#888';
        popup.document.body.textContent = 'Loading…';
    } catch {
        // Cosmetic only — never worth failing sign-in over.
    }
}

/**
 * Navigates an already-open popup to `url`. If the popup was closed in the
 * gap between opening it and finishing the async setup (PKCE/discovery),
 * navigating it throws a browser-specific error — normalized here to the
 * same PopupClosedByUserError the closed-poll in `waitForPopupMessage`
 * would have reported a moment later anyway.
 */
export function navigatePopup(popup: Window, url: string): void {
    try {
        popup.location.assign(url);
    } catch {
        throw new PopupClosedByUserError();
    }
}

/**
 * Resolves with the callback message once the popup posts it, rejects if the
 * user closes the popup manually or the flow exceeds `timeoutMs`.
 */
export function waitForPopupMessage(
    popup: Window,
    expectedOrigin: string,
    expectedState: string,
    timeoutMs: number,
): Promise<IIdpOAuth2CallbackMessage> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            window.removeEventListener('message', onMessage);
            clearInterval(closedPoll);
            clearTimeout(timeoutHandle);
        };

        const onMessage = (event: MessageEvent<IIdpOAuth2CallbackMessage>) => {
            if (event.origin !== expectedOrigin) return;
            if (event.data?.source !== IDP_OAUTH2_MESSAGE_SOURCE) return;
            if (event.data.state !== expectedState) return;
            cleanup();
            popup.close();
            resolve(event.data);
        };

        const closedPoll = setInterval(() => {
            if (popup.closed) {
                cleanup();
                reject(new PopupClosedByUserError());
            }
        }, POPUP_POLL_INTERVAL_MS);

        const timeoutHandle = setTimeout(() => {
            cleanup();
            popup.close();
            reject(new PopupTimeoutError());
        }, timeoutMs);

        window.addEventListener('message', onMessage);
    });
}
