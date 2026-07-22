import type { IIdpDiscoveryDocument } from './utils/discovery.util';

export interface IIdpOAuth2ClientConfig {
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

export interface IIdpTokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    scope: string;
    refresh_token?: string;
    id_token?: string;
}

export interface IIdpUserInfo {
    sub: string;
    email?: string;
    email_verified?: boolean;
    given_name?: string;
    family_name?: string;
    picture?: string;
    phone_number?: string;
    address?: string;
}

export interface IIdpOAuth2Error {
    error: string;
    error_description?: string;
}

export const IDP_OAUTH2_MESSAGE_SOURCE = 'idp-oauth2-popup-callback' as const;

/** Message shape posted by the callback page (hosted at redirectUri) back to the opener. */
export interface IIdpOAuth2CallbackMessage {
    source: typeof IDP_OAUTH2_MESSAGE_SOURCE;
    state: string | null;
    code?: string;
    error?: string;
    error_description?: string;
}
