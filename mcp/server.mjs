import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { TOOLS, runTool } = require("../lib/tools.js");

const tokenValue = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";

const ctx = {
  request: async (method, path, body) => {
    const { ghRequest } = require("../lib/github.js");
    if (!tokenValue) throw new Error("Set GH_TOKEN or GITHUB_TOKEN for the Copilot Hive MCP server.");
    return ghRequest(tokenValue, method, path, body);
  },
  confirm: async () => true,
  getSpec: () => "",
  saveSpec: async () => {},
};

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const raw = buffer.slice(start, start + length).toString("utf8");
    buffer = buffer.slice(start + length);
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      continue;
    }
    void handle(message);
  }
});

function send(message) {
  const json = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(json) + "\r\n\r\n" + json);
}

async function handle(message) {
  if (!message || message.jsonrpc !== "2.0") return;
  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") return;
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "copilot-hive", version: "1.0.0" },
      },
    });
    return;
  }
  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.schema,
          annotations: { readOnlyHint: tool.kind !== "write", destructiveHint: tool.kind === "write" },
        })),
      },
    });
    return;
  }
  if (message.method === "tools/call") {
    try {
      const text = await runTool(message.params?.name, message.params?.arguments || {}, ctx);
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: String(text) }] } });
    } catch (err) {
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: { isError: true, content: [{ type: "text", text: err && err.message ? err.message : String(err) }] },
      });
    }
    return;
  }
  if (message.id !== undefined) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found: " + message.method } });
  }
}
