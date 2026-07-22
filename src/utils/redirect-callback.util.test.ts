import { describe, it, expect, afterEach } from 'vitest';
import { readRedirectCallbackParams, cleanRedirectCallbackUrl } from './redirect-callback.util';

function setUrl(url: string) {
    window.history.pushState({}, '', url);
}

afterEach(() => {
    setUrl('/oauth2/callback');
});

describe('readRedirectCallbackParams', () => {
    it('reads code and state off the query string', () => {
        setUrl('/oauth2/callback?code=abc123&state=xyz789');
        const params = readRedirectCallbackParams();
        expect(params.code).toBe('abc123');
        expect(params.state).toBe('xyz789');
        expect(params.error).toBeNull();
        expect(params.errorDescription).toBeNull();
    });

    it('reads error and error_description when the provider rejects the request', () => {
        setUrl('/oauth2/callback?error=access_denied&error_description=User+cancelled');
        const params = readRedirectCallbackParams();
        expect(params.error).toBe('access_denied');
        expect(params.errorDescription).toBe('User cancelled');
        expect(params.code).toBeNull();
    });

    it('returns all nulls on a plain page visit with no OAuth2 params', () => {
        setUrl('/oauth2/callback');
        const params = readRedirectCallbackParams();
        expect(params).toEqual({ code: null, state: null, error: null, errorDescription: null });
    });
});

describe('cleanRedirectCallbackUrl', () => {
    it('strips OAuth2 params but preserves unrelated query params and the path', () => {
        setUrl('/oauth2/callback?code=abc&state=xyz&scope=openid&foo=bar');
        cleanRedirectCallbackUrl();

        const url = new URL(window.location.href);
        expect(url.pathname).toBe('/oauth2/callback');
        expect(url.searchParams.get('code')).toBeNull();
        expect(url.searchParams.get('state')).toBeNull();
        expect(url.searchParams.get('scope')).toBeNull();
        expect(url.searchParams.get('foo')).toBe('bar');
    });

    it('does not push a new history entry (uses replaceState)', () => {
        setUrl('/oauth2/callback?code=abc&state=xyz');
        const lengthBefore = window.history.length;
        cleanRedirectCallbackUrl();
        expect(window.history.length).toBe(lengthBefore);
    });
});
