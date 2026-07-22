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
declare function handleOAuth2PopupCallback(): void;

export { handleOAuth2PopupCallback };
