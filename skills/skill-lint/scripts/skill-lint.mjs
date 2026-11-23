#!/usr/bin/env node
// Checks agent skills against docs/STYLE.md: frontmatter, description length and triggers, body length,
// links to files that don't exist, TODOs, private names and paths, British spelling and filler.
// Read-only. Prints `LEVEL  file:line  message`; exits 1 on any ERROR, 0 otherwise.
//
//   node skill-lint.mjs                     every skill under ./skills (or ./ if it is one)
//   node skill-lint.mjs skills/settle ...   just these skill folders, or folders of skills
//   node skill-lint.mjs --deny 'acme|my-name' ...      extra private patterns (regex, case-insensitive)
//
// Extra deny patterns also come from `.agents/skill-lint.json` in the current directory:
//   { "deny": ["my-name", "my-employer"] }
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: { deny: { type: "string", multiple: true, default: [] } },
});

const MAX_DESCRIPTION = 1024;
const SOFT_DESCRIPTION = 1000;
const MAX_BODY_LINES = 150;

const configPath = join(".agents", "skill-lint.json");
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const denyPatterns = [
  String.raw`/Users/[a-z]`,
  String.raw`/home/[a-z]`,
  ...(config.deny ?? []),
  ...options.deny,
].map((pattern) => new RegExp(pattern, "i"));

const BRITISH = {
  colour: "color",
  colours: "colors",
  centre: "center",
  centred: "centered",
  centring: "centering",
  centres: "centers",
  behaviour: "behavior",
  behaviours: "behaviors",
  cancelled: "canceled",
  cancelling: "canceling",
  grey: "gray",
  favourite: "favorite",
  favourites: "favorites",
  organise: "organize",
  organised: "organized",
  prioritise: "prioritize",
  recognise: "recognize",
  summarise: "summarize",
  optimise: "optimize",
  normalise: "normalize",
  initialise: "initialize",
  realise: "realize",
  analyse: "analyze",
  licence: "license",
  labelled: "labeled",
  modelling: "modeling",
  travelled: "traveled",
  judgement: "judgment",
};
const FILLER = /\b(robust|seamless(ly)?|leverag(e|es|ing)|delve|I hope this helps|the assistant should)\b/i;

const findings = [];
const report = (level, file, line, message) =>
  findings.push({ level, where: line ? `${relative(".", file)}:${line}` : relative(".", file), message });

const roots = positionals.length ? positionals : [existsSync("skills") ? "skills" : "."];
const skills = roots.flatMap((root) => findSkills(resolve(root)));
if (skills.length === 0) {
  console.error(`skill-lint: no SKILL.md under ${roots.join(", ")}`);
  process.exit(2);
}

const repoRoot = findRepoRoot(skills[0]);
const readme = repoRoot && existsSync(join(repoRoot, "README.md")) ? readFileSync(join(repoRoot, "README.md"), "utf8") : undefined;
const marketplacePath = repoRoot && join(repoRoot, ".claude-plugin", "marketplace.json");
const marketplace = marketplacePath && existsSync(marketplacePath) ? JSON.parse(readFileSync(marketplacePath, "utf8")) : undefined;

for (const dir of skills) lintSkill(dir);

for (const { level, where, message } of findings) console.log(`${level.padEnd(5)}  ${where}  ${message}`);
const errors = findings.filter((finding) => finding.level === "ERROR").length;
const warnings = findings.length - errors;
console.log(`\n${skills.length} skill(s), ${errors} error(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);

function findSkills(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  if (existsSync(join(dir, "SKILL.md"))) return [dir];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .flatMap((entry) => findSkills(join(dir, entry.name)));
}

function findRepoRoot(from) {
  for (let dir = from; dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, ".git")) || existsSync(join(dir, ".claude-plugin"))) return dir;
  }
}

function lintSkill(dir) {
  const file = join(dir, "SKILL.md");
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  const folder = basename(dir);

  if (lines[0] !== "---") return report("ERROR", file, 1, "no frontmatter: the file must start with ---");
  const end = lines.indexOf("---", 1);
  if (end === -1) return report("ERROR", file, 1, "frontmatter never closes with ---");
  const meta = parseFrontmatter(lines.slice(1, end));
  const bodyStart = end + 1;

  if (!meta.name) report("ERROR", file, 2, "frontmatter has no name");
  else {
    if (meta.name !== folder) report("ERROR", file, 2, `name "${meta.name}" doesn't match the folder "${folder}"`);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.name) || meta.name.length > 64)
      report("ERROR", file, 2, "name must be kebab-case, at most 64 characters");
  }

  const description = meta.description ?? "";
  if (!description) report("ERROR", file, 2, "frontmatter has no description");
  else {
    if (description.length > MAX_DESCRIPTION)
      report("ERROR", file, 2, `description is ${description.length} characters, the limit is ${MAX_DESCRIPTION}`);
    else if (description.length > SOFT_DESCRIPTION)
      report("WARN", file, 2, `description is ${description.length} characters, STYLE.md says under about ${SOFT_DESCRIPTION}`);
    if (!/\buse (it|this|when|for)\b/i.test(description))
      report("WARN", file, 2, 'description has no "Use it when/for ..." trigger list');
    if (!/["“]/.test(description)) report("WARN", file, 2, "description quotes no trigger phrases");
  }

  const bodyLines = lines.length - bodyStart;
  if (bodyLines > MAX_BODY_LINES)
    report("WARN", file, bodyStart, `body is ${bodyLines} lines, STYLE.md says under about ${MAX_BODY_LINES}; move detail to references/`);

  for (const textFile of listFiles(dir).filter((path) => /\.(md|mjs|js|ts|sh|py|json)$/.test(path))) {
    lintText(textFile, textFile === file ? bodyStart : 0, dir);
  }

  if (readme && !readme.includes(`skills/${folder}/`)) report("WARN", file, 0, "no row in README.md's skills table");
  if (marketplace) {
    const listed = marketplace.plugins?.some((plugin) =>
      (plugin.skills ?? []).some((path) => path.replace(/\/$/, "").endsWith(`skills/${folder}`)),
    );
    if (!listed) report("WARN", file, 0, "not listed in any plugin in .claude-plugin/marketplace.json");
  }
}

function lintText(file, firstLine, skillDir) {
  const isMarkdown = file.endsWith(".md");
  const lines = readFileSync(file, "utf8").split("\n");
  let inFence = false;
  lines.forEach((line, index) => {
    const at = index + 1;
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (/\b(T[O]DO|F[I]XME)\b/.test(line)) report("ERROR", file, at, "to-do or fix-me marker");
    for (const pattern of denyPatterns) {
      if (pattern.test(line)) report("ERROR", file, at, `private name or path (${pattern.source})`);
    }
    const prose = isMarkdown && !inFence ? line.replace(/`[^`]*`/g, "") : "";
    for (const word of prose.match(/[A-Za-z]+/g) ?? []) {
      const american = BRITISH[word.toLowerCase()];
      if (american) report("WARN", file, at, `British spelling "${word}", use "${american}"`);
    }
    if (index < firstLine && file.endsWith("SKILL.md")) return;
    if (!isMarkdown) return;
    if (prose.includes("—")) report("WARN", file, at, "em dash; STYLE.md asks for plain sentences");
    if (FILLER.test(prose)) report("WARN", file, at, `filler: "${prose.match(FILLER)[0]}"`);
    for (const target of linkedPaths(line)) {
      if (!existsSync(join(skillDir, target)) && !existsSync(join(dirname(file), target)))
        report("ERROR", file, at, `links to ${target}, which doesn't exist in the skill folder`);
    }
  });
}

function linkedPaths(line) {
  const paths = new Set();
  for (const [, target] of line.matchAll(/\]\(([^)#\s]+)\)/g)) {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("/") && !target.startsWith("~")) paths.add(target);
  }
  for (const [, target] of line.matchAll(/`((?:references|scripts|assets|hooks)\/[^`\s*<>]+)`/g)) paths.add(target);
  return [...paths];
}

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  });
}

function parseFrontmatter(lines) {
  const meta = {};
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (!match) continue;
    let [, key, value] = match;
    if (/^[>|][-+]?$/.test(value)) {
      const block = [];
      while (index + 1 < lines.length && /^\s+\S|^\s*$/.test(lines[index + 1])) block.push(lines[++index].trim());
      value = block.join(value.startsWith(">") ? " " : "\n").trim();
    } else if (/^(["']).*\1$/.test(value)) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return meta;
}
