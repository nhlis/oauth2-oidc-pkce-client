import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleOAuth2PopupCallback } from './callback';
import { IDP_OAUTH2_MESSAGE_SOURCE } from './types';

function setUrl(url: string) {
    window.history.pushState({}, '', url);
}

function setOpener(opener: { postMessage: (message: unknown, targetOrigin: string) => void } | null) {
    Object.defineProperty(window, 'opener', { value: opener, configurable: true, writable: true });
}

afterEach(() => {
    setOpener(null);
    setUrl('/oauth2/callback');
});

describe('handleOAuth2PopupCallback', () => {
    it('does nothing when there is no window.opener (page opened directly)', () => {
        setOpener(null);
        expect(() => handleOAuth2PopupCallback()).not.toThrow();
    });

    it('posts code/state back to the opener, scoped to this page origin', () => {
        setUrl('/oauth2/callback?code=abc123&state=xyz789');
        const postMessage = vi.fn();
        setOpener({ postMessage });

        handleOAuth2PopupCallback();

        expect(postMessage).toHaveBeenCalledTimes(1);
        const [message, targetOrigin] = postMessage.mock.calls[0];
        expect(message).toEqual({
            source: IDP_OAUTH2_MESSAGE_SOURCE,
            state: 'xyz789',
            code: 'abc123',
            error: undefined,
            error_description: undefined,
        });
        expect(targetOrigin).toBe(window.location.origin);
    });

    it('forwards error/error_description instead of a code', () => {
        setUrl('/oauth2/callback?error=access_denied&error_description=nope&state=xyz789');
        const postMessage = vi.fn();
        setOpener({ postMessage });

        handleOAuth2PopupCallback();

        const [message] = postMessage.mock.calls[0];
        expect(message.error).toBe('access_denied');
        expect(message.error_description).toBe('nope');
        expect(message.code).toBeUndefined();
    });
});
