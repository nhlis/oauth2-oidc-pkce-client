import { IDP_OAUTH2_MESSAGE_SOURCE, IIdpOAuth2CallbackMessage } from './types';

/**
 * Call this on the static page you host at `redirectUri`. It reads
 * `code`/`state`/`error` off the popup's own URL, posts them back to
 * `window.opener`, then closes the popup. Does nothing if there is no
 * opener (e.g. page opened directly, not as a popup).
 *
 * Usage (redirect_uri page, e.g. /oauth2/callback):
 *   import { handleOAuth2PopupCallback } from 'oauth2-oidc-pkce-client/callback';
 *   handleOAuth2PopupCallback();
 */
export function handleOAuth2PopupCallback(): void {
    if (!window.opener) return;

    const params = new URLSearchParams(window.location.search);
    const message: IIdpOAuth2CallbackMessage = {
        source: IDP_OAUTH2_MESSAGE_SOURCE,
        state: params.get('state'),
        code: params.get('code') ?? undefined,
        error: params.get('error') ?? undefined,
        error_description: params.get('error_description') ?? undefined,
    };

    window.opener.postMessage(message, window.location.origin);
}
