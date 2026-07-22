import { describe, it, expect } from 'vitest';
import { toBase64Url } from './base64url.util';
import { decodeIdTokenPayload, validateIdTokenClaims, IdTokenValidationError, type IIdTokenClaims } from './id-token.util';

/** Builds a syntactically-valid JWT string (unsigned) carrying the given payload. */
function fakeJwt(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', typ: 'JWT' }): string {
    const encode = (obj: Record<string, unknown>) => toBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
    return `${encode(header)}.${encode(payload)}.fake-signature`;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('decodeIdTokenPayload', () => {
    it('decodes the middle segment as JSON claims', () => {
        const token = fakeJwt({ sub: 'user-1', iss: 'https://idp.example', aud: 'client-1', exp: nowSeconds() + 60, iat: nowSeconds() });
        const claims = decodeIdTokenPayload(token);
        expect(claims.sub).toBe('user-1');
        expect(claims.iss).toBe('https://idp.example');
    });

    it('throws IdTokenValidationError when the token does not have 3 segments', () => {
        expect(() => decodeIdTokenPayload('not-a-jwt')).toThrow(IdTokenValidationError);
        expect(() => decodeIdTokenPayload('only.two')).toThrow(IdTokenValidationError);
        expect(() => decodeIdTokenPayload('a.b.c.d')).toThrow(IdTokenValidationError);
    });

    it('throws IdTokenValidationError when the payload segment is not valid JSON', () => {
        const notJson = toBase64Url(new TextEncoder().encode('this is not json'));
        expect(() => decodeIdTokenPayload(`header.${notJson}.sig`)).toThrow(IdTokenValidationError);
    });
});

describe('validateIdTokenClaims', () => {
    const expected = { nonce: 'expected-nonce', clientId: 'client-1', issuer: 'https://idp.example' };

    function validClaims(overrides: Partial<IIdTokenClaims> = {}): IIdTokenClaims {
        return {
            iss: expected.issuer,
            aud: expected.clientId,
            sub: 'user-1',
            exp: nowSeconds() + 300,
            iat: nowSeconds(),
            nonce: expected.nonce,
            ...overrides,
        };
    }

    it('passes for claims matching nonce, audience, issuer, and a future expiry', () => {
        expect(() => validateIdTokenClaims(validClaims(), expected)).not.toThrow();
    });

    it('accepts an array audience that includes the client_id', () => {
        expect(() => validateIdTokenClaims(validClaims({ aud: ['other-client', expected.clientId] }), expected)).not.toThrow();
    });

    it('rejects a mismatched nonce (the replay-protection check)', () => {
        expect(() => validateIdTokenClaims(validClaims({ nonce: 'wrong-nonce' }), expected)).toThrow(IdTokenValidationError);
        expect(() => validateIdTokenClaims(validClaims({ nonce: undefined }), expected)).toThrow(/nonce/i);
    });

    it('rejects when the client_id is not in the audience', () => {
        expect(() => validateIdTokenClaims(validClaims({ aud: 'someone-else' }), expected)).toThrow(/audience/i);
        expect(() => validateIdTokenClaims(validClaims({ aud: ['someone-else', 'another'] }), expected)).toThrow(/audience/i);
    });

    it('rejects a mismatched issuer', () => {
        expect(() => validateIdTokenClaims(validClaims({ iss: 'https://evil.example' }), expected)).toThrow(/issuer/i);
    });

    it('rejects an expired token', () => {
        expect(() => validateIdTokenClaims(validClaims({ exp: nowSeconds() - 3600 }), expected)).toThrow(/expired/i);
    });

    it('tolerates small clock skew just past expiry', () => {
        // 30s past exp is inside the 60s tolerance window.
        expect(() => validateIdTokenClaims(validClaims({ exp: nowSeconds() - 30 }), expected)).not.toThrow();
    });

    it('rejects a missing/non-numeric exp claim', () => {
        expect(() => validateIdTokenClaims(validClaims({ exp: undefined as unknown as number }), expected)).toThrow(/expired/i);
    });
});
