import * as vscode from "vscode";

export const GITHUB_TOKEN_KEY = "aiPrInsight.githubToken";

export async function getStoredGitHubToken(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  return context.secrets.get(GITHUB_TOKEN_KEY);
}

export async function promptForGitHubToken(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  const token = await vscode.window.showInputBox({
    title: "GitHub Personal Access Token",
    prompt: "GitHub PAT를 입력하세요 (repo scope 권장)",
    password: true,
    ignoreFocusOut: true,
  });
  if (!token?.trim()) return undefined;

  const normalizedToken = token.trim();
  await context.secrets.store(GITHUB_TOKEN_KEY, normalizedToken);
  return normalizedToken;
}

export async function getOrCreateGitHubToken(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  return (await getStoredGitHubToken(context)) ?? promptForGitHubToken(context);
}

export async function setGitHubTokenCommand(
  context: vscode.ExtensionContext
): Promise<boolean> {
  const token = await promptForGitHubToken(context);
  if (!token) return false;

  vscode.window.showInformationMessage("GitHub 토큰을 안전하게 저장했습니다.");
  return true;
}
