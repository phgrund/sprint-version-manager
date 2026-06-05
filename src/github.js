import { Octokit } from '@octokit/rest';

export function createGitHub(token) {
  if (!token) throw new Error('GITHUB_TOKEN não definido');
  const octokit = new Octokit({ auth: token });

  return {
    async getPR(owner, repo, number) {
      const { data } = await octokit.pulls.get({ owner, repo, pull_number: number });
      return data;
    },

    async branchExists(owner, repo, branch) {
      try {
        await octokit.repos.getBranch({ owner, repo, branch });
        return true;
      } catch (err) {
        if (err.status === 404) return false;
        throw err;
      }
    },

    async getDefaultBranchSha(owner, repo) {
      const { data: r } = await octokit.repos.get({ owner, repo });
      const { data: b } = await octokit.repos.getBranch({ owner, repo, branch: r.default_branch });
      return { sha: b.commit.sha, defaultBranch: r.default_branch };
    },

    async getBranchSha(owner, repo, branch) {
      const { data } = await octokit.repos.getBranch({ owner, repo, branch });
      return data.commit.sha;
    },

    async createBranch(owner, repo, branch, fromSha) {
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: fromSha,
      });
    },

    async updatePRBase(owner, repo, number, base) {
      const { data } = await octokit.pulls.update({
        owner,
        repo,
        pull_number: number,
        base,
      });
      return data;
    },
  };
}
