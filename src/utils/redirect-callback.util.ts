const REDIRECT_CALLBACK_PARAM_KEYS = ['code', 'state', 'scope', 'error', 'error_description'] as const;

export interface IRedirectCallbackParams {
    code: string | null;
    state: string | null;
    error: string | null;
    errorDescription: string | null;
}

export function readRedirectCallbackParams(): IRedirectCallbackParams {
    const params = new URLSearchParams(window.location.search);
    return {
        code: params.get('code'),
        state: params.get('state'),
        error: params.get('error'),
        errorDescription: params.get('error_description'),
    };
}

/** Strips OAuth2 params from the visible URL so refreshing the page can't re-submit the same code. */
export function cleanRedirectCallbackUrl(): void {
    const url = new URL(window.location.href);
    for (const key of REDIRECT_CALLBACK_PARAM_KEYS) url.searchParams.delete(key);
    window.history.replaceState({}, document.title, url.toString());
}
