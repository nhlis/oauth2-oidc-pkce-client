import { fromBase64Url } from './base64url.util';

/** Clock skew tolerated when checking `exp`, to absorb small drift between client and provider clocks. */
const EXP_CLOCK_SKEW_TOLERANCE_S = 60;

export class IdTokenValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'IdTokenValidationError';
    }
}

/** Claims this package reads off the id_token. Providers commonly send more; those pass through untyped. */
export interface IIdTokenClaims {
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
export function decodeIdTokenPayload(idToken: string): IIdTokenClaims {
    const segments = idToken.split('.');
    if (segments.length !== 3) {
        throw new IdTokenValidationError('id_token is not a well-formed JWT (expected header.payload.signature)');
    }
    try {
        const json = new TextDecoder().decode(fromBase64Url(segments[1]));
        return JSON.parse(json) as IIdTokenClaims;
    } catch {
        throw new IdTokenValidationError('id_token payload could not be decoded as JSON');
    }
}

/**
 * Validates the claims of a decoded id_token per OIDC Core §3.1.3.7:
 * - `nonce` matches the value generated for this authorization request
 *   (mandatory per spec whenever the client sent a nonce, which this
 *   package always does) — the primary defense against token replay.
 * - `aud` includes this client's `client_id`.
 * - `iss` matches the provider's issuer.
 * - `exp` is in the future (within a small clock-skew tolerance).
 *
 * What this does NOT do: verify the JWS signature. Full verification needs
 * the provider's JWKS (fetch + cache keys, match `kid`, allow-list algorithms
 * to avoid "alg: none" / confusion attacks) — a meaningfully bigger addition
 * than claim-checking, and this package instead leans on the fact that the
 * id_token arrives via a direct HTTPS call to `token_endpoint` (back-channel),
 * not through a browser redirect, so there's no point in transit where it
 * could be swapped. If your threat model needs signature verification too
 * (e.g. a FAPI-style profile), verify server-side, or treat this as a known
 * gap to fill in separately.
 *
 * Throws `IdTokenValidationError` on the first failing check.
 */
export function validateIdTokenClaims(claims: IIdTokenClaims, expected: { nonce: string; clientId: string; issuer: string }): void {
    if (claims.nonce !== expected.nonce) {
        throw new IdTokenValidationError('id_token nonce does not match the value sent in the authorization request — possible replay');
    }

    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(expected.clientId)) {
        throw new IdTokenValidationError('id_token audience does not include this client_id');
    }

    if (claims.iss !== expected.issuer) {
        throw new IdTokenValidationError(`id_token issuer "${claims.iss}" does not match expected issuer "${expected.issuer}"`);
    }

    const nowSeconds = Date.now() / 1000;
    if (typeof claims.exp !== 'number' || nowSeconds > claims.exp + EXP_CLOCK_SKEW_TOLERANCE_S) {
        throw new IdTokenValidationError('id_token has expired');
    }
}
