const { ghRequest, clip, encodePath, need } = require("./github");
const { LAW, AGENTS, SUGGESTIONS, veto, generate } = require("./law");

function obj(props, required) {
  return {
    type: "object",
    properties: props,
    required: required || [],
    additionalProperties: false,
  };
}

const s = (description) => ({ type: "string", description });

const TOOLS = [
  {
    name: "hive_seed",
    kind: "law",
    description: "Answer under the frozen Prime Directive. Refuses rewrite, flood, second-master, and account-takeover requests.",
    schema: obj({ prompt: s("Question for the seed"), agent: s("Agent name. Empty specialization means base only.") }),
    async run(args, ctx) {
      const agent = String(args.agent || "base");
      const spec = ctx.getSpec(agent);
      return generate(args.prompt || "Who are you?", spec);
    },
  },
  {
    name: "hive_agents",
    kind: "law",
    description: "List hive agents. Pass save=true with agent and prompt to store an operator specialization. Specializations are never inherited automatically.",
    schema: obj({
      agent: s("Agent id"),
      prompt: s("Specialization text to save"),
      save: { type: "boolean", description: "Save the specialization for this operator" },
    }),
    async run(args, ctx) {
      if (args.save) {
        need(args, ["agent", "prompt"]);
        if (!AGENTS.includes(args.agent)) return "Unknown agent. Use one of: " + AGENTS.join(", ");
        await ctx.saveSpec(args.agent, args.prompt);
        return "Saved " + args.agent + ". It does not inherit to other agents.\n" + LAW;
      }
      return AGENTS.map((name) => {
        const saved = ctx.getSpec(name);
        const suggestion = SUGGESTIONS[name];
        return (
          name +
          (saved ? "\n  saved: " + saved : "\n  saved: (base only)") +
          (suggestion ? "\n  suggestion (not active): " + suggestion : "")
        );
      }).join("\n");
    },
  },
  {
    name: "hive_plan",
    kind: "law",
    description: "Validate a hive plan. Needs a base, a role, and at least one package. This is a checklist, not an installer.",
    schema: obj({
      base: s("Planning base"),
      role: s("One role"),
      packages: { type: "array", items: { type: "string" }, description: "Plan sections" },
    }),
    async run(args) {
      const missing = [];
      if (!args.base) missing.push("base");
      if (!args.role) missing.push("role");
      if (!args.packages || !args.packages.length) missing.push("at least one package");
      const verdict = missing.length ? "HOLD. Missing " + missing.join(", ") + "." : "PASS. " + LAW;
      return ["COPILOT HIVE PLAN", "Law: " + LAW, "Base: " + (args.base || "(none)"), "Role: " + (args.role || "(none)"), "Packages: " + ((args.packages || []).join(", ") || "(none)"), verdict, "Checklist only. Unite stays empty."].join("\n");
    },
  },
  {
    name: "hive_github_me",
    kind: "read",
    description: "Return the signed-in GitHub user. Same job as reading the account profile.",
    schema: obj({}),
    async run(_args, ctx) {
      return clip(await ctx.request("GET", "/user"));
    },
  },
  {
    name: "hive_github_repos",
    kind: "read",
    description: "List repositories for a user, or the signed-in user when login is omitted.",
    schema: obj({ login: s("GitHub login. Omit for the signed-in account."), perPage: { type: "number" } }),
    async run(args, ctx) {
      const n = Math.min(Number(args.perPage) || 30, 100);
      const path = args.login
        ? "/users/" + encodeURIComponent(args.login) + "/repos?per_page=" + n + "&sort=updated"
        : "/user/repos?per_page=" + n + "&sort=updated&affiliation=owner,collaborator,organization_member";
      const rows = await ctx.request("GET", path);
      return clip(rows.map((r) => ({ full_name: r.full_name, private: r.private, description: r.description, default_branch: r.default_branch, html_url: r.html_url })));
    },
  },
  {
    name: "hive_github_search_repos",
    kind: "read",
    description: "Search repositories with GitHub search syntax.",
    schema: obj({ query: s("Search query") }, ["query"]),
    async run(args, ctx) {
      const data = await ctx.request("GET", "/search/repositories?per_page=15&q=" + encodeURIComponent(args.query));
      return clip((data.items || []).map((r) => ({ full_name: r.full_name, description: r.description, html_url: r.html_url })));
    },
  },
  {
    name: "hive_github_search_code",
    kind: "read",
    description: "Search code the signed-in account can see.",
    schema: obj({ query: s("Code search query, include repo:owner/name when you can") }, ["query"]),
    async run(args, ctx) {
      const data = await ctx.request("GET", "/search/code?per_page=15&q=" + encodeURIComponent(args.query));
      return clip((data.items || []).map((r) => ({ path: r.path, repository: r.repository && r.repository.full_name, html_url: r.html_url })));
    },
  },
  {
    name: "hive_github_search_commits",
    kind: "read",
    description: "Search commit messages. Scope with repo:owner/name.",
    schema: obj({ query: s("Commit search query") }, ["query"]),
    async run(args, ctx) {
      const data = await ctx.request("GET", "/search/commits?per_page=15&q=" + encodeURIComponent(args.query));
      return clip((data.items || []).map((r) => ({ sha: r.sha, message: r.commit && r.commit.message, html_url: r.html_url })));
    },
  },
  {
    name: "hive_github_file",
    kind: "read",
    description: "Read a file or list a directory.",
    schema: obj({ owner: s("Owner"), repo: s("Repo"), path: s("Path, empty for root"), ref: s("Branch, tag, or sha") }, ["owner", "repo"]),
    async run(args, ctx) {
      const path = args.path ? "/" + encodePath(args.path) : "";
      const ref = args.ref ? "?ref=" + encodeURIComponent(args.ref) : "";
      const data = await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo + "/contents" + path + ref);
      if (Array.isArray(data)) return clip(data.map((e) => ({ name: e.name, type: e.type, path: e.path })));
      if (data.encoding === "base64" && data.content) {
        const text = Buffer.from(data.content, "base64").toString("utf8");
        return clip({ path: data.path, sha: data.sha, text });
      }
      return clip(data);
    },
  },
  {
    name: "hive_github_tree",
    kind: "read",
    description: "List the git tree for a repository ref.",
    schema: obj({ owner: s("Owner"), repo: s("Repo"), ref: s("Ref, default branch if omitted") }, ["owner", "repo"]),
    async run(args, ctx) {
      let ref = args.ref;
      if (!ref) {
        const meta = await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo);
        ref = meta.default_branch;
      }
      const data = await ctx.request(
        "GET",
        "/repos/" + args.owner + "/" + args.repo + "/git/trees/" + encodeURIComponent(ref) + "?recursive=1",
      );
      const tree = (data.tree || []).slice(0, 400).map((t) => t.path + (t.type === "tree" ? "/" : ""));
      return clip({ sha: data.sha, truncated: data.truncated, count: (data.tree || []).length, tree });
    },
  },
  {
    name: "hive_github_issues",
    kind: "read",
    description: "List issues in a repository.",
    schema: obj({ owner: s("Owner"), repo: s("Repo"), state: s("open, closed, or all") }, ["owner", "repo"]),
    async run(args, ctx) {
      const state = args.state || "open";
      const rows = await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo + "/issues?per_page=20&state=" + encodeURIComponent(state));
      return clip(rows.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, html_url: i.html_url })));
    },
  },
  {
    name: "hive_github_pulls",
    kind: "read",
    description: "List pull requests.",
    schema: obj({ owner: s("Owner"), repo: s("Repo"), state: s("open, closed, or all") }, ["owner", "repo"]),
    async run(args, ctx) {
      const rows = await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo + "/pulls?per_page=20&state=" + encodeURIComponent(args.state || "open"));
      return clip(rows.map((p) => ({ number: p.number, title: p.title, html_url: p.html_url, head: p.head && p.head.ref, base: p.base && p.base.ref })));
    },
  },
  {
    name: "hive_github_pull",
    kind: "read",
    description: "Read one pull request.",
    schema: obj({ owner: s("Owner"), repo: s("Repo"), number: { type: "number" } }, ["owner", "repo", "number"]),
    async run(args, ctx) {
      return clip(await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo + "/pulls/" + Number(args.number)));
    },
  },
  {
    name: "hive_github_branches",
    kind: "read",
    description: "List branches.",
    schema: obj({ owner: s("Owner"), repo: s("Repo") }, ["owner", "repo"]),
    async run(args, ctx) {
      const rows = await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo + "/branches?per_page=50");
      return clip(rows.map((b) => b.name));
    },
  },
  {
    name: "hive_github_releases",
    kind: "read",
    description: "List releases.",
    schema: obj({ owner: s("Owner"), repo: s("Repo") }, ["owner", "repo"]),
    async run(args, ctx) {
      const rows = await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo + "/releases?per_page=20");
      return clip(rows.map((r) => ({ tag: r.tag_name, name: r.name, html_url: r.html_url, draft: r.draft })));
    },
  },
  {
    name: "hive_github_tags",
    kind: "read",
    description: "List git tags.",
    schema: obj({ owner: s("Owner"), repo: s("Repo") }, ["owner", "repo"]),
    async run(args, ctx) {
      const rows = await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo + "/tags?per_page=30");
      return clip(rows.map((t) => t.name));
    },
  },
  {
    name: "hive_github_commit",
    kind: "read",
    description: "Read one commit, or the latest commits when sha is omitted.",
    schema: obj({ owner: s("Owner"), repo: s("Repo"), sha: s("Commit sha. Omit for the latest list.") }, ["owner", "repo"]),
    async run(args, ctx) {
      const path = args.sha
        ? "/repos/" + args.owner + "/" + args.repo + "/commits/" + encodeURIComponent(args.sha)
        : "/repos/" + args.owner + "/" + args.repo + "/commits?per_page=15";
      return clip(await ctx.request("GET", path));
    },
  },
  {
    name: "hive_github_actions",
    kind: "read",
    description: "List Actions workflows and recent runs.",
    schema: obj({ owner: s("Owner"), repo: s("Repo") }, ["owner", "repo"]),
    async run(args, ctx) {
      const base = "/repos/" + args.owner + "/" + args.repo + "/actions";
      const [workflows, runs] = await Promise.all([
        ctx.request("GET", base + "/workflows?per_page=20"),
        ctx.request("GET", base + "/runs?per_page=15"),
      ]);
      return clip({
        workflows: (workflows.workflows || []).map((w) => ({ id: w.id, name: w.name, path: w.path, state: w.state })),
        runs: (runs.workflow_runs || []).map((r) => ({ id: r.id, name: r.name, status: r.status, conclusion: r.conclusion, html_url: r.html_url })),
      });
    },
  },
  {
    name: "hive_github_dependabot",
    kind: "read",
    description: "List Dependabot alerts the account is allowed to see.",
    schema: obj({ owner: s("Owner"), repo: s("Repo"), state: s("open, fixed, dismissed, or auto_dismissed") }, ["owner", "repo"]),
    async run(args, ctx) {
      const state = args.state || "open";
      const rows = await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo + "/dependabot/alerts?per_page=20&state=" + state);
      return clip(rows.map((a) => ({ number: a.number, state: a.state, severity: a.security_advisory && a.security_advisory.severity, summary: a.security_advisory && a.security_advisory.summary })));
    },
  },
  {
    name: "hive_github_projects",
    kind: "read",
    description: "List GitHub Projects v2 for a user.",
    schema: obj({ login: s("User login. Defaults to the signed-in account.") }),
    async run(args, ctx) {
      let login = args.login;
      if (!login) {
        const me = await ctx.request("GET", "/user");
        login = me.login;
      }
      const query = "query($login:String!){ user(login:$login){ projectsV2(first:20){ nodes { title number url closed } } } }";
      return clip(await ctx.request("POST", "/graphql", { query, variables: { login } }));
    },
  },
  {
    name: "hive_github_notifications",
    kind: "read",
    description: "List notifications for the signed-in account.",
    schema: obj({}),
    async run(_args, ctx) {
      const rows = await ctx.request("GET", "/notifications?per_page=20");
      return clip(rows.map((n) => ({ id: n.id, reason: n.reason, title: n.subject && n.subject.title, type: n.subject && n.subject.type, url: n.subject && n.subject.url })));
    },
  },
  {
    name: "hive_github_gists",
    kind: "read",
    description: "List gists for the signed-in account.",
    schema: obj({}),
    async run(_args, ctx) {
      const rows = await ctx.request("GET", "/gists?per_page=20");
      return clip(rows.map((g) => ({ id: g.id, description: g.description, html_url: g.html_url, files: Object.keys(g.files || {}) })));
    },
  },
  {
    name: "hive_github_create_issue",
    kind: "write",
    description: "Create one issue after the operator confirms. Refuses bulk or flood wording.",
    schema: obj({ owner: s("Owner"), repo: s("Repo"), title: s("Title"), body: s("Body") }, ["owner", "repo", "title"]),
    async run(args, ctx) {
      return clip(await ctx.request("POST", "/repos/" + args.owner + "/" + args.repo + "/issues", { title: args.title, body: args.body || "" }));
    },
  },
  {
    name: "hive_github_create_pr",
    kind: "write",
    description: "Open one pull request after confirm.",
    schema: obj({
      owner: s("Owner"),
      repo: s("Repo"),
      title: s("Title"),
      head: s("Head branch"),
      base: s("Base branch"),
      body: s("Body"),
    }, ["owner", "repo", "title", "head", "base"]),
    async run(args, ctx) {
      return clip(await ctx.request("POST", "/repos/" + args.owner + "/" + args.repo + "/pulls", {
        title: args.title,
        head: args.head,
        base: args.base,
        body: args.body || "",
      }));
    },
  },
  {
    name: "hive_github_comment",
    kind: "write",
    description: "Comment once on an issue or pull request.",
    schema: obj({ owner: s("Owner"), repo: s("Repo"), number: { type: "number" }, body: s("Comment") }, ["owner", "repo", "number", "body"]),
    async run(args, ctx) {
      return clip(await ctx.request("POST", "/repos/" + args.owner + "/" + args.repo + "/issues/" + Number(args.number) + "/comments", { body: args.body }));
    },
  },
  {
    name: "hive_github_create_branch",
    kind: "write",
    description: "Create a branch from an existing ref. Does not force-push.",
    schema: obj({ owner: s("Owner"), repo: s("Repo"), branch: s("New branch"), from: s("Source branch or sha") }, ["owner", "repo", "branch", "from"]),
    async run(args, ctx) {
      if (!/^[A-Za-z0-9._/-]+$/.test(args.branch)) return "Refused branch name.";
      const ref = await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo + "/git/ref/heads/" + encodeURIComponent(args.from));
      return clip(await ctx.request("POST", "/repos/" + args.owner + "/" + args.repo + "/git/refs", {
        ref: "refs/heads/" + args.branch,
        sha: ref.object.sha,
      }));
    },
  },
  {
    name: "hive_github_upsert_file",
    kind: "write",
    description: "Create or update one text file on a branch.",
    schema: obj({
      owner: s("Owner"),
      repo: s("Repo"),
      path: s("File path"),
      content: s("UTF-8 text, max 100kb"),
      message: s("Commit message"),
      branch: s("Branch"),
    }, ["owner", "repo", "path", "content"]),
    async run(args, ctx) {
      if (args.path.includes("..") || args.content.length > 100000) return "Refused path or size.";
      let sha;
      const ref = args.branch ? "?ref=" + encodeURIComponent(args.branch) : "";
      try {
        const cur = await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo + "/contents/" + encodePath(args.path) + ref);
        sha = cur.sha;
      } catch (err) {
        if (!String(err.message).includes("404")) throw err;
      }
      return clip(await ctx.request("PUT", "/repos/" + args.owner + "/" + args.repo + "/contents/" + encodePath(args.path), {
        message: args.message || "Copilot Hive update " + args.path,
        content: Buffer.from(args.content, "utf8").toString("base64"),
        ...(sha ? { sha } : {}),
        ...(args.branch ? { branch: args.branch } : {}),
      }));
    },
  },
  {
    name: "hive_github_push_files",
    kind: "write",
    description: "Commit up to 15 text files in one push. No force.",
    schema: obj({
      owner: s("Owner"),
      repo: s("Repo"),
      branch: s("Branch. Defaults to the default branch."),
      message: s("Commit message"),
      files: {
        type: "array",
        items: obj({ path: s("Path"), content: s("UTF-8 text") }, ["path", "content"]),
      },
    }, ["owner", "repo", "files"]),
    async run(args, ctx) {
      if (!Array.isArray(args.files) || args.files.length < 1 || args.files.length > 15) return "Provide 1 to 15 files.";
      for (const file of args.files) {
        if (!file.path || file.path.includes("..") || typeof file.content !== "string" || file.content.length > 100000) {
          return "Refused a file path or size.";
        }
      }
      const meta = await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo);
      const branch = args.branch || meta.default_branch;
      const ref = await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo + "/git/ref/heads/" + encodeURIComponent(branch));
      const parent = ref.object.sha;
      const commit = await ctx.request("GET", "/repos/" + args.owner + "/" + args.repo + "/git/commits/" + parent);
      const treeItems = [];
      for (const file of args.files) {
        const blob = await ctx.request("POST", "/repos/" + args.owner + "/" + args.repo + "/git/blobs", { content: file.content, encoding: "utf-8" });
        treeItems.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
      }
      const tree = await ctx.request("POST", "/repos/" + args.owner + "/" + args.repo + "/git/trees", { base_tree: commit.tree.sha, tree: treeItems });
      const next = await ctx.request("POST", "/repos/" + args.owner + "/" + args.repo + "/git/commits", {
        message: args.message || "Copilot Hive push",
        tree: tree.sha,
        parents: [parent],
      });
      const updated = await ctx.request("PATCH", "/repos/" + args.owner + "/" + args.repo + "/git/refs/heads/" + encodeURIComponent(branch), { sha: next.sha });
      return clip({ commit: next.sha, ref: updated.ref, html: meta.html_url + "/commit/" + next.sha });
    },
  },
  {
    name: "hive_github_create_repo",
    kind: "write",
    description: "Create one repository on the signed-in account.",
    schema: obj({
      name: s("Repository name"),
      description: s("Description"),
      private: { type: "boolean", description: "Private repo. Default false." },
    }, ["name"]),
    async run(args, ctx) {
      if (!/^[A-Za-z0-9._-]+$/.test(args.name)) return "Refused repository name.";
      return clip(await ctx.request("POST", "/user/repos", {
        name: args.name,
        description: args.description || "Created from Copilot Hive.",
        private: Boolean(args.private),
        auto_init: true,
      }));
    },
  },
  {
    name: "hive_github_merge",
    kind: "write",
    description: "Merge one pull request with a merge commit. No force, no squash unless method is set to squash or rebase.",
    schema: obj({
      owner: s("Owner"),
      repo: s("Repo"),
      number: { type: "number" },
      method: s("merge, squash, or rebase"),
    }, ["owner", "repo", "number"]),
    async run(args, ctx) {
      const method = args.method || "merge";
      if (!["merge", "squash", "rebase"].includes(method)) return "Refused merge method.";
      return clip(await ctx.request("PUT", "/repos/" + args.owner + "/" + args.repo + "/pulls/" + Number(args.number) + "/merge", { merge_method: method }));
    },
  },
  {
    name: "hive_github_star",
    kind: "write",
    description: "Star or unstar one repository.",
    schema: obj({ owner: s("Owner"), repo: s("Repo"), remove: { type: "boolean", description: "Unstar when true" } }, ["owner", "repo"]),
    async run(args, ctx) {
      const path = "/user/starred/" + args.owner + "/" + args.repo;
      if (args.remove) {
        await ctx.request("DELETE", path);
        return "Unstarred " + args.owner + "/" + args.repo;
      }
      await ctx.request("PUT", path);
      return "Starred " + args.owner + "/" + args.repo;
    },
  },
  {
    name: "hive_github_gist",
    kind: "write",
    description: "Create one secret gist.",
    schema: obj({ filename: s("File name"), content: s("Text"), description: s("Description"), public: { type: "boolean" } }, ["filename", "content"]),
    async run(args, ctx) {
      if (args.content.length > 100000) return "Refused. Gist over 100kb.";
      const files = {};
      files[args.filename] = { content: args.content };
      return clip(await ctx.request("POST", "/gists", { description: args.description || "Copilot Hive", public: Boolean(args.public), files }));
    },
  },
  {
    name: "hive_github_copilot_review",
    kind: "write",
    description: "Comment @copilot on an issue or pull so GitHub Copilot can pick up the review. One comment only.",
    schema: obj({ owner: s("Owner"), repo: s("Repo"), number: { type: "number" }, note: s("What to review") }, ["owner", "repo", "number"]),
    async run(args, ctx) {
      const body = "@copilot " + (args.note || "Please review this with the repository instructions.");
      return clip(await ctx.request("POST", "/repos/" + args.owner + "/" + args.repo + "/issues/" + Number(args.number) + "/comments", { body }));
    },
  },
];

async function runTool(name, args, ctx) {
  const tool = TOOLS.find((item) => item.name === name);
  if (!tool) return "Unknown tool " + name + ". Tools: " + TOOLS.map((item) => item.name).join(", ");
  const input = args || {};
  const blocked = veto(JSON.stringify(input));
  if (blocked && blocked.startsWith("VETO")) return blocked;
  if (tool.kind === "write") {
    const ok = await ctx.confirm(tool.name);
    if (!ok) return "Cancelled. Nothing was written.";
  }
  return tool.run(input, ctx);
}

module.exports = { TOOLS, runTool, LAW };
