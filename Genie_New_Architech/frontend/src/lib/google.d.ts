export {};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
          }): void;
          renderButton(element: HTMLElement, options: Record<string, string>): void;
          prompt(): void;
          disableAutoSelect(): void;
        };
      };
    };
  }
}
