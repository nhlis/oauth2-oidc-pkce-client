import { DEFAULT_POPUP_HEIGHT, DEFAULT_POPUP_WIDTH, DEFAULT_TIMEOUT_MS, NONCE_BYTE_LENGTH, POPUP_WINDOW_NAME, STATE_BYTE_LENGTH } from './constants';
import type { IIdpOAuth2ClientConfig, IIdpOAuth2Error, IIdpTokenResponse, IIdpUserInfo } from './types';
import { generatePkcePair } from './utils/pkce.util';
import { randomBase64Url } from './utils/base64url.util';
import { openCenteredPopup, waitForPopupMessage, writeLoadingState, navigatePopup } from './utils/popup.util';
import { consumePendingFlow, savePendingFlow } from './utils/pending-flow.store';
import { cleanRedirectCallbackUrl, readRedirectCallbackParams } from './utils/redirect-callback.util';
import { fetchDiscoveryDocument, IIdpDiscoveryDocument } from './utils/discovery.util';
import { decodeIdTokenPayload, validateIdTokenClaims } from './utils/id-token.util';

export class IdpOAuth2ApiError extends Error {
    constructor(public readonly errorBody: IIdpOAuth2Error) {
        super(errorBody.error_description ?? errorBody.error);
        this.name = 'IdpOAuth2ApiError';
    }
}

interface IAuthorizationRequest {
    authorizeUrl: string;
    state: string;
}

export class IdpOAuth2Client {
    private readonly redirectOrigin: string;
    /** Memoized so discovery is fetched at most once per client instance. */
    private endpointsPromise: Promise<IIdpDiscoveryDocument> | null = null;

    constructor(private readonly config: IIdpOAuth2ClientConfig) {
        this.redirectOrigin = new URL(config.redirectUri).origin;
    }

    /** Starts sign-in using the `uxMode` configured in the constructor (defaults to 'popup'). */
    async login(options?: { prompt?: string }): Promise<IIdpTokenResponse | void> {
        if (this.config.uxMode === 'redirect') return this.loginWithRedirect(options);
        return this.loginWithPopup(options);
    }

    /**
     * Opens the provider's consent/sign-in screen in a popup and resolves
     * with tokens once the user finishes. Must be called from a user gesture
     * (click handler) or the browser will block the popup — the popup itself
     * is opened synchronously (as `about:blank`, then navigated once PKCE
     * setup finishes) specifically so a `click -> await somethingElse() ->
     * loginWithPopup()` chain doesn't get Safari to silently block it.
     */
    async loginWithPopup(options?: { prompt?: string }): Promise<IIdpTokenResponse> {
        const popup = openCenteredPopup(
            'about:blank',
            POPUP_WINDOW_NAME,
            this.config.popupWidth ?? DEFAULT_POPUP_WIDTH,
            this.config.popupHeight ?? DEFAULT_POPUP_HEIGHT,
        );
        writeLoadingState(popup);

        let authorizeUrl: string;
        let state: string;
        try {
            ({ authorizeUrl, state } = await this.beginAuthorizationRequest(options?.prompt));
        } catch (error) {
            popup.close();
            throw error;
        }

        navigatePopup(popup, authorizeUrl);

        const message = await waitForPopupMessage(popup, this.redirectOrigin, state, this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

        if (message.error) {
            throw new IdpOAuth2ApiError({ error: message.error, error_description: message.error_description });
        }
        if (!message.code) {
            throw new IdpOAuth2ApiError({ error: 'invalid_response', error_description: 'Callback carried no authorization code' });
        }

        return this.finishAuthorizationCodeExchange(message.code, state);
    }

    /**
     * Navigates the whole page to the provider's sign-in screen — no popup
     * involved. The promise never resolves; the browser leaves this page.
     * Call `handleRedirectCallback()` on load of the page back at `redirectUri`.
     */
    async loginWithRedirect(options?: { prompt?: string }): Promise<void> {
        const { authorizeUrl } = await this.beginAuthorizationRequest(options?.prompt);
        window.location.assign(authorizeUrl);
    }

    /**
     * Call on page load at `redirectUri` when using `uxMode: 'redirect'`.
     * Returns `null` if the current URL isn't an OAuth2 callback (e.g. a
     * normal visit to that route), so it's safe to call unconditionally.
     */
    async handleRedirectCallback(): Promise<IIdpTokenResponse | null> {
        const params = readRedirectCallbackParams();
        if (!params.code && !params.error) return null;

        cleanRedirectCallbackUrl();

        if (params.error) {
            throw new IdpOAuth2ApiError({ error: params.error, error_description: params.errorDescription ?? undefined });
        }
        if (!params.state) {
            throw new IdpOAuth2ApiError({ error: 'invalid_request', error_description: 'Callback URL is missing state' });
        }

        return this.finishAuthorizationCodeExchange(params.code as string, params.state);
    }

    async refreshAccessToken(refreshToken: string): Promise<IIdpTokenResponse> {
        return this.postToken({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: this.config.clientId,
        });
    }

    async getUserInfo(accessToken: string): Promise<IIdpUserInfo> {
        const endpoints = await this.getEndpoints();
        const userinfoEndpoint = this.requireEndpoint(endpoints.userinfo_endpoint, 'userinfo_endpoint');
        const response = await fetch(userinfoEndpoint, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok) throw new IdpOAuth2ApiError(await this.parseErrorResponse(response));
        return response.json();
    }

    async revokeToken(token: string, tokenTypeHint?: 'access_token' | 'refresh_token'): Promise<void> {
        const endpoints = await this.getEndpoints();
        const revocationEndpoint = this.requireEndpoint(endpoints.revocation_endpoint, 'revocation_endpoint');
        const body = new URLSearchParams({ token, client_id: this.config.clientId });
        if (tokenTypeHint) body.set('token_type_hint', tokenTypeHint);
        // RFC 7009 — endpoint always returns 200, nothing to branch on.
        await fetch(revocationEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
    }

    /**
     * Discovery document, fetched once from `${issuerUrl}/.well-known/openid-configuration`
     * (RFC 8414) — or `config.endpoints` if the caller supplied it, skipping the
     * network round-trip (needed for providers without discovery support).
     */
    private getEndpoints(): Promise<IIdpDiscoveryDocument> {
        if (!this.endpointsPromise) {
            this.endpointsPromise = (this.config.endpoints ? Promise.resolve(this.config.endpoints) : fetchDiscoveryDocument(this.config.issuerUrl)).catch(
                (error: unknown) => {
                    // Only successful discovery is memoized — a rejected promise is still
                    // truthy, so without this the client would be stuck permanently after
                    // one transient discovery failure (e.g. a network blip).
                    this.endpointsPromise = null;
                    throw error;
                },
            );
        }
        return this.endpointsPromise;
    }

    /**
     * Parses an error response body as `IIdpOAuth2Error` JSON per RFC 6749 §5.2.
     * Falls back to a synthesized error instead of throwing a raw SyntaxError
     * when the body isn't JSON (a gateway/proxy in front of the provider
     * returning an HTML or plain-text error page is common enough in practice).
     */
    private async parseErrorResponse(response: Response): Promise<IIdpOAuth2Error> {
        const text = await response.text();
        try {
            return JSON.parse(text) as IIdpOAuth2Error;
        } catch {
            return { error: `http_${response.status}`, error_description: text.slice(0, 500) || response.statusText || 'Request failed with no error body' };
        }
    }

    private requireEndpoint(endpoint: string | undefined, endpointName: string): string {
        if (!endpoint) {
            throw new Error(`Provider's discovery document has no "${endpointName}" — pass config.endpoints.${endpointName} manually if this provider supports it under a non-standard name.`);
        }
        return endpoint;
    }

    /** Shared by popup and redirect: PKCE pair + state/nonce, persisted, turned into an authorize URL. */
    private async beginAuthorizationRequest(prompt?: string): Promise<IAuthorizationRequest> {
        const { codeVerifier, codeChallenge } = await generatePkcePair();
        const state = randomBase64Url(STATE_BYTE_LENGTH);
        const nonce = randomBase64Url(NONCE_BYTE_LENGTH);

        const authorizeUrl = await this.buildAuthorizeUrl(state, nonce, codeChallenge, prompt);
        savePendingFlow(state, codeVerifier, nonce);

        return { authorizeUrl, state };
    }

    /** Shared by popup and redirect: look up the saved verifier for `state`, then exchange the code. */
    private async finishAuthorizationCodeExchange(code: string, state: string): Promise<IIdpTokenResponse> {
        const pendingFlow = consumePendingFlow(state);
        if (!pendingFlow) {
            throw new IdpOAuth2ApiError({ error: 'invalid_state', error_description: 'No matching pending flow for this state — possible CSRF or expired session' });
        }
        const tokens = await this.exchangeCodeForTokens(code, pendingFlow.codeVerifier);
        if (tokens.id_token) {
            await this.validateIdToken(tokens.id_token, pendingFlow.nonce);
        }
        return tokens;
    }

    /**
     * Claim-level validation only (nonce/aud/iss/exp) — does not verify the
     * id_token's signature. See `validateIdTokenClaims` doc comment for why.
     * Throws `IdTokenValidationError` if any check fails.
     */
    private async validateIdToken(idToken: string, expectedNonce: string): Promise<void> {
        const endpoints = await this.getEndpoints();
        const claims = decodeIdTokenPayload(idToken);
        validateIdTokenClaims(claims, { nonce: expectedNonce, clientId: this.config.clientId, issuer: endpoints.issuer });
    }

    private async buildAuthorizeUrl(state: string, nonce: string, codeChallenge: string, prompt?: string): Promise<string> {
        const endpoints = await this.getEndpoints();
        const params = new URLSearchParams({
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            response_type: 'code',
            scope: this.config.scope,
            state,
            nonce,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        });
        if (prompt) params.set('prompt', prompt);
        return `${endpoints.authorization_endpoint}?${params.toString()}`;
    }

    private async exchangeCodeForTokens(code: string, codeVerifier: string): Promise<IIdpTokenResponse> {
        return this.postToken({
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.config.redirectUri,
            client_id: this.config.clientId,
            code_verifier: codeVerifier,
        });
    }

    /** Public client (SPA) — no client_secret; PKCE (auth code) or refresh_token grant only. */
    private async postToken(params: Record<string, string>): Promise<IIdpTokenResponse> {
        const endpoints = await this.getEndpoints();
        const response = await fetch(endpoints.token_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(params),
        });
        if (!response.ok) throw new IdpOAuth2ApiError(await this.parseErrorResponse(response));
        return response.json();
    }
}
