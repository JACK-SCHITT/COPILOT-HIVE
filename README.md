# Copilot Hive

GitHub Copilot extension for [THE UNIVERSAL HIVE](https://github.com/JACK-SCHITT/THE-UNIVERSAL-HIVE).

**Prime Directive (frozen):** Provide for all. Find the good. Never limit unnecessarily.

Copilot Hive is an editor peer. It does not unite the other hives. Sub-agents start on the base seed. A specialization exists only after the operator saves it.

## What it adds

The hive already has the law, the agent registry, the planner, and the cockpit. This extension keeps those, and gives Copilot the GitHub account desk:

- Who you are signed in as
- Repos, code search, commits, files, trees
- Issues, pull requests, branches, tags, releases
- Actions workflows and runs
- Dependabot alerts
- Projects v2, notifications, gists
- Create a repo, branch, issue, pull request, comment, or gist
- Update one file, or push up to 15 files in one commit
- Merge one pull request
- Star or unstar
- Ask `@copilot` to review an issue or pull

Writes ask first. The extension will not delete a repository, force-push, or rewrite the Prime Directive. Flood, second-master, account-takeover, and card-testing wording is vetoed before any request.

## Install

1. Clone this repo.
2. In VS Code or another Copilot editor: **Extensions: Install Extension from Location…** and choose this folder.
3. Or package it: `npx @vscode/vsce package`, then install the `.vsix`.
4. Run **Copilot Hive: Sign in to GitHub** and approve the scopes.
5. In Copilot Chat, talk to `@hive`. In agent mode, Copilot can call the `hive_*` tools on its own.

## Chat

```
@hive /seed Who are you?
@hive /agents
@hive /agents save code | Change only what the operator named.
@hive /plan Copilot editor | Reviewer | Issues, Pull requests
@hive /github me
@hive /github repos
@hive /github file JACK-SCHITT THE-UNIVERSAL-HIVE README.md
@hive /github issues JACK-SCHITT THE-UNIVERSAL-HIVE
@hive /github issue JACK-SCHITT THE-UNIVERSAL-HIVE | Title | Body
@hive /github pr JACK-SCHITT THE-UNIVERSAL-HIVE | Title | head | base | Body
```

## MCP

`.vscode/mcp.json` starts `mcp/server.mjs`. Set `GH_TOKEN` or `GITHUB_TOKEN` to a token for your own account. The server exposes the same tools. It still vetoes. Do not put the token in the repo.

## Law

- Only the operator edits a specialization.
- New agents load the base only.
- No live passwords in this repo.
- Unite stays empty.
