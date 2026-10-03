const vscode = require("vscode");
const { LAW, AGENTS } = require("./lib/law");
const { ghRequest } = require("./lib/github");
const { TOOLS, runTool } = require("./lib/tools");

const SCOPES = ["read:user", "user:email", "repo", "workflow", "gist", "notifications", "read:org", "project"];
const HELP = [
  "Copilot Hive. Law: " + LAW,
  "",
  "@hive /seed Who are you?",
  "@hive /agents",
  "@hive /agents save code | Change only what was named.",
  "@hive /plan",
  "@hive /github me",
  "@hive /github repos",
  "@hive /github file OWNER REPO path/to/file",
  "@hive /github issues OWNER REPO",
  "@hive /github pulls OWNER REPO",
  "@hive /github issue OWNER REPO | Title | Body",
  "@hive /github pr OWNER REPO | Title | head | base | Body",
  "",
  "Agent mode can call every hive_* tool. Writes ask first. No repo delete. No force-push.",
].join("\n");

function activate(context) {
  _context = context;
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.text = "$(shield) Hive · law locked";
  status.tooltip = LAW;
  status.command = "copilotHive.open";
  status.show();
  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.commands.registerCommand("copilotHive.signIn", () => session(true)),
    vscode.commands.registerCommand("copilotHive.seed", async () => {
      const prompt = await vscode.window.showInputBox({ prompt: "Ask the seed", value: "Who are you?" });
      if (!prompt) return;
      const text = await runTool("hive_seed", { prompt }, makeCtx(false));
      vscode.window.showInformationMessage(text.split("\n")[0]);
    }),
    vscode.commands.registerCommand("copilotHive.open", () => {
      vscode.commands.executeCommand("copilotHive.cockpit.focus");
    }),
    vscode.window.registerWebviewViewProvider("copilotHive.cockpit", new Cockpit(context)),
    vscode.chat.createChatParticipant("hive", (request, _chatContext, stream, token) => onChat(request, stream, token)),
  );

  for (const tool of TOOLS) {
    context.subscriptions.push(vscode.lm.registerTool(tool.name, new HiveTool(tool)));
  }
}

function deactivate() {}

class HiveTool {
  constructor(tool) {
    this.tool = tool;
  }
  prepareInvocation() {
    const confirm = this.tool.kind === "write";
    return {
      invocationMessage: "Hive · " + this.tool.name,
      confirmationMessages: confirm
        ? {
            title: "Copilot Hive wants to change GitHub",
            message: new vscode.MarkdownString("**" + this.tool.name + "** runs on the GitHub account you signed in. Law stays frozen."),
          }
        : undefined,
    };
  }
  async invoke(options) {
    try {
      const text = await runTool(this.tool.name, options.input || {}, makeCtx(false));
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(text)]);
    } catch (err) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(err && err.message ? err.message : String(err)),
      ]);
    }
  }
}

async function onChat(request, stream) {
  const command = request.command || "";
  const prompt = (request.prompt || "").trim();
  try {
    if (!command && !prompt) {
      stream.markdown(HELP);
      return;
    }
    if (command === "seed" || (!command && /who are you|prime directive|what is the hive/i.test(prompt))) {
      stream.markdown(await runTool("hive_seed", { prompt: prompt || "Who are you?" }, makeCtx(false)));
      return;
    }
    if (command === "agents") {
      stream.markdown(await runAgents(prompt));
      return;
    }
    if (command === "plan") {
      stream.markdown(await runTool("hive_plan", parsePlan(prompt), makeCtx(false)));
      return;
    }
    if (command === "github" || looksLikeGitHub(prompt)) {
      const line = command === "github" ? prompt : prompt;
      const call = parseGitHub(line);
      if (!call) {
        stream.markdown(HELP);
        return;
      }
      stream.markdown(await runTool(call.name, call.args, makeCtx(true)));
      return;
    }
    stream.markdown(await runTool("hive_seed", { prompt }, makeCtx(false)));
  } catch (err) {
    stream.markdown(err && err.message ? err.message : String(err));
  }
}

function looksLikeGitHub(prompt) {
  return /^(me|repos|file|tree|issues|pulls|branches|releases|tags|commit|code|search|actions|dependabot)\b/i.test(prompt);
}

async function runAgents(prompt) {
  const save = prompt.match(/^save\s+(\S+)\s+\|\s+([\s\S]+)$/i);
  if (save) {
    return runTool("hive_agents", { save: true, agent: save[1], prompt: save[2].trim() }, makeCtx(true));
  }
  return runTool("hive_agents", {}, makeCtx(false));
}

function parsePlan(prompt) {
  const bits = prompt.split("|").map((part) => part.trim());
  if (bits.length < 3) return {};
  return { base: bits[0], role: bits[1], packages: bits[2].split(",").map((p) => p.trim()).filter(Boolean) };
}

function parseGitHub(line) {
  const raw = line.trim();
  if (!raw || raw === "help") return null;
  const piped = raw.split("|").map((part) => part.trim());
  const head = piped[0].split(/\s+/);
  const verb = head[0].toLowerCase();
  const a = head[1];
  const b = head[2];
  const rest = head.slice(3).join(" ");
  const map = {
    me: () => ({ name: "hive_github_me", args: {} }),
    repos: () => ({ name: "hive_github_repos", args: { login: a } }),
    file: () => ({ name: "hive_github_file", args: { owner: a, repo: b, path: rest } }),
    tree: () => ({ name: "hive_github_tree", args: { owner: a, repo: b, ref: rest } }),
    issues: () => ({ name: "hive_github_issues", args: { owner: a, repo: b } }),
    pulls: () => ({ name: "hive_github_pulls", args: { owner: a, repo: b } }),
    branches: () => ({ name: "hive_github_branches", args: { owner: a, repo: b } }),
    releases: () => ({ name: "hive_github_releases", args: { owner: a, repo: b } }),
    tags: () => ({ name: "hive_github_tags", args: { owner: a, repo: b } }),
    commits: () => ({ name: "hive_github_commit", args: { owner: a, repo: b } }),
    commit: () => ({ name: "hive_github_commit", args: { owner: a, repo: b, sha: rest } }),
    code: () => ({ name: "hive_github_search_code", args: { query: piped[0].slice(5).trim() } }),
    search: () => ({ name: "hive_github_search_repos", args: { query: piped[0].slice(7).trim() } }),
    actions: () => ({ name: "hive_github_actions", args: { owner: a, repo: b } }),
    dependabot: () => ({ name: "hive_github_dependabot", args: { owner: a, repo: b } }),
    projects: () => ({ name: "hive_github_projects", args: { login: a } }),
    notifications: () => ({ name: "hive_github_notifications", args: {} }),
    gists: () => ({ name: "hive_github_gists", args: {} }),
    issue: () => ({ name: "hive_github_create_issue", args: { owner: a, repo: b, title: piped[1] || "", body: piped[2] || "" } }),
    pr: () => ({ name: "hive_github_create_pr", args: { owner: a, repo: b, title: piped[1] || "", head: piped[2] || "", base: piped[3] || "", body: piped[4] || "" } }),
    comment: () => ({ name: "hive_github_comment", args: { owner: a, repo: b, number: Number(rest), body: piped[1] || "" } }),
    branch: () => ({ name: "hive_github_create_branch", args: { owner: a, repo: b, branch: head[3], from: head[4] || "main" } }),
    merge: () => ({ name: "hive_github_merge", args: { owner: a, repo: b, number: Number(rest), method: piped[1] || "merge" } }),
    star: () => ({ name: "hive_github_star", args: { owner: a, repo: b } }),
    unstar: () => ({ name: "hive_github_star", args: { owner: a, repo: b, remove: true } }),
    "create-repo": () => ({ name: "hive_github_create_repo", args: { name: a, description: piped[1] || "", private: (piped[2] || "") === "private" } }),
    copilot: () => ({ name: "hive_github_copilot_review", args: { owner: a, repo: b, number: Number(rest), note: piped[1] || "" } }),
  };
  const build = map[verb];
  return build ? build() : null;
}

function makeCtx(fromChat) {
  return {
    request: async (method, path, body) => ghRequest(await token(), method, path, body),
    confirm: async (name) => {
      if (!fromChat) return true;
      const ask = vscode.workspace.getConfiguration("copilotHive").get("confirmWrites", true);
      if (!ask) return true;
      const choice = await vscode.window.showWarningMessage("Hive · " + name + " will change GitHub.", { modal: true }, "Do it");
      return choice === "Do it";
    },
    getSpec: (agent) => {
      const all = contextSpecs();
      return all[agent] || "";
    },
    saveSpec: async (agent, prompt) => {
      const all = contextSpecs();
      all[agent] = prompt;
      await extensionContext().globalState.update("hive.specs", all);
    },
  };
}

let _context;
function extensionContext() {
  if (!_context) throw new Error("Extension context missing");
  return _context;
}
function contextSpecs() {
  return Object.assign({}, extensionContext().globalState.get("hive.specs") || {});
}

async function token() {
  const sess = await session(false);
  if (!sess || !sess.accessToken) {
    throw new Error("GitHub session missing. Run Copilot Hive: Sign in to GitHub.");
  }
  return sess.accessToken;
}

function session(create) {
  return vscode.authentication.getSession("github", SCOPES, { createIfNone: create });
}

class Cockpit {
  constructor(context) {
    this.context = context;
    _context = context;
  }
  resolveWebviewView(webviewView) {
    webviewView.webview.options = { enableScripts: true };
    const specs = this.context.globalState.get("hive.specs") || {};
    const saved = Object.keys(specs).filter((key) => specs[key]);
    webviewView.webview.html = `<!DOCTYPE html><html><body style="font:13px/1.45 ui-monospace,monospace;color:#eeeee6;background:#0c0d0b;padding:12px">
      <p style="letter-spacing:.14em;color:#8fa87a">COPILOT HIVE</p>
      <p>${LAW}</p>
      <p style="color:#8b907f">Agents: ${AGENTS.join(", ")}</p>
      <p style="color:#8b907f">Saved: ${saved.join(", ") || "none — base only"}</p>
      <p style="color:#c9a227">Writes confirm. The directive stays frozen. Unite stays empty.</p>
    </body></html>`;
  }
}

module.exports = { activate, deactivate };
