#!/usr/bin/env node
// Sizes what tools put into agent context, from the Claude Code and Codex session logs changed since a time:
// tool-result bytes per session, tool and shell command, the largest results, files read three or more times in a
// session, and the same command five or more times in a row (likely polling). It prints sizes, tool names, paths and
// the first two words of shell commands only, never message text, tool output or whole command lines, since logs can
// hold keys.
// Read-only.
//
//   node context-audit.mjs [--since 24h | 7d | 2026-01-31T09:00Z] [--project <path substring>] [--sessions 25]
//
// Reads ~/.claude/projects/**/*.jsonl (with Agent subagents) and ~/.codex/sessions/**/rollout-*.jsonl.
// --project keeps sessions whose working directory contains the substring. Exits 0, or 2 on bad arguments
// or when neither log folder exists.
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

function fail(message) {
  console.error(`context-audit: ${message}`);
  process.exit(2);
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      since: { type: "string", default: "24h" },
      project: { type: "string" },
      sessions: { type: "string", default: "25" },
    },
  }));
} catch (error) {
  fail(error.message);
}
const relative = /^(\d+)([hd])$/.exec(values.since);
const since = relative ? Date.now() - Number(relative[1]) * (relative[2] === "h" ? 3_600_000 : 86_400_000) : Date.parse(values.since);
if (Number.isNaN(since)) fail("--since takes 24h, 7d or a time like 2026-01-31T09:00Z");
const sessionLimit = Number(values.sessions);
if (!Number.isInteger(sessionLimit) || sessionLimit < 0) fail("--sessions takes a whole number");
const project = values.project;

const home = homedir();
const claudeRoot = join(home, ".claude", "projects");
const codexRoot = join(home, ".codex", "sessions");
if (!existsSync(claudeRoot) && !existsSync(codexRoot)) fail(`no logs in ${claudeRoot} or ${codexRoot}`);

const changed = (path) => statSync(path).mtimeMs >= since;
const list = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};
const tilde = (path) => (path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path);
const toolName = (name) => name.replace(/^mcp__(.+?)__(.+)$/, "$1:$2");

// Claude names a project folder after its working directory with every other character than [A-Za-z0-9] as "-".
// Sessions are <project>/<id>.jsonl, and their Agent subagents <project>/<id>/subagents/agent-<id>.jsonl.
function claudeLogs() {
  const encoded = project?.replace(/[^A-Za-z0-9]/g, "-");
  const logs = [];
  for (const folder of list(claudeRoot).filter((entry) => entry.isDirectory())) {
    if (encoded && !folder.name.includes(encoded)) continue;
    const dir = join(claudeRoot, folder.name);
    for (const entry of list(dir)) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) logs.push({ path: join(dir, entry.name), id: entry.name.slice(0, 8) });
      if (!entry.isDirectory()) continue;
      for (const sub of list(join(dir, entry.name, "subagents")).filter((file) => file.name.endsWith(".jsonl"))) {
        logs.push({ path: join(dir, entry.name, "subagents", sub.name), id: `${entry.name.slice(0, 8)}/${sub.name.replace(/^agent-/, "").slice(0, 6)}` });
      }
    }
  }
  return logs.filter((log) => changed(log.path)).map((log) => ({ ...log, kind: "claude" }));
}

function codexLogs() {
  const logs = [];
  const walk = (dir) => {
    for (const entry of list(dir)) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/^rollout-.*\.jsonl$/.test(entry.name) && changed(path)) logs.push({ path, id: entry.name.replace(/\.jsonl$/, "").slice(-8), kind: "codex" });
    }
  };
  walk(codexRoot);
  return logs;
}

// An env assignment, a URL's credentials, path and query, or a long token can carry a key, so none is printed.
const SECRETISH = /^[\w-]*[0-9a-f]{8}-[0-9a-f]{4}-|^[A-Za-z0-9_+=-]{32,}$/i;
function safeWord(word) {
  if (/^\w+=/.test(word)) return `${word.split("=")[0]}=…`;
  const url = /^["']?\w+:\/\/(?:[^/?#\s"']*@)?([^/?#@\s"']+)(.?)/.exec(word);
  if (url) return `${url[1]}${url[2] ? "/…" : ""}`;
  return SECRETISH.test(word) ? "…" : word;
}

/** The program and script path of a shell command: its first two words, after any leading cd and env assignments. */
function commandLabel(command) {
  const segments = command.trim().split(/\n|&&|;|\|/).map((part) => part.trim()).filter(Boolean);
  const segment = segments.find((part) => !/^cd\s/.test(part)) ?? segments[0] ?? "";
  const words = segment.split(/\s+/).filter(Boolean);
  while (words.length > 1 && /^\w+=/.test(words[0])) words.shift();
  return words.slice(0, 2).map(safeWord).join(" ");
}

const READERS = new Set(["cat", "head", "tail", "sed", "less", "wc", "grep", "nl"]);
const PATHLIKE = /^[~\w@][\w./@~-]*$/;

/** Files a shell command prints with cat, head, tail, sed and the like, as paths. */
function shellReads(command) {
  const paths = [];
  for (const segment of command.split(/\n|&&|;|\|/)) {
    const words = segment.trim().split(/\s+/);
    if (!READERS.has(words[0])) continue;
    for (const word of words.slice(1)) {
      if (word.startsWith("-") || !PATHLIKE.test(word) || !/[/.]/.test(word) || /^\d/.test(word)) continue;
      paths.push(word);
    }
  }
  return paths;
}

/** A Codex shell call's command: exec_command's cmd, shell_command's string, or shell's argv (bash -lc <script>). */
function codexCommand(name, args) {
  if (name === "exec_command" && typeof args.cmd === "string") return args.cmd;
  if (name === "shell_command" && typeof args.command === "string") return args.command;
  if (name === "shell" && Array.isArray(args.command)) {
    const argv = args.command.map(String);
    return /^(ba|z)?sh$/.test(basename(argv[0] ?? "")) && /^-l?c$/.test(argv[1] ?? "") ? argv.slice(2).join(" ") : argv.join(" ");
  }
}

// Codex code mode sends one JavaScript cell per call that calls tools.<name>(...), with shell commands as cmd: "...".
function codeCellCommands(source) {
  const unescape = (text) => text.replace(/\\(.)/g, (_, char) => (char === "n" ? "\n" : char));
  return [...source.matchAll(/\bcmd\s*:\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((match) => unescape(match[2]));
}
const codeCellTools = (source) => [...new Set([...source.matchAll(/\btools\.(\w+)/g)].map((match) => toolName(match[1])))];

const digest = (value) => createHash("sha1").update(typeof value === "string" ? value : JSON.stringify(value ?? null)).digest("hex");

// Images count apart from text: their base64 size says little about their token cost, which follows their pixels.
function resultSize(content) {
  const size = { text: 0, images: 0 };
  if (typeof content === "string") size.text = Buffer.byteLength(content);
  else if (!Array.isArray(content)) size.text = content == null ? 0 : Buffer.byteLength(JSON.stringify(content));
  else {
    for (const block of content) {
      if (block?.type === "image" || block?.type === "input_image") size.images++;
      else size.text += Buffer.byteLength(block?.text ?? JSON.stringify(block));
    }
  }
  return size;
}

const described = (result) => (result.label && result.label !== result.tool ? `${result.tool}: ${result.label}` : result.tool);
const EDITS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit", "apply_patch"]);
const sessions = [];
const largest = [];
const commands = new Map();

async function audit(log) {
  const session = { ...log, place: "", total: 0, images: 0, byTool: new Map(), imagesByTool: new Map(), reads: new Map(), runs: [] };
  const calls = new Map();
  let run = null;
  let skip = false;
  const called = (id, turn, tool, label, key, readPaths, shell = false) => {
    calls.set(id, { tool, label, shell });
    for (const path of readPaths) session.reads.set(path, (session.reads.get(path) ?? 0) + 1);
    // Polling varies its input (a thread id, a pid), so a run is the same tool and label; a Codex code cell must match
    // exactly. Parallel calls from one message are a fan-out, not polling, so they count once.
    const fingerprint = digest([tool, key]);
    const runKey = tool === "exec" ? fingerprint : `${tool}\0${label}`;
    if (run?.runKey === runKey) {
      if (turn === undefined || turn !== run.turn) run.count++;
      run.turn = turn;
      run.identical &&= run.fingerprint === fingerprint;
    } else {
      if (run?.count >= 5) session.runs.push(run);
      run = { runKey, fingerprint, tool, label, turn, count: 1, identical: true };
    }
  };
  const answered = (id, { text: bytes, images }) => {
    const call = calls.get(id) ?? { tool: "unknown", label: "unknown" };
    calls.delete(id);
    session.total += bytes;
    session.images += images;
    session.byTool.set(call.tool, (session.byTool.get(call.tool) ?? 0) + bytes);
    if (images) session.imagesByTool.set(call.tool, (session.imagesByTool.get(call.tool) ?? 0) + images);
    largest.push({ tool: call.tool, label: call.label, bytes, session: session.id });
    if (call.shell) {
      const command = commands.get(described(call)) ?? { bytes: 0, count: 0 };
      commands.set(described(call), { bytes: command.bytes + bytes, count: command.count + 1 });
    }
    if (largest.length > 200) largest.sort((a, b) => b.bytes - a.bytes).splice(20);
  };
  const placed = (cwd) => {
    if (session.place || !cwd) return;
    session.place = basename(cwd);
    if (project && !cwd.includes(project)) skip = true;
  };

  const lines = createInterface({ input: createReadStream(log.path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes("tool_use") && !line.includes("tool_result") && !line.includes("_call") && !line.includes("session_meta")) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (log.kind === "claude") placed(record.cwd);
    else if (record.type === "session_meta") placed(record.payload?.cwd ?? "");
    if (skip) break;
    if (record.timestamp && Date.parse(record.timestamp) < since) continue;

    if (log.kind === "claude") {
      for (const block of Array.isArray(record.message?.content) ? record.message.content : []) {
        if (block.type === "tool_use") {
          const input = block.input ?? {};
          const tool = toolName(block.name);
          const turn = record.message.id;
          const file = typeof input.file_path === "string" ? tilde(input.file_path) : undefined;
          if (block.name === "Bash") called(block.id, turn, tool, commandLabel(input.command ?? ""), input.command, shellReads(input.command ?? ""), true);
          else called(block.id, turn, tool, file ?? tool, input, block.name === "Read" && file ? [file] : []);
        } else if (block.type === "tool_result") answered(block.tool_use_id, resultSize(block.content));
      }
      continue;
    }

    const payload = record.payload ?? {};
    if (payload.type === "function_call") {
      let args = {};
      try {
        args = JSON.parse(payload.arguments ?? "{}") ?? {};
      } catch {}
      const command = codexCommand(payload.name, args);
      const tool = toolName(payload.name);
      if (command === undefined) called(payload.call_id, undefined, tool, tool, payload.arguments, []);
      else called(payload.call_id, undefined, tool, commandLabel(command), command, shellReads(command), true);
    } else if (payload.type === "custom_tool_call") {
      const input = String(payload.input ?? "");
      const cellCommands = payload.name === "exec" ? codeCellCommands(input) : [];
      const label = cellCommands.length ? commandLabel(cellCommands[0]) : payload.name === "exec" ? codeCellTools(input).join("+") || "exec" : toolName(payload.name);
      called(payload.call_id, undefined, toolName(payload.name), label, input, cellCommands.flatMap(shellReads), cellCommands.length > 0);
    } else if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      answered(payload.call_id, resultSize(payload.output));
    }
  }
  if (skip) return;
  if (run?.count >= 5) session.runs.push(run);
  sessions.push(session);
}

const logs = [...claudeLogs(), ...codexLogs()];
for (const log of logs) await audit(log);

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const share = (part, whole) => `${whole ? Math.round((part / whole) * 100) : 0}%`;
const grand = sessions.reduce((sum, session) => sum + session.total, 0);
const imageTotal = sessions.reduce((sum, session) => sum + session.images, 0);
const ranked = sessions.filter((session) => session.total).sort((a, b) => b.total - a.total);

const scope = project ? ` in ${project}` : "";
console.log(`${sessions.length} sessions${scope} changed since ${new Date(since).toISOString()}: ${kb(grand)} of tool-result text and ${imageTotal} images\n`);

const allTools = new Map();
const allImages = new Map();
for (const session of sessions) {
  for (const [tool, bytes] of session.byTool) allTools.set(tool, (allTools.get(tool) ?? 0) + bytes);
  for (const [tool, images] of session.imagesByTool) allImages.set(tool, (allImages.get(tool) ?? 0) + images);
}
console.log("By tool, all sessions (text, share, images):");
for (const [tool, bytes] of [...allTools].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${tool.padEnd(36)} ${kb(bytes).padStart(9)}  ${share(bytes, grand).padStart(4)}${allImages.get(tool) ? `  ${allImages.get(tool)} images` : ""}`);
}

console.log(`\nPer session (top ${sessionLimit} by tool-result text): id, kind, place, text, images, then each tool's share of the text`);
for (const session of ranked.slice(0, sessionLimit)) {
  const tools = [...session.byTool].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tool, bytes]) => `${tool} ${share(bytes, session.total)}`);
  console.log(`  ${session.id.padEnd(15)} ${session.kind.padEnd(6)} ${(session.place || "-").slice(0, 36).padEnd(36)} ${kb(session.total).padStart(8)} ${String(session.images).padStart(4)}  ${tools.join(", ")}`);
}

console.log("\nLargest 20 tool results:");
for (const result of largest.sort((a, b) => b.bytes - a.bytes).slice(0, 20)) {
  console.log(`  ${kb(result.bytes).padStart(9)}  ${result.session.padEnd(15)} ${described(result)}`);
}

console.log("\nShell commands by total text, all sessions (first two words, calls, text):");
for (const [label, { bytes, count }] of [...commands].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 15)) {
  console.log(`  ${label.padEnd(40)} ${String(count).padStart(6)}  ${kb(bytes).padStart(9)}`);
}

console.log("\nFiles read three or more times in one session:");
for (const session of ranked) {
  for (const [path, count] of [...session.reads].filter(([, count]) => count >= 3).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(3)}x  ${session.id.padEnd(15)} ${tilde(path)}`);
  }
}

console.log('\nThe same tool and command five or more times in a row (edits left out; "same input" when every input matched):');
for (const session of ranked) {
  for (const run of session.runs.filter((run) => !EDITS.has(run.tool))) {
    console.log(`  ${String(run.count).padStart(3)}x  ${session.id.padEnd(15)} ${described(run)}${run.identical ? "  same input" : ""}`);
  }
}
