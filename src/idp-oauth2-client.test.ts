import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdpOAuth2Client, IdpOAuth2ApiError } from './idp-oauth2-client';
import { PopupBlockedError } from './utils/popup.util';
import { toBase64Url } from './utils/base64url.util';
import { IDP_OAUTH2_MESSAGE_SOURCE } from './types';
import type { IIdpOAuth2ClientConfig, IIdpTokenResponse } from './types';
import type { IIdpDiscoveryDocument } from './utils/discovery.util';

const ENDPOINTS: IIdpDiscoveryDocument = {
    issuer: 'https://idp.example',
    authorization_endpoint: 'https://idp.example/authorize',
    token_endpoint: 'https://idp.example/token',
    userinfo_endpoint: 'https://idp.example/userinfo',
    revocation_endpoint: 'https://idp.example/revoke',
};

const REDIRECT_URI = 'https://myapp.example/oauth2/callback';
const nowSeconds = () => Math.floor(Date.now() / 1000);

function makeConfig(overrides: Partial<IIdpOAuth2ClientConfig> = {}): IIdpOAuth2ClientConfig {
    return {
        clientId: 'client-1',
        issuerUrl: ENDPOINTS.issuer,
        redirectUri: REDIRECT_URI,
        scope: 'openid profile email',
        endpoints: ENDPOINTS,
        ...overrides,
    };
}

function fakeIdToken(claims: Record<string, unknown>): string {
    const encode = (obj: Record<string, unknown>) => toBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
    return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}.fake-signature`;
}

function tokenResponse(overrides: Partial<IIdpTokenResponse> = {}): IIdpTokenResponse {
    return { access_token: 'access-1', token_type: 'Bearer', expires_in: 3600, scope: 'openid profile email', ...overrides };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setUrl(url: string) {
    window.history.pushState({}, '', url);
}

/** window.location's methods are spec-unforgeable in jsdom, so the whole object must be swapped to stub `assign`. */
function stubLocationAssign(): { assign: ReturnType<typeof vi.fn>; restore: () => void } {
    const original = window.location;
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...original, assign }, configurable: true, writable: true });
    return { assign, restore: () => Object.defineProperty(window, 'location', { value: original, configurable: true, writable: true }) };
}

function fakePopup(): Window & { closed: boolean; close: ReturnType<typeof vi.fn>; location: { assign: ReturnType<typeof vi.fn> } } {
    return {
        closed: false,
        close: vi.fn(),
        location: { assign: vi.fn() },
        document: { title: '', body: { style: {}, textContent: '' } },
    } as unknown as Window & { closed: boolean; close: ReturnType<typeof vi.fn>; location: { assign: ReturnType<typeof vi.fn> } };
}

beforeEach(() => {
    sessionStorage.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
    setUrl('/');
});

describe('discovery resolution', () => {
    it('skips the discovery fetch when config.endpoints is supplied directly', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sub: 'user-1' }));
        vi.stubGlobal('fetch', fetchMock);
        const client = new IdpOAuth2Client(makeConfig());

        await client.getUserInfo('access-token');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(ENDPOINTS.userinfo_endpoint);
    });

    it('fetches discovery once and reuses it across multiple calls', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse(ENDPOINTS))
            .mockResolvedValueOnce(jsonResponse({ sub: 'user-1' }))
            .mockResolvedValueOnce(jsonResponse({ sub: 'user-1' }));
        vi.stubGlobal('fetch', fetchMock);
        const client = new IdpOAuth2Client(makeConfig({ endpoints: undefined }));

        await client.getUserInfo('t1');
        await client.getUserInfo('t2');

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[0][0]).toBe('https://idp.example/.well-known/openid-configuration');
    });

    it('retries discovery on the next call instead of permanently caching a failure', async () => {
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(new TypeError('network down'))
            .mockResolvedValueOnce(jsonResponse(ENDPOINTS))
            .mockResolvedValueOnce(jsonResponse({ sub: 'user-1' }));
        vi.stubGlobal('fetch', fetchMock);
        const client = new IdpOAuth2Client(makeConfig({ endpoints: undefined }));

        await expect(client.getUserInfo('t1')).rejects.toThrow('network down');
        await expect(client.getUserInfo('t1')).resolves.toEqual({ sub: 'user-1' });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('throws a clear error when a needed endpoint is missing from the discovery document', async () => {
        const client = new IdpOAuth2Client(makeConfig({ endpoints: { ...ENDPOINTS, userinfo_endpoint: undefined } }));
        await expect(client.getUserInfo('t')).rejects.toThrow(/userinfo_endpoint/);
    });
});

describe('error response parsing', () => {
    it('falls back to a synthesized error instead of throwing when the body is not JSON', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' })));
        const client = new IdpOAuth2Client(makeConfig());

        const error = await client.getUserInfo('t').catch((e) => e);

        expect(error).toBeInstanceOf(IdpOAuth2ApiError);
        expect((error as IdpOAuth2ApiError).errorBody.error).toBe('http_502');
    });

    it('surfaces the provider-supplied error JSON when the body is valid', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid_token', error_description: 'expired' }, 401)));
        const client = new IdpOAuth2Client(makeConfig());

        const error = await client.getUserInfo('t').catch((e) => e);

        expect(error).toBeInstanceOf(IdpOAuth2ApiError);
        expect((error as IdpOAuth2ApiError).errorBody).toEqual({ error: 'invalid_token', error_description: 'expired' });
    });
});

describe('refreshAccessToken', () => {
    it('sends a refresh_token grant to the token endpoint', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(tokenResponse({ access_token: 'new-access' })));
        vi.stubGlobal('fetch', fetchMock);
        const client = new IdpOAuth2Client(makeConfig());

        const tokens = await client.refreshAccessToken('refresh-1');

        expect(tokens.access_token).toBe('new-access');
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(ENDPOINTS.token_endpoint);
        const body = init.body as URLSearchParams;
        expect(body.get('grant_type')).toBe('refresh_token');
        expect(body.get('refresh_token')).toBe('refresh-1');
        expect(body.get('client_id')).toBe('client-1');
    });
});

describe('revokeToken', () => {
    it('posts token, client_id, and the type hint to the revocation endpoint', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const client = new IdpOAuth2Client(makeConfig());

        await client.revokeToken('access-1', 'access_token');

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(ENDPOINTS.revocation_endpoint);
        const body = init.body as URLSearchParams;
        expect(body.get('token')).toBe('access-1');
        expect(body.get('client_id')).toBe('client-1');
        expect(body.get('token_type_hint')).toBe('access_token');
    });

    it('omits token_type_hint when not provided', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const client = new IdpOAuth2Client(makeConfig());

        await client.revokeToken('access-1');

        const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
        expect(body.has('token_type_hint')).toBe(false);
    });
});

describe('redirect flow (loginWithRedirect + handleRedirectCallback)', () => {
    it('returns null on a plain page visit with no OAuth2 params', async () => {
        setUrl('/oauth2/callback');
        const client = new IdpOAuth2Client(makeConfig());
        await expect(client.handleRedirectCallback()).resolves.toBeNull();
    });

    it('throws invalid_request when a code arrives with no state', async () => {
        setUrl('/oauth2/callback?code=abc123');
        const client = new IdpOAuth2Client(makeConfig());
        await expect(client.handleRedirectCallback()).rejects.toMatchObject({ errorBody: { error: 'invalid_request' } });
    });

    it('throws with the provider error when the provider redirects back with one', async () => {
        setUrl('/oauth2/callback?error=access_denied&error_description=User+said+no');
        const client = new IdpOAuth2Client(makeConfig());
        await expect(client.handleRedirectCallback()).rejects.toMatchObject({ errorBody: { error: 'access_denied', error_description: 'User said no' } });
    });

    it('throws invalid_state when the state has no matching saved flow (CSRF/expired session)', async () => {
        setUrl('/oauth2/callback?code=abc123&state=unknown-state');
        const client = new IdpOAuth2Client(makeConfig());
        await expect(client.handleRedirectCallback()).rejects.toMatchObject({ errorBody: { error: 'invalid_state' } });
    });

    it('completes a full round trip: authorize URL -> code exchange -> id_token nonce validated -> URL cleaned', async () => {
        const { assign, restore } = stubLocationAssign();
        const client = new IdpOAuth2Client(makeConfig());
        await client.loginWithRedirect();

        expect(assign).toHaveBeenCalledTimes(1);
        const authorizeUrl = new URL(assign.mock.calls[0][0] as string);
        restore(); // back to the real, live window.location so pushState below actually takes effect

        expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(ENDPOINTS.authorization_endpoint);
        expect(authorizeUrl.searchParams.get('response_type')).toBe('code');
        expect(authorizeUrl.searchParams.get('client_id')).toBe('client-1');
        expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
        expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');

        const state = authorizeUrl.searchParams.get('state')!;
        const nonce = authorizeUrl.searchParams.get('nonce')!;
        const codeChallenge = authorizeUrl.searchParams.get('code_challenge')!;
        expect(state).toBeTruthy();
        expect(nonce).toBeTruthy();

        const idToken = fakeIdToken({ iss: ENDPOINTS.issuer, aud: 'client-1', sub: 'user-1', nonce, exp: nowSeconds() + 300, iat: nowSeconds() });
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(tokenResponse({ id_token: idToken })));
        vi.stubGlobal('fetch', fetchMock);

        setUrl(`/oauth2/callback?code=auth-code-1&state=${state}`);
        const tokens = await client.handleRedirectCallback();

        expect(tokens?.id_token).toBe(idToken);
        expect(tokens?.access_token).toBe('access-1');

        // PKCE end-to-end: the verifier sent to the token endpoint must hash to the challenge sent earlier.
        const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
        expect(tokenUrl).toBe(ENDPOINTS.token_endpoint);
        const body = tokenInit.body as URLSearchParams;
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('code')).toBe('auth-code-1');
        expect(body.get('redirect_uri')).toBe(REDIRECT_URI);
        const verifier = body.get('code_verifier')!;
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
        expect(toBase64Url(new Uint8Array(digest))).toBe(codeChallenge);

        // Single-use: the pending flow entry must be gone, and the URL stripped of OAuth2 params.
        expect(sessionStorage.getItem(`idp_oauth2_pending:${state}`)).toBeNull();
        const cleanedUrl = new URL(window.location.href);
        expect(cleanedUrl.searchParams.get('code')).toBeNull();
        expect(cleanedUrl.searchParams.get('state')).toBeNull();
    });

    it('rejects with IdTokenValidationError when the returned id_token has a mismatched nonce', async () => {
        const { assign, restore } = stubLocationAssign();
        const client = new IdpOAuth2Client(makeConfig());
        await client.loginWithRedirect();

        const authorizeUrl = new URL(assign.mock.calls[0][0] as string);
        const state = authorizeUrl.searchParams.get('state')!;
        restore(); // back to the real, live window.location so pushState below actually takes effect

        // Nonce does NOT match what was sent — simulates a replayed/substituted id_token.
        const idToken = fakeIdToken({ iss: ENDPOINTS.issuer, aud: 'client-1', sub: 'user-1', nonce: 'wrong-nonce', exp: nowSeconds() + 300, iat: nowSeconds() });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(tokenResponse({ id_token: idToken }))));

        setUrl(`/oauth2/callback?code=auth-code-1&state=${state}`);
        await expect(client.handleRedirectCallback()).rejects.toThrow(/nonce/i);
    });
});

describe('popup flow (loginWithPopup)', () => {
    it('rejects with PopupBlockedError when window.open returns null', async () => {
        vi.stubGlobal('open', vi.fn().mockReturnValue(null));
        const client = new IdpOAuth2Client(makeConfig());
        await expect(client.loginWithPopup()).rejects.toThrow(PopupBlockedError);
    });

    it('opens the popup synchronously as about:blank, before any await — so Safari sees it as a direct user-gesture result', () => {
        const popup = fakePopup();
        const openMock = vi.fn().mockReturnValue(popup);
        vi.stubGlobal('open', openMock);
        const client = new IdpOAuth2Client(makeConfig());

        void client.loginWithPopup(); // deliberately not awaited — checking what happens before the first await inside it

        expect(openMock).toHaveBeenCalledTimes(1);
        expect(openMock.mock.calls[0][0]).toBe('about:blank');
        // Navigation to the real authorize URL happens later, only after PKCE/discovery finish.
        expect(popup.location.assign).not.toHaveBeenCalled();
    });

    it('completes a full round trip via postMessage and validates the id_token nonce', async () => {
        const popup = fakePopup();
        const openMock = vi.fn().mockReturnValue(popup);
        vi.stubGlobal('open', openMock);
        const client = new IdpOAuth2Client(makeConfig());

        const loginPromise = client.loginWithPopup();
        await vi.waitFor(() => expect(popup.location.assign).toHaveBeenCalled());

        expect(openMock.mock.calls[0][0]).toBe('about:blank'); // opened blank first...
        const authorizeUrl = new URL(popup.location.assign.mock.calls[0][0] as string); // ...then navigated here
        const state = authorizeUrl.searchParams.get('state')!;
        const nonce = authorizeUrl.searchParams.get('nonce')!;

        const idToken = fakeIdToken({ iss: ENDPOINTS.issuer, aud: 'client-1', sub: 'user-1', nonce, exp: nowSeconds() + 300, iat: nowSeconds() });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(tokenResponse({ id_token: idToken }))));

        window.dispatchEvent(
            new MessageEvent('message', {
                data: { source: IDP_OAUTH2_MESSAGE_SOURCE, state, code: 'auth-code-1' },
                origin: new URL(REDIRECT_URI).origin,
            }),
        );

        const tokens = await loginPromise;
        expect(tokens.id_token).toBe(idToken);
        expect(popup.close).toHaveBeenCalledTimes(1);
    });

    it('rejects with IdpOAuth2ApiError when the popup message carries a provider error', async () => {
        const popup = fakePopup();
        const openMock = vi.fn().mockReturnValue(popup);
        vi.stubGlobal('open', openMock);
        const client = new IdpOAuth2Client(makeConfig());

        const loginPromise = client.loginWithPopup();
        await vi.waitFor(() => expect(popup.location.assign).toHaveBeenCalled());
        const state = new URL(popup.location.assign.mock.calls[0][0] as string).searchParams.get('state')!;

        window.dispatchEvent(
            new MessageEvent('message', {
                data: { source: IDP_OAUTH2_MESSAGE_SOURCE, state, error: 'access_denied', error_description: 'User said no' },
                origin: new URL(REDIRECT_URI).origin,
            }),
        );

        await expect(loginPromise).rejects.toMatchObject({ errorBody: { error: 'access_denied', error_description: 'User said no' } });
    });
});

describe('login() ux mode dispatch', () => {
    it('defaults to popup mode', async () => {
        vi.stubGlobal('open', vi.fn().mockReturnValue(null));
        const client = new IdpOAuth2Client(makeConfig());
        // PopupBlockedError only happens on the popup path, so seeing it here proves login() delegated to loginWithPopup.
        await expect(client.login()).rejects.toThrow(PopupBlockedError);
    });

    it('navigates instead of opening a popup when uxMode is "redirect"', async () => {
        const { assign, restore } = stubLocationAssign();
        try {
            const openMock = vi.fn();
            vi.stubGlobal('open', openMock);
            const client = new IdpOAuth2Client(makeConfig({ uxMode: 'redirect' }));

            await client.login();

            expect(assign).toHaveBeenCalledTimes(1);
            expect(openMock).not.toHaveBeenCalled();
        } finally {
            restore();
        }
    });
});
