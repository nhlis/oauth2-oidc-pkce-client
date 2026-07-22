const WELL_KNOWN_DISCOVERY_PATH = '/.well-known/openid-configuration';

/**
 * Subset of RFC 8414 / OIDC Discovery 1.0 provider metadata this package
 * needs. Any OIDC-compliant provider (not just this IdP) exposes this at
 * `${issuer}/.well-known/openid-configuration` — matches WellKnownController.
 */
export interface IIdpDiscoveryDocument {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint?: string;
    revocation_endpoint?: string;
    introspection_endpoint?: string;
}

export async function fetchDiscoveryDocument(issuerUrl: string): Promise<IIdpDiscoveryDocument> {
    const discoveryUrl = `${issuerUrl}${WELL_KNOWN_DISCOVERY_PATH}`;
    const response = await fetch(discoveryUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch OIDC discovery document from ${discoveryUrl} (HTTP ${response.status})`);
    }
    return response.json();
}
