import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openCenteredPopup, waitForPopupMessage, writeLoadingState, navigatePopup, PopupBlockedError, PopupClosedByUserError, PopupTimeoutError } from './popup.util';
import { IDP_OAUTH2_MESSAGE_SOURCE } from '../types';
import { POPUP_POLL_INTERVAL_MS } from '../constants';

function fakePopup(): Window & { close: ReturnType<typeof vi.fn>; closed: boolean } {
    return { closed: false, close: vi.fn() } as unknown as Window & { close: ReturnType<typeof vi.fn>; closed: boolean };
}

function postMessage(data: unknown, origin: string) {
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

describe('openCenteredPopup', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('opens a centered popup and returns it', () => {
        const popup = fakePopup();
        const openMock = vi.fn().mockReturnValue(popup);
        vi.stubGlobal('open', openMock);

        const result = openCenteredPopup('https://idp.example/authorize?x=1', 'my_popup', 480, 640);

        expect(result).toBe(popup);
        expect(openMock).toHaveBeenCalledTimes(1);
        const [url, name, features] = openMock.mock.calls[0];
        expect(url).toBe('https://idp.example/authorize?x=1');
        expect(name).toBe('my_popup');
        expect(features).toContain('width=480');
        expect(features).toContain('height=640');
    });

    it('throws PopupBlockedError when window.open returns null (popup blocker)', () => {
        vi.stubGlobal('open', vi.fn().mockReturnValue(null));
        expect(() => openCenteredPopup('https://idp.example/authorize', 'my_popup', 480, 640)).toThrow(PopupBlockedError);
    });
});

describe('writeLoadingState', () => {
    it('sets a title and placeholder text on the popup document', () => {
        const popup = { document: { title: '', body: { style: {} as CSSStyleDeclaration, textContent: '' } } } as unknown as Window;
        writeLoadingState(popup);
        expect(popup.document.title).toBe('Signing in…');
        expect(popup.document.body.textContent).toBe('Loading…');
    });

    it('never throws even if the popup document is inaccessible', () => {
        const hostile = {
            get document(): never {
                throw new Error('cross-origin access denied');
            },
        } as unknown as Window;
        expect(() => writeLoadingState(hostile)).not.toThrow();
    });
});

describe('navigatePopup', () => {
    it('navigates the popup to the given URL', () => {
        const assign = vi.fn();
        const popup = { location: { assign } } as unknown as Window;
        navigatePopup(popup, 'https://idp.example/authorize?x=1');
        expect(assign).toHaveBeenCalledWith('https://idp.example/authorize?x=1');
    });

    it('normalizes a navigation failure (e.g. popup closed in the interim) to PopupClosedByUserError', () => {
        const popup = {
            location: {
                assign: () => {
                    throw new Error('some browser-specific error about a closed window');
                },
            },
        } as unknown as Window;
        expect(() => navigatePopup(popup, 'https://idp.example/authorize')).toThrow(PopupClosedByUserError);
    });
});

describe('waitForPopupMessage', () => {
    const expectedOrigin = 'https://idp-app.example';
    const expectedState = 'state-123';

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('resolves with the message and closes the popup when a matching message arrives', async () => {
        const popup = fakePopup();
        const promise = waitForPopupMessage(popup, expectedOrigin, expectedState, 60_000);

        postMessage({ source: IDP_OAUTH2_MESSAGE_SOURCE, state: expectedState, code: 'auth-code' }, expectedOrigin);

        await expect(promise).resolves.toEqual({ source: IDP_OAUTH2_MESSAGE_SOURCE, state: expectedState, code: 'auth-code' });
        expect(popup.close).toHaveBeenCalledTimes(1);
    });

    it('ignores messages from the wrong origin', async () => {
        const popup = fakePopup();
        const promise = waitForPopupMessage(popup, expectedOrigin, expectedState, 60_000);

        postMessage({ source: IDP_OAUTH2_MESSAGE_SOURCE, state: expectedState, code: 'auth-code' }, 'https://attacker.example');
        postMessage({ source: IDP_OAUTH2_MESSAGE_SOURCE, state: expectedState, code: 'auth-code' }, expectedOrigin);

        await expect(promise).resolves.toMatchObject({ code: 'auth-code' });
    });

    it('ignores messages that are not this library\'s callback message shape', async () => {
        const popup = fakePopup();
        const promise = waitForPopupMessage(popup, expectedOrigin, expectedState, 60_000);

        postMessage({ some: 'unrelated payload' }, expectedOrigin);
        postMessage({ source: IDP_OAUTH2_MESSAGE_SOURCE, state: expectedState, code: 'auth-code' }, expectedOrigin);

        await expect(promise).resolves.toMatchObject({ code: 'auth-code' });
    });

    it('ignores messages carrying a different state (stale/foreign flow)', async () => {
        const popup = fakePopup();
        const promise = waitForPopupMessage(popup, expectedOrigin, expectedState, 60_000);

        postMessage({ source: IDP_OAUTH2_MESSAGE_SOURCE, state: 'some-other-state', code: 'auth-code' }, expectedOrigin);
        postMessage({ source: IDP_OAUTH2_MESSAGE_SOURCE, state: expectedState, code: 'auth-code' }, expectedOrigin);

        await expect(promise).resolves.toMatchObject({ code: 'auth-code' });
    });

    it('rejects with PopupClosedByUserError when the popup is closed before completion', async () => {
        const popup = fakePopup();
        const promise = waitForPopupMessage(popup, expectedOrigin, expectedState, 60_000);
        const assertion = expect(promise).rejects.toThrow(PopupClosedByUserError);

        popup.closed = true;
        await vi.advanceTimersByTimeAsync(POPUP_POLL_INTERVAL_MS);

        await assertion;
    });

    it('rejects with PopupTimeoutError and closes the popup once timeoutMs elapses', async () => {
        const popup = fakePopup();
        const promise = waitForPopupMessage(popup, expectedOrigin, expectedState, 5_000);
        const assertion = expect(promise).rejects.toThrow(PopupTimeoutError);

        await vi.advanceTimersByTimeAsync(5_000);

        await assertion;
        expect(popup.close).toHaveBeenCalledTimes(1);
    });

    it('does not reject on timeout after already resolving', async () => {
        const popup = fakePopup();
        const promise = waitForPopupMessage(popup, expectedOrigin, expectedState, 5_000);

        postMessage({ source: IDP_OAUTH2_MESSAGE_SOURCE, state: expectedState, code: 'auth-code' }, expectedOrigin);
        await expect(promise).resolves.toMatchObject({ code: 'auth-code' });

        // Popup already closed itself as part of resolving; closing timers afterward must not throw or double-close.
        await vi.advanceTimersByTimeAsync(10_000);
        expect(popup.close).toHaveBeenCalledTimes(1);
    });
});
