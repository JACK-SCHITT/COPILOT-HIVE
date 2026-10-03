const API = "https://api.github.com";

async function ghRequest(token, method, path, body) {
  if (!token) throw new Error("GitHub session missing. Run Copilot Hive: Sign in to GitHub.");
  const res = await fetch(API + path, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "User-Agent": "copilot-hive",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg = data && data.message ? data.message : text || res.statusText;
    throw new Error("GitHub " + res.status + ": " + msg);
  }
  return data;
}

function clip(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "(empty)";
  if (text.length <= 12000) return text;
  return text.slice(0, 12000) + "\n…truncated";
}

function encodePath(path) {
  return String(path)
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

function need(args, keys) {
  for (const key of keys) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      throw new Error("Missing " + key);
    }
  }
}

module.exports = { ghRequest, clip, encodePath, need };
