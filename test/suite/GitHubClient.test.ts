jest.mock("@octokit/rest", () => {
  return {
    Octokit: jest.fn().mockImplementation(() => {
      const pulls = {
        get: jest.fn().mockResolvedValue({
          data: {
            title: "test pr",
            body: "body",
            base: { ref: "main" },
            head: { ref: "feature", sha: "abc" },
          },
        }),
        list: jest.fn(),
        listFiles: jest.fn(),
        listReviewComments: jest.fn(),
      };
      const issues = {
        listComments: jest.fn(),
      };

      return {
        pulls,
        issues,
        paginate: jest.fn().mockImplementation((method: unknown) => {
          if (method === pulls.list) {
            return Promise.resolve([
              {
                number: 12,
                title: "새 분석 플로우",
                user: { login: "alice" },
                draft: false,
                head: { ref: "feature/sidebar" },
                base: { ref: "main" },
                updated_at: "2026-08-17T06:00:00Z",
                html_url: "https://github.com/octocat/Hello-World/pull/12",
              },
            ]);
          }
          if (method === pulls.listFiles) {
            return Promise.resolve([
              {
                filename: "main.py",
                status: "modified",
                additions: 2,
                deletions: 1,
                patch: "@@",
              },
            ]);
          }
          if (method === issues.listComments) {
            return Promise.resolve([
              {
                body: "issue comment",
                created_at: "2026-01-01T00:00:00Z",
                user: { login: "alice" },
              },
            ]);
          }
          return Promise.resolve([
            {
              body: "review comment",
              path: "main.py",
              line: 1,
              created_at: "2026-01-01T00:00:00Z",
              user: { login: "bob" },
            },
          ]);
        }),
        repos: {
          getContent: jest.fn().mockResolvedValue({
            data: { content: Buffer.from("print('hi')").toString("base64") },
          }),
        },
        users: {
          getAuthenticated: jest.fn().mockResolvedValue({}),
        },
      };
    }),
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

  test("열린 PR 목록을 최신 업데이트 순으로 조회하고 매핑한다", async () => {
    const client = new GitHubClient("token");
    const result = await client.listOpenPullRequests("octocat", "Hello-World");

    expect(result).toEqual([
      {
        number: 12,
        title: "새 분석 플로우",
        author: "alice",
        isDraft: false,
        headBranch: "feature/sidebar",
        baseBranch: "main",
        updatedAt: "2026-08-17T06:00:00Z",
        url: "https://github.com/octocat/Hello-World/pull/12",
      },
    ]);
  });
});
