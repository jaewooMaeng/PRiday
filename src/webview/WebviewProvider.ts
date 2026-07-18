import * as vscode from "vscode";
import type { LLMConfig } from "../types/llm";
import type { AnalysisResult } from "../analysis/AnalysisEngine";

type MessageHandler = {
  onHighlightCode: (payload: {
    filename: string;
    lineStart: number;
    lineEnd: number;
    confidence?: number;
  }) => void | Promise<void>;
  onUpdateLLMConfig: (payload: LLMConfig) => void | Promise<void>;
  onUpdateSecrets: (payload: {
    provider?: LLMConfig["provider"];
    llmApiKey?: string;
    githubToken?: string;
  }) => void | Promise<void>;
  onTestConnection: (payload: LLMConfig) => void | Promise<void>;
  onReanalyze: () => void | Promise<void>;
  onClearHighlight: () => void | Promise<void>;
  onChat: (payload: { message: string }) => void | Promise<void>;
  onPostComment: (payload: {
    body: string;
    filename?: string;
    line?: number;
  }) => void | Promise<void>;
};

export class WebviewProvider {
  public static readonly viewType = "aiPrInsight";
  private panel: vscode.WebviewPanel | undefined;
  private handlers: MessageHandler | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  public setMessageHandlers(handlers: MessageHandler): void {
    this.handlers = handlers;
  }

  public show(prNumber: string): vscode.WebviewPanel {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return this.panel;
    }

    const column = vscode.window.activeTextEditor
      ? vscode.ViewColumn.Beside
      : vscode.ViewColumn.One;

    this.panel = vscode.window.createWebviewPanel(
      WebviewProvider.viewType,
      `AI PR Insight: PR #${prNumber}`,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "webview-dist")],
      }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((event: { type: string; payload?: unknown }) => {
      this.handleWebviewMessage(event);
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    return this.panel;
  }

  public postProgress(
    stage: "fetching_pr" | "calling_llm" | "parsing_ast" | "building_map",
    progress: number
  ): void {
    this.panel?.webview.postMessage({
      type: "analysisProgress",
      payload: { stage, progress },
    });
  }

  public postError(message: string): void {
    this.panel?.webview.postMessage({
      type: "analysisError",
      payload: { message },
    });
  }

  public postAnalysisResult(payload: AnalysisResult): void {
    this.panel?.webview.postMessage({ type: "analysisResult", payload });
  }

  public postLLMConfig(payload: LLMConfig): void {
    this.panel?.webview.postMessage({ type: "llmConfig", payload });
  }

  public postSummaryHighlight(summaryBlockId: string, sentenceIndex: number): void {
    this.panel?.webview.postMessage({
      type: "highlightSummary",
      payload: { summaryBlockId, sentenceIndex },
    });
  }

  public postChatResponse(message: string): void {
    this.panel?.webview.postMessage({
      type: "chatResponse",
      payload: { message },
    });
  }

  public postCommentResult(success: boolean, error?: string): void {
    this.panel?.webview.postMessage({
      type: "commentResult",
      payload: { success, error },
    });
  }

  private handleWebviewMessage(event: { type: string; payload?: unknown }): void {
    if (!this.handlers) return;
    switch (event.type) {
      case "highlightCode":
        void this.handlers.onHighlightCode(
          event.payload as { filename: string; lineStart: number; lineEnd: number; confidence?: number }
        );
        break;
      case "updateLLMConfig":
        void this.handlers.onUpdateLLMConfig(event.payload as LLMConfig);
        break;
      case "updateSecrets":
        void this.handlers.onUpdateSecrets(
          event.payload as {
            provider?: LLMConfig["provider"];
            llmApiKey?: string;
            githubToken?: string;
          }
        );
        break;
      case "testConnection":
        void this.handlers.onTestConnection(event.payload as LLMConfig);
        break;
      case "reanalyze":
        void this.handlers.onReanalyze();
        break;
      case "clearHighlight":
        void this.handlers.onClearHighlight();
        break;
      case "chat":
        void this.handlers.onChat(event.payload as { message: string });
        break;
      case "postComment":
        void this.handlers.onPostComment(
          event.payload as { body: string; filename?: string; line?: number }
        );
        break;
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview-dist", "bundle.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "webview-dist", "bundle.css")
    );
    const nonce = String(Date.now());

    return `<!DOCTYPE html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline' ${
        webview.cspSource
      }; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>AI PR Insight</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
