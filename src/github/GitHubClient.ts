import { Octokit } from "@octokit/rest";
import type {
  PRComment,
  PRDiffResult,
  PRFile,
  PullRequestListItem,
} from "../types/github";

interface PullFileResponse {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
  patch?: string;
}

interface IssueCommentResponse {
  body?: string | null;
  created_at?: string;
  user?: { login?: string | null } | null;
}

interface ReviewCommentResponse {
  body?: string | null;
  path?: string | null;
  line?: number | null;
  created_at?: string;
  user?: { login?: string | null } | null;
}

export class GitHubClient {
  private readonly octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  public async listOpenPullRequests(
    owner: string,
    repo: string
  ): Promise<PullRequestListItem[]> {
    const pulls = await this.octokit.paginate(this.octokit.pulls.list, {
      owner,
      repo,
      state: "open",
      sort: "updated",
      direction: "desc",
      per_page: 100,
    });

    return pulls.map((pull) => ({
      number: pull.number,
      title: pull.title,
      author: pull.user?.login ?? "unknown",
      isDraft: pull.draft ?? false,
      headBranch: pull.head.ref,
      baseBranch: pull.base.ref,
      updatedAt: pull.updated_at,
      url: pull.html_url,
    }));
  }

  public async fetchPRDiff(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<PRDiffResult> {
    const prResponse = await this.octokit.pulls.get({ owner, repo, pull_number: pullNumber });
    const remaining = Number(prResponse.headers?.["x-ratelimit-remaining"] ?? "1");
    if (!Number.isNaN(remaining) && remaining <= 0) {
      throw new Error("GitHub API rate limit exceeded");
    }

    const [filesResponse, issueComments, reviewComments] = await Promise.all([
      this.octokit.paginate(this.octokit.pulls.listFiles, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
      }),
      this.octokit.paginate(this.octokit.issues.listComments, {
        owner,
        repo,
        issue_number: pullNumber,
        per_page: 100,
      }),
      this.octokit.paginate(this.octokit.pulls.listReviewComments, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
      }),
    ]);

    const files: PRFile[] = [];
    for (const file of filesResponse as PullFileResponse[]) {
      const rawContent = await this.fetchRawContent(owner, repo, file.filename, prResponse.data.head.sha);
      files.push({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch ?? "",
        rawContent,
      });
    }

    const comments: PRComment[] = [
      ...(issueComments as IssueCommentResponse[]).map((comment) => ({
        source: "issue" as const,
        author: comment.user?.login ?? "unknown",
        body: (comment.body ?? "").trim(),
        createdAt: comment.created_at ?? "",
      })),
      ...(reviewComments as ReviewCommentResponse[]).map((comment) => ({
        source: "review" as const,
        author: comment.user?.login ?? "unknown",
        body: (comment.body ?? "").trim(),
        path: comment.path ?? undefined,
        line: comment.line ?? undefined,
        createdAt: comment.created_at ?? "",
      })),
    ].filter((comment) => comment.body.length > 0);

    return {
      prTitle: prResponse.data.title,
      prBody: prResponse.data.body ?? "",
      baseBranch: prResponse.data.base.ref,
      headBranch: prResponse.data.head.ref,
      files,
      comments,
    };
  }

  public async validateToken(): Promise<void> {
    await this.octokit.users.getAuthenticated();
  }

  public async createPRComment(
    owner: string,
    repo: string,
    pullNumber: number,
    body: string
  ): Promise<void> {
    await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body,
    });
  }

  public async createReviewComment(
    owner: string,
    repo: string,
    pullNumber: number,
    body: string,
    path: string,
    line: number,
    commitId: string
  ): Promise<void> {
    await this.octokit.pulls.createReviewComment({
      owner,
      repo,
      pull_number: pullNumber,
      body,
      path,
      line,
      commit_id: commitId,
      side: "RIGHT",
    });
  }

  public async getHeadSha(
    owner: string,
    repo: string,
    pullNumber: number
  ): Promise<string> {
    const pr = await this.octokit.pulls.get({ owner, repo, pull_number: pullNumber });
    return pr.data.head.sha;
  }

  private async fetchRawContent(
    owner: string,
    repo: string,
    path: string,
    ref: string
  ): Promise<string> {
    try {
      const response = await this.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      if (!("content" in response.data)) {
        return "";
      }

      const encoded = response.data.content.replace(/\n/g, "");
      return Buffer.from(encoded, "base64").toString("utf-8");
    } catch {
      return "";
    }
  }
}
