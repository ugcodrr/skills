#!/usr/bin/env node
// Prints a short timeline of one Claude Code or Codex session to draft a skill from: what the user asked and
// corrected, what the agent said, each tool call (its name plus the command or file), and the first line of each
// failed call. Tool output is left out, and env values, URL credentials and queries, and long tokens are masked.
// Read-only.
//
//   node thread-digest.mjs <session id, its first 8+ characters, or a .jsonl path>
//
// Looks in ~/.claude/projects/*/<id>*.jsonl and ~/.codex/sessions/**/rollout-*<id>*.jsonl.
// Exits 0, or 2 when no single log matches.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const home = homedir();
const [target] = process.argv.slice(2);

function fail(message) {
  console.error(`thread-digest: ${message}`);
  process.exit(2);
}

const list = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

function findLog(id) {
  if (id.endsWith(".jsonl")) return existsSync(id) ? id : fail(`no file ${id}`);
  if (id.length < 8) fail("give at least the first 8 characters of the session id");
  const found = [];
  const claudeRoot = join(home, ".claude", "projects");
  for (const project of list(claudeRoot).filter((entry) => entry.isDirectory())) {
    for (const file of list(join(claudeRoot, project.name))) {
      if (file.isFile() && file.name.startsWith(id) && file.name.endsWith(".jsonl")) found.push(join(claudeRoot, project.name, file.name));
    }
  }
  const walk = (dir) => {
    for (const entry of list(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.startsWith("rollout-") && entry.name.includes(id) && entry.name.endsWith(".jsonl")) found.push(path);
    }
  };
  walk(join(home, ".codex", "sessions"));
  if (found.length === 1) return found[0];
  fail(found.length ? `${found.length} logs match ${id}; pass more of the id or a path:\n${found.join("\n")}` : `no log matches ${id}`);
}

const SECRETISH = /^[\w-]*[0-9a-f]{8}-[0-9a-f]{4}-|^[A-Za-z0-9_+=-]{32,}$/i;
function mask(text) {
  return text
    .replace(/\b(\w+)=("[^"]*"|'[^']*'|\S+)/g, (whole, name, value) => (/^[A-Z_][A-Z0-9_]*$/.test(name) && value.length > 3 ? `${name}=…` : whole))
    .replace(/(\w+:\/\/)[^/\s@]*@/g, "$1")
    .replace(/(\w+:\/\/[^\s?#]+)\?\S*/g, "$1?…")
    .split(/(\s+)/)
    .map((word) => (SECRETISH.test(word) ? "…" : word))
    .join("");
}

const tilde = (path) => (path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);
const oneLine = (text, max) => {
  const flat = mask(String(text ?? "")).replaceAll(`${home}/`, "~/").replace(/\s*\n\s*/g, " ⏎ ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};
const clock = (timestamp) => (timestamp ? new Date(timestamp).toTimeString().slice(0, 5) : "--:--");

const path = target ? findLog(target) : fail("usage: thread-digest.mjs <session id or .jsonl path>");
const kind = path.includes(`${join(".codex", "sessions")}`) || basename(path).startsWith("rollout-") ? "codex" : "claude";
const records = readFileSync(path, "utf8")
  .split("\n")
  .filter(Boolean)
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

const out = [];
const callLines = new Map();
let cwd = "";
let calls = 0;
const say = (timestamp, who, text, max) => {
  const line = oneLine(text, max);
  if (line) out.push(`[${clock(timestamp)}] ${who}: ${line}`);
};
const call = (id, label) => {
  calls++;
  callLines.set(id, out.length);
  out.push(`  ${oneLine(label, 200)}`);
};
const failed = (id, text) => {
  const index = callLines.get(id);
  if (index !== undefined) out[index] += `  -> failed: ${oneLine(String(text).split("\n").find((line) => line.trim()) ?? "", 160)}`;
};

function claudeTool(block) {
  const input = block.input ?? {};
  const name = block.name.replace(/^mcp__(.+?)__(.+)$/, "$1:$2");
  if (block.name === "Bash") return `Bash: ${input.command}`;
  if (input.file_path) return `${name}: ${tilde(input.file_path)}`;
  if (block.name === "Grep") return `Grep: ${input.pattern}${input.path ? ` in ${tilde(input.path)}` : ""}`;
  if (block.name === "Glob") return `Glob: ${input.pattern}`;
  if (block.name === "Skill") return `Skill: ${input.skill}`;
  if (block.name === "WebFetch") return `WebFetch: ${String(input.url ?? "").replace(/^(\w+:\/\/[^/]+).*/, "$1")}`;
  if (input.description) return `${name}: ${input.description}`;
  return name;
}

function claudeUserText(content) {
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
  return blocks
    .filter((block) => block.type === "text")
    .map((block) =>
      block.text
        .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
        .replace(/<local-command-[\w-]+>[\s\S]*?<\/local-command-[\w-]+>/g, "")
        .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
        .replace(/<command-(?:name|args)>([\s\S]*?)<\/command-(?:name|args)>/g, "$1"),
    )
    .join(" ")
    .trim();
}

function codexCommand(name, args) {
  if (name === "exec_command") return args.cmd;
  if (name === "shell_command") return args.command;
  if (name === "shell" && Array.isArray(args.command)) return args.command.at(-1);
}

for (const record of records) {
  if (kind === "claude") {
    if (record.isSidechain || record.isMeta) continue;
    cwd ||= record.cwd ?? "";
    const content = record.message?.content;
    if (record.type === "user") {
      say(record.timestamp, "USER", claudeUserText(content), 2000);
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type !== "tool_result" || !block.is_error) continue;
        failed(block.tool_use_id, typeof block.content === "string" ? block.content : (block.content ?? []).map((part) => part.text ?? "").join("\n"));
      }
    } else if (record.type === "assistant") {
      for (const block of Array.isArray(content) ? content : []) {
        if (block.type === "text") say(record.timestamp, "AGENT", block.text, 600);
        else if (block.type === "tool_use") call(block.id, claudeTool(block));
      }
    }
    continue;
  }

  const payload = record.payload ?? {};
  if (record.type === "session_meta") cwd = payload.cwd ?? "";
  else if (payload.type === "message" && (payload.role === "user" || payload.role === "assistant")) {
    const text = (payload.content ?? []).map((block) => block.text ?? "").join(" ").trim();
    if (payload.role === "user" && /^(<\w|# AGENTS\.md)/.test(text)) continue;
    say(record.timestamp, payload.role === "user" ? "USER" : "AGENT", text, payload.role === "user" ? 2000 : 600);
  } else if (payload.type === "function_call") {
    let args = {};
    try {
      args = JSON.parse(payload.arguments ?? "{}") ?? {};
    } catch {}
    const command = codexCommand(payload.name, args);
    call(payload.call_id, command === undefined ? payload.name : `${payload.name}: ${command}`);
  } else if (payload.type === "custom_tool_call") {
    const input = String(payload.input ?? "");
    const commands = [...input.matchAll(/\bcmd\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((match) => match[2].replace(/\\n/g, "\n"));
    const files = [...input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => tilde(match[1]));
    const tools = [...new Set([...input.matchAll(/\btools\.(\w+)/g)].map((match) => match[1]))];
    const detail = commands.length ? commands.join(" ; ") : files.length ? files.join(", ") : tools.join("+");
    call(payload.call_id, detail ? `${payload.name}: ${detail}` : payload.name);
  } else if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
    const output = payload.output;
    const text = typeof output === "string" ? output : Array.isArray(output) ? output.map((block) => block.text ?? "").join("\n") : "";
    const code = /Process exited with code (\d+)/.exec(text)?.[1];
    if (code && code !== "0") failed(payload.call_id, `exit ${code}: ${text.split("Output:")[1]?.trim() ?? ""}`);
    else if (/^\s*(Script failed|Error|error:)/.test(text)) failed(payload.call_id, text);
  }
}

const times = records.map((record) => record.timestamp).filter(Boolean);
const day = times[0] ? new Date(times[0]).toLocaleDateString("en-CA") : "";
console.log(`${kind} session ${basename(path, ".jsonl").slice(-36)} in ${tilde(cwd) || "?"}, ${day} ${clock(times[0])} to ${clock(times.at(-1))}, ${calls} tool calls\n`);
console.log(out.join("\n"));
