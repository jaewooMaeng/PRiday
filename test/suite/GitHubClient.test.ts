jest.mock("@octokit/rest", () => {
  return {
    Octokit: jest.fn().mockImplementation(() => ({
      pulls: {
        get: jest.fn().mockResolvedValue({
          data: {
            title: "test pr",
            body: "body",
            base: { ref: "main" },
            head: { ref: "feature", sha: "abc" },
          },
        }),
        listFiles: jest.fn(),
        listReviewComments: jest.fn(),
      },
      issues: {
        listComments: jest.fn(),
      },
      paginate: jest
        .fn()
        .mockResolvedValueOnce([
          {
            filename: "main.py",
            status: "modified",
            additions: 2,
            deletions: 1,
            patch: "@@",
          },
        ])
        .mockResolvedValueOnce([
          {
            body: "issue comment",
            created_at: "2026-01-01T00:00:00Z",
            user: { login: "alice" },
          },
        ])
        .mockResolvedValueOnce([
          {
            body: "review comment",
            path: "main.py",
            line: 1,
            created_at: "2026-01-01T00:00:00Z",
            user: { login: "bob" },
          },
        ]),
      repos: {
        getContent: jest.fn().mockResolvedValue({
          data: { content: Buffer.from("print('hi')").toString("base64") },
        }),
      },
      users: {
        getAuthenticated: jest.fn().mockResolvedValue({}),
      },
    })),
  };
});

import { GitHubClient } from "../../src/github/GitHubClient";

describe("GitHubClient", () => {
  test("PR diff를 조회하고 파일 목록을 반환한다", async () => {
    const client = new GitHubClient("token");
    const result = await client.fetchPRDiff("octocat", "Hello-World", 1);
    expect(result.prTitle).toBe("test pr");
    expect(result.files[0].filename).toBe("main.py");
    expect(result.files[0].rawContent).toContain("print");
    expect(result.comments).toHaveLength(2);
  });
});
