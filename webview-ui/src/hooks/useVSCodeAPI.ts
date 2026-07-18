import { useEffect } from "react";

type IncomingMessage = {
  type: string;
  payload?: unknown;
};

type Handler = (event: IncomingMessage) => void;

declare global {
  interface Window {
    acquireVsCodeApi?: () => { postMessage: (message: unknown) => void };
  }
}

const vscode = window.acquireVsCodeApi?.();

export function useVSCodeAPI(onMessage: Handler): {
  postMessage: (message: unknown) => void;
} {
  useEffect(() => {
    const listener = (event: MessageEvent<IncomingMessage>) => {
      // eslint-disable-next-line no-console
      console.log("[Webview] Received:", event.data?.type, event.data?.payload);
      onMessage(event.data);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [onMessage]);

  return {
    postMessage(message: unknown) {
      const msg = message as { type?: string; payload?: unknown };
      // eslint-disable-next-line no-console
      console.log("[Webview] Sending:", msg.type, msg.payload);
      vscode?.postMessage(message);
    },
  };
}
