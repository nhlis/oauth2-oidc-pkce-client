/**
 * Subset of RFC 8414 / OIDC Discovery 1.0 provider metadata this package
 * needs. Any OIDC-compliant provider (not just this IdP) exposes this at
 * `${issuer}/.well-known/openid-configuration` — matches WellKnownController.
 */
interface IIdpDiscoveryDocument {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint?: string;
    revocation_endpoint?: string;
    introspection_endpoint?: string;
}
declare function fetchDiscoveryDocument(issuerUrl: string): Promise<IIdpDiscoveryDocument>;

interface IIdpOAuth2ClientConfig {
    /** OAuth2 client_id registered with the provider. */
    clientId: string;
    /**
     * Provider's issuer URL, e.g. https://idp.example.com. Used to fetch
     * `${issuerUrl}/.well-known/openid-configuration` (RFC 8414) unless
     * `endpoints` is supplied to skip discovery.
     */
    issuerUrl: string;
    /** Must be an allow-listed redirect URI for this client, on YOUR app's origin. */
    redirectUri: string;
    /** Space-separated scopes, e.g. "openid profile email". */
    scope: string;
    /**
     * Skip OIDC discovery and use these endpoints directly — for providers
     * that don't expose `.well-known/openid-configuration`, or to save the
     * extra discovery round-trip. Shape matches the discovery document.
     */
    endpoints?: IIdpDiscoveryDocument;
    /** Popup window size. Defaults to 480x640. */
    popupWidth?: number;
    popupHeight?: number;
    /** Milliseconds to wait for the user to finish the popup flow. Defaults to 5 minutes. */
    timeoutMs?: number;
    /**
     * 'popup' (default) opens the IdP in a popup and resolves `login()` with tokens.
     * 'redirect' navigates the whole page away; call `handleRedirectCallback()`
     * on page load back at `redirectUri` to finish the exchange.
     */
    uxMode?: 'popup' | 'redirect';
}
interface IIdpTokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
    refresh_token?: string;
    id_token?: string;
}
interface IIdpUserInfo {
    sub: string;
    email?: string;
    email_verified?: boolean;
    given_name?: string;
    family_name?: string;
    picture?: string;
    phone_number?: string;
    address?: string;
}
interface IIdpOAuth2Error {
    error: string;
    error_description?: string;
}

declare class IdpOAuth2ApiError extends Error {
    readonly errorBody: IIdpOAuth2Error;
    constructor(errorBody: IIdpOAuth2Error);
}
declare class IdpOAuth2Client {
    private readonly config;
    private readonly redirectOrigin;
    /** Memoized so discovery is fetched at most once per client instance. */
    private endpointsPromise;
    constructor(config: IIdpOAuth2ClientConfig);
    /** Starts sign-in using the `uxMode` configured in the constructor (defaults to 'popup'). */
    login(options?: {
        prompt?: string;
    }): Promise<IIdpTokenResponse | void>;
    /**
     * Opens the provider's consent/sign-in screen in a popup and resolves
     * with tokens once the user finishes. Must be called from a user gesture
     * (click handler) or the browser will block the popup — the popup itself
     * is opened synchronously (as `about:blank`, then navigated once PKCE
     * setup finishes) specifically so a `click -> await somethingElse() ->
     * loginWithPopup()` chain doesn't get Safari to silently block it.
     */
    loginWithPopup(options?: {
        prompt?: string;
    }): Promise<IIdpTokenResponse>;
    /**
     * Navigates the whole page to the provider's sign-in screen — no popup
     * involved. The promise never resolves; the browser leaves this page.
     * Call `handleRedirectCallback()` on load of the page back at `redirectUri`.
     */
    loginWithRedirect(options?: {
        prompt?: string;
    }): Promise<void>;
    /**
     * Call on page load at `redirectUri` when using `uxMode: 'redirect'`.
     * Returns `null` if the current URL isn't an OAuth2 callback (e.g. a
     * normal visit to that route), so it's safe to call unconditionally.
     */
    handleRedirectCallback(): Promise<IIdpTokenResponse | null>;
    refreshAccessToken(refreshToken: string): Promise<IIdpTokenResponse>;
    getUserInfo(accessToken: string): Promise<IIdpUserInfo>;
    revokeToken(token: string, tokenTypeHint?: 'access_token' | 'refresh_token'): Promise<void>;
    /**
     * Discovery document, fetched once from `${issuerUrl}/.well-known/openid-configuration`
     * (RFC 8414) — or `config.endpoints` if the caller supplied it, skipping the
     * network round-trip (needed for providers without discovery support).
     */
    private getEndpoints;
    /**
     * Parses an error response body as `IIdpOAuth2Error` JSON per RFC 6749 §5.2.
     * Falls back to a synthesized error instead of throwing a raw SyntaxError
     * when the body isn't JSON (a gateway/proxy in front of the provider
     * returning an HTML or plain-text error page is common enough in practice).
     */
    private parseErrorResponse;
    private requireEndpoint;
    /** Shared by popup and redirect: PKCE pair + state/nonce, persisted, turned into an authorize URL. */
    private beginAuthorizationRequest;
    /** Shared by popup and redirect: look up the saved verifier for `state`, then exchange the code. */
    private finishAuthorizationCodeExchange;
    /**
     * Claim-level validation only (nonce/aud/iss/exp) — does not verify the
     * id_token's signature. See `validateIdTokenClaims` doc comment for why.
     * Throws `IdTokenValidationError` if any check fails.
     */
    private validateIdToken;
    private buildAuthorizeUrl;
    private exchangeCodeForTokens;
    /** Public client (SPA) — no client_secret; PKCE (auth code) or refresh_token grant only. */
    private postToken;
}

declare class PopupBlockedError extends Error {
    constructor();
}
declare class PopupClosedByUserError extends Error {
    constructor();
}
declare class PopupTimeoutError extends Error {
    constructor();
}

declare class IdTokenValidationError extends Error {
    constructor(message: string);
}
/** Claims this package reads off the id_token. Providers commonly send more; those pass through untyped. */
interface IIdTokenClaims {
    iss: string;
    aud: string | string[];
    sub: string;
    exp: number;
    iat: number;
    nonce?: string;
    [claim: string]: unknown;
}
/**
 * Decodes the payload segment of a JWT id_token. This does NOT verify the
 * token's signature — see `validateIdTokenClaims` doc comment for why. Throws
 * `IdTokenValidationError` if the token isn't a well-formed JWT or the
 * payload isn't valid JSON.
 */
declare function decodeIdTokenPayload(idToken: string): IIdTokenClaims;

export { type IIdTokenClaims, type IIdpDiscoveryDocument, type IIdpOAuth2ClientConfig, type IIdpOAuth2Error, type IIdpTokenResponse, type IIdpUserInfo, IdTokenValidationError, IdpOAuth2ApiError, IdpOAuth2Client, PopupBlockedError, PopupClosedByUserError, PopupTimeoutError, decodeIdTokenPayload, fetchDiscoveryDocument };
