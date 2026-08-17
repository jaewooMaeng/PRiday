import * as vscode from "vscode";
import {
  analyzePRCommand,
  analyzeSelectedPR,
  bindWebviewHandlers,
  setLLMApiKeyCommand,
  setLLMModelCommand,
  setLLMProviderCommand,
} from "./commands/analyzePR";
import { EditorController } from "./editor/EditorController";
import { ASTParser } from "./analysis/ASTParser";
import { RepoResolver } from "./github/RepoResolver";
import { setGitHubTokenCommand } from "./github/auth";
import {
  OpenPullRequestsProvider,
  PullRequestTreeItem,
} from "./sidebar/OpenPullRequestsProvider";
import { getLogger } from "./utils/logger";
import { WebviewProvider } from "./webview/WebviewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const log = getLogger();
  const webviewProvider = new WebviewProvider(context.extensionUri);
  const editorController = new EditorController();
  const repoResolver = new RepoResolver();
  const pullRequestsProvider = new OpenPullRequestsProvider(context, repoResolver);

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
      if (await setGitHubTokenCommand(context)) {
        pullRequestsProvider.refresh();
      }
    }
  );

  const refreshPullRequestsDisposable = vscode.commands.registerCommand(
    "ai-pr-insight.refreshPullRequests",
    () => pullRequestsProvider.refresh()
  );

  const analyzeSelectedPRDisposable = vscode.commands.registerCommand(
    "ai-pr-insight.analyzeSelectedPR",
    async (item: PullRequestTreeItem) => {
      if (!item) return;
      log.appendLine(
        `[Command] Analyze selected PR triggered: ${item.owner}/${item.repo}#${item.prNumber}`
      );
      await analyzeSelectedPR(
        context,
        webviewProvider,
        editorController,
        { owner: item.owner, repo: item.repo },
        item.prNumber
      );
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

  const pullRequestsTree = vscode.window.registerTreeDataProvider(
    "ai-pr-insight.openPullRequests",
    pullRequestsProvider
  );

  context.subscriptions.push(
    analyzePRDisposable,
    analyzeSelectedPRDisposable,
    refreshPullRequestsDisposable,
    setTokenDisposable,
    setLLMApiKeyDisposable,
    setLLMProviderDisposable,
    setLLMModelDisposable,
    pullRequestsTree,
    pullRequestsProvider,
    repoResolver
  );
}

export function deactivate(): void {}
