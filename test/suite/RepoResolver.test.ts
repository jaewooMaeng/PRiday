jest.mock("vscode", () => ({}), { virtual: true });

import {
  deduplicateGitHubRepositories,
  parseGitHubRemote,
} from "../../src/github/RepoResolver";

describe("RepoResolver", () => {
  test.each([
    ["https://github.com/octocat/Hello-World.git", "octocat", "Hello-World"],
    ["git@github.com:octocat/Hello-World.git", "octocat", "Hello-World"],
    ["ssh://git@github.com/octocat/Hello-World.git", "octocat", "Hello-World"],
    ["git://github.com/octocat/Hello-World", "octocat", "Hello-World"],
  ])("%s remote를 owner/repo로 파싱한다", (remote, owner, repo) => {
    expect(parseGitHubRemote(remote)).toEqual({ owner, repo });
  });

  test("GitHub가 아닌 remote와 잘못된 경로를 제외한다", () => {
    expect(parseGitHubRemote("https://gitlab.com/octocat/Hello-World.git")).toBeUndefined();
    expect(parseGitHubRemote("https://github.com/octocat")).toBeUndefined();
  });

  test("같은 GitHub 저장소의 여러 remote를 대소문자와 무관하게 중복 제거한다", () => {
    const repositories = deduplicateGitHubRepositories([
      {
        owner: "octocat",
        repo: "Hello-World",
        rootUri: "file:///workspace/first",
        remoteName: "origin",
      },
      {
        owner: "OctoCat",
        repo: "hello-world",
        rootUri: "file:///workspace/second",
        remoteName: "upstream",
      },
      {
        owner: "acme",
        repo: "dashboard",
        rootUri: "file:///workspace/dashboard",
        remoteName: "origin",
      },
    ]);

    expect(repositories).toHaveLength(2);
    expect(repositories.map(({ owner, repo }) => `${owner}/${repo}`)).toEqual([
      "acme/dashboard",
      "octocat/Hello-World",
    ]);
  });
});
