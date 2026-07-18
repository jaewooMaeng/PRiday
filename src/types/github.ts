export interface PRFile {
  filename: string;
  status: "added" | "removed" | "modified" | "renamed";
  additions: number;
  deletions: number;
  patch: string;
  rawContent: string;
}

export interface PRComment {
  source: "issue" | "review";
  author: string;
  body: string;
  path?: string;
  line?: number;
  createdAt: string;
}

export interface PRDiffResult {
  prTitle: string;
  prBody: string;
  baseBranch: string;
  headBranch: string;
  files: PRFile[];
  comments: PRComment[];
}
