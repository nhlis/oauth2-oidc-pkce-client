// If you change APP_PORT / IDP_PORT in ../server.js, update IDP_ORIGIN below to match.
import {
    IdpOAuth2Client,
    IdpOAuth2ApiError,
    IdTokenValidationError,
    PopupBlockedError,
    PopupClosedByUserError,
    PopupTimeoutError,
    decodeIdTokenPayload,
} from '/dist/index.js';

const IDP_ORIGIN = 'http://localhost:4001';

function makeClient(redirectUri) {
    return new IdpOAuth2Client({
        clientId: 'demo-client',
        issuerUrl: IDP_ORIGIN,
        redirectUri,
        scope: 'openid profile email',
    });
}

// Two different redirectUri values on purpose: popup mode's provider redirect
// must land on callback.html (a bare page that only knows how to postMessage
// back to window.opener), while redirect mode's must land back on THIS page
// — it's the only place handleRedirectCallback() is ever called. Pointing
// both modes at callback.html (an earlier version of this demo did) means
// redirect mode lands on a page that does nothing with the code/state it
// receives, since window.opener is null outside a popup — same "stuck on
// Completing sign-in forever" symptom as the Safari popup bug, different cause.
const popupClient = makeClient(`${window.location.origin}/callback.html`);
const redirectClient = makeClient(`${window.location.origin}/`);

const el = (id) => document.getElementById(id);
const buttons = {
    popup: el('btn-popup'),
    redirect: el('btn-redirect'),
    userinfo: el('btn-userinfo'),
    refresh: el('btn-refresh'),
    signout: el('btn-signout'),
};

let currentTokens = null;

function setStatus(text, kind) {
    el('status-text').textContent = text;
    el('status-dot').className = `status-dot${kind ? ' ' + kind : ''}`;
}

function setSignedIn(signedIn) {
    buttons.userinfo.disabled = !signedIn;
    buttons.refresh.disabled = !signedIn || !currentTokens?.refresh_token;
    buttons.signout.disabled = !signedIn;
}

function truncate(value, n = 28) {
    if (!value) return '';
    return value.length > n ? `${value.slice(0, n)}…` : value;
}

function renderClaims(claims) {
    const dl = el('claims');
    el('claims-empty').style.display = claims ? 'none' : 'block';
    dl.style.display = claims ? 'grid' : 'none';
    if (!claims) {
        dl.innerHTML = '';
        return;
    }
    dl.innerHTML = Object.entries(claims)
        .map(([key, value]) => `<dt>${key}</dt><dd>${escapeHtml(String(value))}</dd>`)
        .join('');
}

function renderTokens(tokens) {
    const box = el('tokens');
    el('tokens-empty').style.display = tokens ? 'none' : 'block';
    box.style.display = tokens ? 'block' : 'none';
    if (!tokens) {
        box.innerHTML = '';
        return;
    }
    const rows = [
        ['access_token', tokens.access_token],
        ['refresh_token', tokens.refresh_token],
        ['id_token', tokens.id_token],
        ['token_type / expires_in', `${tokens.token_type} · ${tokens.expires_in}s`],
        ['scope', tokens.scope],
    ].filter(([, v]) => v !== undefined);
    box.innerHTML = rows
        .map(([label, value]) => `<div class="token-block"><span class="label">${label}</span>${escapeHtml(label.includes('token') && !label.includes('type') ? truncate(value, 64) : String(value))}</div>`)
        .join('');
}

function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function logEvent(title, kind, detail) {
    const entry = document.createElement('div');
    entry.className = `log-entry${kind ? ' ' + kind : ''}`;
    const time = new Date().toLocaleTimeString();
    entry.innerHTML = `<span class="t">${time}</span>${escapeHtml(title)}${detail ? `<pre>${escapeHtml(typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2))}</pre>` : ''}`;
    el('log').prepend(entry);
}

function describeError(err) {
    if (err instanceof PopupBlockedError) return ['Popup blocked', 'The browser blocked the popup — this button must be the first await in a click handler.'];
    if (err instanceof PopupClosedByUserError) return ['Popup closed by user', 'The popup was closed before sign-in finished.'];
    if (err instanceof PopupTimeoutError) return ['Popup timed out', 'The flow did not complete within the timeout.'];
    if (err instanceof IdTokenValidationError) return ['id_token validation failed', err.message];
    if (err instanceof IdpOAuth2ApiError) return [`Provider error: ${err.errorBody.error}`, err.errorBody.error_description ?? ''];
    return ['Unexpected error', err instanceof Error ? err.message : String(err)];
}

function handleError(err) {
    const [title, detail] = describeError(err);
    setStatus(title, 'err');
    logEvent(title, 'err', detail);
    console.error(err);
}

function onSignedIn(tokens) {
    currentTokens = tokens;
    setSignedIn(true);
    setStatus('Signed in', 'ok');
    renderTokens(tokens);
    if (tokens.id_token) {
        renderClaims(decodeIdTokenPayload(tokens.id_token));
        logEvent('Signed in — id_token nonce/aud/iss/exp already validated by the package', 'ok');
    } else {
        logEvent('Signed in (no id_token in response)', 'ok');
    }
}

buttons.popup.addEventListener('click', async () => {
    setStatus('Opening popup…', 'busy');
    logEvent('loginWithPopup() called');
    try {
        onSignedIn(await popupClient.loginWithPopup());
    } catch (err) {
        handleError(err);
    }
});

buttons.redirect.addEventListener('click', async () => {
    setStatus('Redirecting…', 'busy');
    logEvent('loginWithRedirect() called — navigating away');
    await redirectClient.loginWithRedirect();
});

buttons.userinfo.addEventListener('click', async () => {
    if (!currentTokens) return;
    try {
        const info = await popupClient.getUserInfo(currentTokens.access_token);
        logEvent('getUserInfo() →', 'ok', info);
    } catch (err) {
        handleError(err);
    }
});

buttons.refresh.addEventListener('click', async () => {
    if (!currentTokens?.refresh_token) return;
    try {
        const fresh = await popupClient.refreshAccessToken(currentTokens.refresh_token);
        currentTokens = { ...currentTokens, ...fresh };
        renderTokens(currentTokens);
        logEvent('refreshAccessToken() → new access_token issued', 'ok');
    } catch (err) {
        handleError(err);
    }
});

buttons.signout.addEventListener('click', async () => {
    if (!currentTokens) return;
    try {
        await popupClient.revokeToken(currentTokens.access_token, 'access_token');
        logEvent('revokeToken() → revoked', 'ok');
    } catch (err) {
        handleError(err);
    } finally {
        currentTokens = null;
        setSignedIn(false);
        setStatus('Signed out');
        renderClaims(null);
        renderTokens(null);
    }
});

// Complete a redirect-mode flow if we've just been sent back here with ?code=...&state=...
// Must use redirectClient — same redirectUri that loginWithRedirect() sent to the provider,
// which the provider echoes into the code exchange and which this package checks matches.
(async () => {
    try {
        const tokens = await redirectClient.handleRedirectCallback();
        if (tokens) {
            logEvent('handleRedirectCallback() completed the exchange');
            onSignedIn(tokens);
        }
    } catch (err) {
        handleError(err);
    }
})();
