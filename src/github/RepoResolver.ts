import * as vscode from "vscode";
import type { GitHubRepositoryRef } from "../types/github";

interface GitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: {
    remotes: readonly GitRemote[];
    onDidChange: vscode.Event<void>;
  };
}

interface GitApi {
  repositories: readonly GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
  onDidCloseRepository: vscode.Event<GitRepository>;
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

export interface ParsedGitHubRemote {
  owner: string;
  repo: string;
}

export function parseGitHubRemote(remoteUrl: string): ParsedGitHubRemote | undefined {
  const value = remoteUrl.trim().replace(/\/+$/, "");
  if (!value) return undefined;

  const scpMatch = value.match(/^(?:[^@/\s]+@)?github\.com:\/?(.+)$/i);
  if (scpMatch) {
    return parseRepositoryPath(scpMatch[1]);
  }

  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "github.com") return undefined;
    if (!["http:", "https:", "ssh:", "git:"].includes(url.protocol)) return undefined;
    return parseRepositoryPath(url.pathname);
  } catch {
    return undefined;
  }
}

export function deduplicateGitHubRepositories(
  repositories: GitHubRepositoryRef[]
): GitHubRepositoryRef[] {
  const uniqueRepositories = new Map<string, GitHubRepositoryRef>();
  for (const repository of repositories) {
    const key = `${repository.owner.toLowerCase()}/${repository.repo.toLowerCase()}`;
    if (!uniqueRepositories.has(key)) uniqueRepositories.set(key, repository);
  }
  return [...uniqueRepositories.values()].sort((a, b) =>
    `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`)
  );
}

export class RepoResolver implements vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [this.changeEmitter];
  private repositoryListeners: vscode.Disposable[] = [];
  private api: GitApi | undefined;
  private initializing: Promise<void> | undefined;

  public readonly onDidChange = this.changeEmitter.event;

  public async getRepositories(): Promise<GitHubRepositoryRef[]> {
    await this.initialize();
    if (!this.api) return [];

    const repositories: GitHubRepositoryRef[] = [];
    for (const localRepository of this.api.repositories) {
      for (const remote of localRepository.state.remotes) {
        const parsed = parseGitHubRemote(remote.fetchUrl ?? remote.pushUrl ?? "");
        if (!parsed) continue;

        repositories.push({
          ...parsed,
          rootUri: localRepository.rootUri.toString(),
          remoteName: remote.name,
        });
      }
    }

    return deduplicateGitHubRepositories(repositories);
  }

  public dispose(): void {
    this.disposeRepositoryListeners();
    for (const disposable of this.disposables) disposable.dispose();
  }

  private async initialize(): Promise<void> {
    if (this.api) return;
    if (this.initializing) return this.initializing;

    this.initializing = this.activateGitExtension();
    await this.initializing;
  }

  private async activateGitExtension(): Promise<void> {
    const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
    if (!extension) return;

    const gitExtension = extension.isActive ? extension.exports : await extension.activate();
    this.api = gitExtension.getAPI(1);
    this.disposables.push(
      this.api.onDidOpenRepository(() => this.handleRepositoriesChanged()),
      this.api.onDidCloseRepository(() => this.handleRepositoriesChanged())
    );
    this.refreshRepositoryListeners();
  }

  private handleRepositoriesChanged(): void {
    this.refreshRepositoryListeners();
    this.changeEmitter.fire();
  }

  private refreshRepositoryListeners(): void {
    this.disposeRepositoryListeners();
    if (!this.api) return;
    this.repositoryListeners = this.api.repositories.map((repository) =>
      repository.state.onDidChange(() => this.changeEmitter.fire())
    );
  }

  private disposeRepositoryListeners(): void {
    for (const disposable of this.repositoryListeners) disposable.dispose();
    this.repositoryListeners = [];
  }
}

function parseRepositoryPath(path: string): ParsedGitHubRemote | undefined {
  const segments = path
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (segments.length !== 2) return undefined;

  const owner = decodePathSegment(segments[0]);
  const repo = decodePathSegment(segments[1]).replace(/\.git$/i, "");
  if (!owner || !repo) return undefined;
  return { owner, repo };
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
