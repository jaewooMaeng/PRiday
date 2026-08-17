import * as vscode from "vscode";
import { GitHubClient } from "../github/GitHubClient";
import { RepoResolver } from "../github/RepoResolver";
import { getStoredGitHubToken } from "../github/auth";
import type {
  GitHubRepositoryRef,
  PullRequestListItem,
} from "../types/github";

type PullRequestTreeNode =
  | RepositoryTreeItem
  | PullRequestTreeItem
  | MessageTreeItem;

export class OpenPullRequestsProvider
  implements vscode.TreeDataProvider<PullRequestTreeNode>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<PullRequestTreeNode | undefined>();
  private readonly resolverSubscription: vscode.Disposable;
  private readonly pullRequestCache = new Map<
    string,
    Promise<PullRequestListItem[]>
  >();

  public readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly repoResolver: RepoResolver
  ) {
    this.resolverSubscription = repoResolver.onDidChange(() => this.refresh());
  }

  public getTreeItem(element: PullRequestTreeNode): vscode.TreeItem {
    return element;
  }

  public async getChildren(
    element?: PullRequestTreeNode
  ): Promise<PullRequestTreeNode[]> {
    if (!element) return this.getRepositoryItems();
    if (!(element instanceof RepositoryTreeItem)) return [];
    return this.getPullRequestItems(element.repository);
  }

  public refresh(): void {
    this.pullRequestCache.clear();
    this.changeEmitter.fire(undefined);
  }

  public dispose(): void {
    this.resolverSubscription.dispose();
    this.changeEmitter.dispose();
  }

  private async getRepositoryItems(): Promise<PullRequestTreeNode[]> {
    const repositories = await this.repoResolver.getRepositories();
    if (repositories.length === 0) {
      return [
        new MessageTreeItem(
          "GitHub 저장소를 찾지 못했습니다",
          "github.com remote가 있는 저장소를 열어주세요",
          "warning"
        ),
      ];
    }

    const token = await getStoredGitHubToken(this.context);
    if (!token) {
      return [
        new MessageTreeItem(
          "GitHub 토큰 설정",
          "open PR을 불러오려면 먼저 설정하세요",
          "key",
          "ai-pr-insight.setGitHubToken"
        ),
      ];
    }

    return repositories.map((repository) => new RepositoryTreeItem(repository));
  }

  private async getPullRequestItems(
    repository: GitHubRepositoryRef
  ): Promise<PullRequestTreeNode[]> {
    const token = await getStoredGitHubToken(this.context);
    if (!token) {
      return [
        new MessageTreeItem(
          "GitHub 토큰 설정",
          "PR 목록을 불러오려면 필요합니다",
          "key",
          "ai-pr-insight.setGitHubToken"
        ),
      ];
    }

    try {
      const pullRequests = await this.getPullRequests(repository, token);
      if (pullRequests.length === 0) {
        return [
          new MessageTreeItem(
            "열린 PR이 없습니다",
            `${repository.owner}/${repository.repo}`,
            "check"
          ),
        ];
      }
      return pullRequests.map(
        (pullRequest) => new PullRequestTreeItem(repository, pullRequest)
      );
    } catch (error) {
      return [
        new MessageTreeItem(
          "PR 목록을 불러오지 못했습니다",
          toSidebarErrorMessage(error),
          "error"
        ),
      ];
    }
  }

  private getPullRequests(
    repository: GitHubRepositoryRef,
    token: string
  ): Promise<PullRequestListItem[]> {
    const key = `${repository.owner.toLowerCase()}/${repository.repo.toLowerCase()}`;
    const cached = this.pullRequestCache.get(key);
    if (cached) return cached;

    const request = new GitHubClient(token).listOpenPullRequests(
      repository.owner,
      repository.repo
    );
    this.pullRequestCache.set(key, request);
    return request;
  }
}

class RepositoryTreeItem extends vscode.TreeItem {
  constructor(public readonly repository: GitHubRepositoryRef) {
    super(
      `${repository.owner}/${repository.repo}`,
      vscode.TreeItemCollapsibleState.Expanded
    );
    this.contextValue = "githubRepository";
    this.description = repository.remoteName;
    this.iconPath = new vscode.ThemeIcon("repo");
    this.tooltip = new vscode.MarkdownString(
      `**${repository.owner}/${repository.repo}**\n\nRemote: ${repository.remoteName}`
    );
  }
}

export class PullRequestTreeItem extends vscode.TreeItem {
  public readonly owner: string;
  public readonly repo: string;
  public readonly prNumber: number;

  constructor(
    repository: GitHubRepositoryRef,
    public readonly pullRequest: PullRequestListItem
  ) {
    super(`#${pullRequest.number} ${pullRequest.title}`, vscode.TreeItemCollapsibleState.None);
    this.owner = repository.owner;
    this.repo = repository.repo;
    this.prNumber = pullRequest.number;
    this.contextValue = "openPullRequest";
    this.description = pullRequest.isDraft
      ? `Draft · ${pullRequest.author}`
      : pullRequest.author;
    this.iconPath = new vscode.ThemeIcon(
      pullRequest.isDraft ? "git-pull-request-draft" : "git-pull-request"
    );
    this.tooltip = new vscode.MarkdownString(
      [
        `**#${pullRequest.number} ${pullRequest.title}**`,
        "",
        `${pullRequest.headBranch} → ${pullRequest.baseBranch}`,
        "",
        `작성자: ${pullRequest.author}${pullRequest.isDraft ? " · Draft" : ""}`,
      ].join("\n")
    );
  }
}

class MessageTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    icon: string,
    command?: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = "prExplorerMessage";
    if (command) {
      this.command = {
        command,
        title: label,
      };
    }
  }
}

function toSidebarErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("401") || message.includes("Bad credentials")) {
    return "GitHub 토큰을 확인해주세요";
  }
  if (message.includes("403")) {
    return "저장소 접근 권한 또는 API 할당량을 확인해주세요";
  }
  if (message.includes("404")) {
    return "저장소를 찾을 수 없습니다";
  }
  return message;
}
