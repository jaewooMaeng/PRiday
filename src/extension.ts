import * as vscode from "vscode";
import {
  analyzePRCommand,
  bindWebviewHandlers,
  setLLMApiKeyCommand,
  setLLMModelCommand,
  setLLMProviderCommand,
  setGitHubTokenCommand,
} from "./commands/analyzePR";
import { EditorController } from "./editor/EditorController";
import { ASTParser } from "./analysis/ASTParser";
import { getLogger } from "./utils/logger";
import { WebviewProvider } from "./webview/WebviewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const log = getLogger();
  const webviewProvider = new WebviewProvider(context.extensionUri);
  const editorController = new EditorController();

  log.appendLine("[Extension] AI PR Insight activated");

  const astParser = new ASTParser();
  astParser.initialize(context.extensionPath).catch((err) => {
    log.appendLine(`[Extension] ASTParser init warning: ${err}`);
  });

  bindWebviewHandlers(context, webviewProvider, editorController);

  const analyzePRDisposable = vscode.commands.registerCommand(
    "ai-pr-insight.analyzePR",
    async () => {
      log.appendLine("[Command] Analyze PR triggered");
      await analyzePRCommand(context, webviewProvider, editorController);
    }
  );

  const setTokenDisposable = vscode.commands.registerCommand(
    "ai-pr-insight.setGitHubToken",
    async () => {
      await setGitHubTokenCommand(context);
    }
  );

  const setLLMApiKeyDisposable = vscode.commands.registerCommand(
    "ai-pr-insight.setLLMApiKey",
    async () => {
      await setLLMApiKeyCommand(context);
    }
  );

  const setLLMProviderDisposable = vscode.commands.registerCommand(
    "ai-pr-insight.setLLMProvider",
    async () => {
      await setLLMProviderCommand(context);
    }
  );

  const setLLMModelDisposable = vscode.commands.registerCommand(
    "ai-pr-insight.setLLMModel",
    async () => {
      await setLLMModelCommand();
    }
  );

  context.subscriptions.push(
    analyzePRDisposable,
    setTokenDisposable,
    setLLMApiKeyDisposable,
    setLLMProviderDisposable,
    setLLMModelDisposable
  );
}

export function deactivate(): void {}
