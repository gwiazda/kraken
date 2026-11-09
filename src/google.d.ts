// Minimal type declarations for the two Google scripts Kraken loads at runtime:
// Google Identity Services (sign-in) and the Google Picker. Only what Kraken uses is declared.

declare namespace google.accounts.oauth2 {
  interface TokenResponse {
    access_token?: string;
    expires_in?: number | string;
    scope?: string;
    error?: string;
    error_description?: string;
  }
  interface ClientConfigError {
    type: string; // for example 'popup_closed' or 'popup_failed_to_open'
    message?: string;
  }
  interface TokenClientConfig {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: ClientConfigError) => void;
  }
  interface OverridableTokenClientConfig {
    prompt?: '' | 'none' | 'consent' | 'select_account';
  }
  interface TokenClient {
    requestAccessToken(overrides?: OverridableTokenClientConfig): void;
  }
  function initTokenClient(config: TokenClientConfig): TokenClient;
  function hasGrantedAllScopes(response: TokenResponse, firstScope: string, ...rest: string[]): boolean;
}

declare namespace google.picker {
  type ViewIdValue = string;
  const ViewId: { SPREADSHEETS: ViewIdValue };
  const DocsViewMode: { LIST: string; GRID: string };
  class DocsView {
    constructor(viewId?: ViewIdValue);
    setMode(mode: string): DocsView;
    setIncludeFolders(include: boolean): DocsView;
  }
  interface PickedDocument {
    id: string;
    name?: string;
  }
  interface ResponseObject {
    action: string; // 'picked', 'cancel' or 'loaded'
    docs?: PickedDocument[];
  }
  interface Picker {
    setVisible(visible: boolean): Picker;
    dispose(): void;
  }
  class PickerBuilder {
    addView(view: DocsView): PickerBuilder;
    setOAuthToken(token: string): PickerBuilder;
    setDeveloperKey(key: string): PickerBuilder;
    setAppId(appId: string): PickerBuilder;
    setTitle(title: string): PickerBuilder;
    setCallback(callback: (data: ResponseObject) => void): PickerBuilder;
    build(): Picker;
  }
}

declare namespace gapi {
  interface LoadConfig {
    callback: () => void;
    onerror?: () => void;
    timeout?: number;
    ontimeout?: () => void;
  }
  function load(library: string, config: (() => void) | LoadConfig): void;
}
