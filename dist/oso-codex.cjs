"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli.ts
var import_node_fs15 = require("node:fs");
var import_node_path15 = __toESM(require("node:path"), 1);

// src/command.ts
var import_node_child_process = require("node:child_process");
var import_node_fs = require("node:fs");
var import_node_os = require("node:os");
var import_node_path = __toESM(require("node:path"), 1);
function captureCommand(command, cwd) {
  return captureCommandBytes(command, cwd).toString("utf8");
}
function captureCommandBytes(command, cwd) {
  const directory = (0, import_node_fs.mkdtempSync)(import_node_path.default.join((0, import_node_os.tmpdir)(), "oso-code-codex-command-"));
  const stdoutPath = import_node_path.default.join(directory, "stdout");
  const stderrPath = import_node_path.default.join(directory, "stderr");
  const stdoutFile = (0, import_node_fs.openSync)(stdoutPath, "wx", 384);
  const stderrFile = (0, import_node_fs.openSync)(stderrPath, "wx", 384);
  try {
    const outcome = (0, import_node_child_process.spawnSync)(command[0], command.slice(1), { cwd, stdio: ["ignore", stdoutFile, stderrFile], timeout: 3e4 });
    const stdout = (0, import_node_fs.readFileSync)(stdoutPath);
    const stderr = (0, import_node_fs.readFileSync)(stderrPath, "utf8");
    if (outcome.error || outcome.status !== 0) {
      const failure = outcome.error;
      throw Object.assign(new Error(`${command[0]} failed: ${failure?.message ?? (outcome.signal ? `signal ${outcome.signal}` : `exit ${outcome.status}`)}
${stderr}`, { cause: failure }), { status: outcome.status, signal: outcome.signal, code: failure?.code, stdout: stdout.toString("utf8"), stderr });
    }
    if (stderr) (0, import_node_fs.writeSync)(2, stderr);
    return stdout;
  } finally {
    (0, import_node_fs.closeSync)(stdoutFile);
    (0, import_node_fs.closeSync)(stderrFile);
    (0, import_node_fs.rmSync)(directory, { recursive: true });
  }
}

// src/project.ts
var import_node_crypto = require("node:crypto");
var import_node_fs3 = require("node:fs");
var import_node_path3 = __toESM(require("node:path"), 1);

// src/environment.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = __toESM(require("node:path"), 1);
function executableIdentity(filename) {
  try {
    const resolved = (0, import_node_fs2.realpathSync)(filename);
    const stat = (0, import_node_fs2.statSync)(resolved, { bigint: true });
    if (!stat.isFile()) return null;
    (0, import_node_fs2.accessSync)(filename, import_node_fs2.constants.X_OK);
    return [resolved, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].map(String);
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes(error.code ?? "")) return null;
    throw error;
  }
}
function executableLookup(cwd, cache) {
  const searchPath = process.env.PATH ?? (process.platform === "win32" ? "" : "/usr/bin:/bin");
  const key = JSON.stringify([cwd, searchPath]);
  const previous = cache.get(key);
  if (previous) return previous;
  const selected = /* @__PURE__ */ new Map();
  const visited = /* @__PURE__ */ new Set();
  for (const entry of searchPath.split(import_node_path2.default.delimiter)) {
    let directory;
    let names;
    try {
      directory = (0, import_node_fs2.realpathSync)(import_node_path2.default.resolve(cwd, entry));
      if (visited.has(directory)) continue;
      visited.add(directory);
      names = (0, import_node_fs2.readdirSync)(directory);
    } catch (error) {
      if (["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes(error.code ?? "")) continue;
      throw error;
    }
    for (const name of names) {
      if (selected.has(name)) continue;
      const identity = executableIdentity(import_node_path2.default.join(directory, name));
      if (identity) selected.set(name, identity);
    }
  }
  const result = Object.fromEntries([...selected].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  cache.set(key, result);
  return result;
}

// src/project.ts
function projectRoot(cwd) {
  return (0, import_node_fs3.realpathSync)(captureCommand(["git", "rev-parse", "--show-toplevel"], cwd).trim());
}
function digest(value) {
  return (0, import_node_crypto.createHash)("sha256").update(value).digest("hex");
}
function gitFileMode(project, filename) {
  const stat = (0, import_node_fs3.lstatSync)(import_node_path3.default.join(project, filename));
  if (stat.isSymbolicLink()) return "120000";
  if (!stat.isFile()) throw new Error(`Not a Git source file: ${filename}`);
  return stat.mode & 64 ? "100755" : "100644";
}
function fileModes(project, files) {
  return Object.fromEntries(Object.keys(files).map((filename) => [filename, gitFileMode(project, filename)]));
}
function scopeMatches(filename, patterns) {
  return patterns.some((pattern) => {
    if (pattern === "." || pattern === "**") return true;
    if (!pattern.includes("*") && !pattern.includes("?")) return filename === pattern || filename.startsWith(`${pattern.replace(/\/$/, "")}/`);
    const expression = pattern.match(/\*\*\/|\*\*|\*|\?|[^*?]+/g).map((part) => part === "**/" ? "(?:.*/)?" : part === "**" ? ".*" : part === "*" ? "[^/]*" : part === "?" ? "[^/]" : part.replace(/[.+^${}()|[\]\\]/g, "\\$&")).join("");
    return new RegExp(`^${expression}$`).test(filename);
  });
}
function snapshot(project, scope = ["."], includeIgnored = false) {
  if (includeIgnored) assertCheckInputs(scope);
  const names = captureCommand(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], project);
  const result = {};
  const candidates = includeIgnored ? [...names.split("\0"), ...declaredInputs(project, scope)] : names.split("\0");
  for (const name of [...new Set(candidates.filter(Boolean))].sort()) {
    if (name.startsWith(".oso-code-codex/") && !(includeIgnored && explicitInternalInput(name, scope)) || !scopeMatches(name, scope)) continue;
    const filename = import_node_path3.default.join(project, name);
    try {
      const stat = (0, import_node_fs3.lstatSync)(filename);
      if (stat.isSymbolicLink()) {
        const target = (0, import_node_fs3.realpathSync)(filename);
        if (includeIgnored && target !== project && !target.startsWith(`${project}${import_node_path3.default.sep}`)) throw new Error(`Check input ${name} links outside this project; declare reproducible local inputs`);
        if (includeIgnored && (0, import_node_fs3.lstatSync)(target).isDirectory()) throw new Error(`Check input ${name} is a directory symlink; declare its local target as an input`);
        result[name] = digest(`link:${(0, import_node_fs3.readlinkSync)(filename)}:${includeIgnored && (0, import_node_fs3.lstatSync)(target).isFile() ? digest((0, import_node_fs3.readFileSync)(target)) : ""}`);
      } else if (stat.isFile()) result[name] = digest((0, import_node_fs3.readFileSync)(filename));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return result;
}
function changedFiles(before, after) {
  return [.../* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])].filter((name) => before[name] !== after[name]);
}
function checkFingerprint(project, check, cache = /* @__PURE__ */ new Map()) {
  assertCheckInputs(check.inputs);
  const cwd = insideProject(project, check.cwd ?? ".");
  const lookup = executableLookup(cwd, cache);
  const environment = Object.fromEntries([.../* @__PURE__ */ new Set(["NODE_OPTIONS", ...check.envKeys ?? []])].filter((key) => key !== "PATH").sort().map((key) => [key, process.env[key] ?? null]));
  const executable = check.command[0];
  const entrypoint = executable.includes("/") || executable.includes("\\") ? executableIdentity(import_node_path3.default.resolve(cwd, executable)) : lookup[executable] ?? null;
  return `v2:${digest(JSON.stringify({
    check,
    files: snapshot(project, check.inputs, true),
    environment,
    lookup,
    entrypoint,
    literalPath: check.pathMode === "literal" || process.platform === "win32" ? process.env.PATH ?? null : void 0,
    runtime: [process.version, process.platform, process.arch]
  }))}`;
}
function insideProject(project, relative) {
  const resolved = (0, import_node_fs3.realpathSync)(import_node_path3.default.resolve(project, relative));
  if (resolved !== project && !resolved.startsWith(`${project}${import_node_path3.default.sep}`)) throw new Error(`Path is outside this project: ${relative}`);
  return resolved;
}
function declaredInputs(project, scope) {
  const files = /* @__PURE__ */ new Set();
  for (const pattern of scope) {
    const wildcard = pattern.search(/[*?]/);
    const prefix2 = wildcard === -1 ? pattern : pattern.slice(0, wildcard);
    const relative = wildcard === -1 ? prefix2 : prefix2.endsWith("/") ? prefix2 : import_node_path3.default.posix.dirname(prefix2);
    const root = import_node_path3.default.join(project, relative || ".");
    if (!(0, import_node_fs3.existsSync)(root)) continue;
    const pending = [root];
    while (pending.length) {
      const filename = pending.pop();
      const name = import_node_path3.default.relative(project, filename).split(import_node_path3.default.sep).join("/");
      if (name === ".git" || name.startsWith(".git/") || (name === ".oso-code-codex" || name.startsWith(".oso-code-codex/")) && !explicitInternalInput(name, scope)) continue;
      const stat = (0, import_node_fs3.lstatSync)(filename);
      if (stat.isDirectory()) pending.push(...(0, import_node_fs3.readdirSync)(filename).map((child) => import_node_path3.default.join(filename, child)));
      else files.add(name);
    }
  }
  return [...files];
}
function explicitInternalInput(name, scope) {
  return !isRuntimeRecord(name) && scope.some((pattern) => pattern.startsWith(".oso-code-codex/") && !pattern.includes("*") && !pattern.includes("?") && pattern === name);
}
function assertCheckInputs(inputs) {
  const runtimeInput = inputs.find(isRuntimeRecord);
  if (runtimeInput) throw new Error(`Runtime records cannot be check inputs: ${runtimeInput}. Declare source/configuration helpers instead`);
}
function isRuntimeRecord(filename) {
  const [directory, entry] = import_node_path3.default.posix.normalize(filename).split("/");
  return directory === ".oso-code-codex" && ["runs", "logs", "reviews", "locks", "active", "transaction.lock", "memory-pending.json"].includes(entry ?? "");
}

// src/contributions.ts
function changedCheckoutFiles(before, after) {
  return [.../* @__PURE__ */ new Set([...changedFiles(before.files, after.files), ...changedFiles(before.modes, after.modes)])].sort();
}
function matchesClosedCheckpoint(block, filename, after) {
  const present = block.closedSnapshot && Object.hasOwn(block.closedSnapshot, filename) && block.closedModes && Object.hasOwn(block.closedModes, filename);
  const deleted = block.closedDeletions?.includes(filename) && !Object.hasOwn(block.closedSnapshot ?? {}, filename) && !Object.hasOwn(block.closedModes ?? {}, filename);
  return Boolean(present && block.closedSnapshot[filename] === after.files[filename] && block.closedModes[filename] === after.modes[filename] || deleted && !Object.hasOwn(after.files, filename) && !Object.hasOwn(after.modes, filename));
}

// src/lifecycle.ts
var import_node_fs6 = require("node:fs");
var import_node_path7 = __toESM(require("node:path"), 1);

// src/store.ts
var import_node_crypto2 = require("node:crypto");
var import_node_fs4 = require("node:fs");
var import_node_path5 = __toESM(require("node:path"), 1);

// src/schema.ts
var import_node_path4 = __toESM(require("node:path"), 1);
function parseSpec(value, runIds = /* @__PURE__ */ new Set(), child = false) {
  object(value, "spec");
  identifier(value.id, "run id");
  unique(runIds, value.id);
  required(value.objective, "objective");
  required(value.principal, "principal native session id");
  if (!["plan", "roadmap", "quick", "debug", "quality-pass"].includes(String(value.mode))) throw new Error("Unsupported execution mode");
  strings(value.decisions, "decisions", true);
  if (value.recovery !== void 0) recovery(value.recovery);
  if (value.coordination !== void 0) coordination(value.coordination);
  if (value.reviewFallback !== void 0) modelConfiguration(value.reviewFallback, "reviewFallback");
  if (value.dependsOn !== void 0 && !child) throw new Error("dependsOn is only valid for a roadmap child");
  if (!Array.isArray(value.blocks) || value.blocks.length === 0) throw new Error("At least one block is required");
  if (!Array.isArray(value.checks)) throw new Error("checks must be an array");
  const checks = /* @__PURE__ */ new Set();
  for (const check of value.checks) {
    object(check, "check");
    identifier(check.id, "check id");
    unique(checks, check.id);
    strings(check.command, "command");
    paths(check.inputs, "check inputs");
    assertCheckInputs(check.inputs);
    if (check.cwd !== void 0) paths([check.cwd], "check cwd");
    if (check.resources !== void 0) strings(check.resources, "resources", true);
    if (check.envKeys !== void 0) strings(check.envKeys, "envKeys", true);
    if (check.pathMode !== void 0 && !["lookup", "literal"].includes(String(check.pathMode))) throw new Error("pathMode must be lookup or literal");
    if (check.timeoutMs !== void 0 && (typeof check.timeoutMs !== "number" || !Number.isInteger(check.timeoutMs) || check.timeoutMs < 1 || check.timeoutMs > 72e5)) throw new Error("timeoutMs must be between 1 and 7200000");
  }
  const blocks = /* @__PURE__ */ new Set();
  for (const block of value.blocks) {
    object(block, "block");
    identifier(block.id, "block id");
    unique(blocks, block.id);
    required(block.goal, "block goal");
    paths(block.scope, "block scope");
    strings(block.criteria, "block criteria");
    if (!block.criteria.includes("rubric") || !block.criteria.includes("conformance")) throw new Error("Every block requires rubric and conformance criteria");
    strings(block.checks, "block checks", true);
    for (const check of block.checks) if (!checks.has(check)) throw new Error(`Unknown required check: ${check}`);
    if (block.dependsOn !== void 0) {
      strings(block.dependsOn, "dependsOn", true);
      for (const dependency of block.dependsOn) if (dependency === block.id || !blocks.has(dependency)) throw new Error(`Dependency must precede block: ${dependency}`);
    }
    if (block.review !== void 0 && !["general", "security", "design"].includes(String(block.review))) throw new Error("Invalid review dimension");
  }
  if (value.publication !== void 0 && typeof value.publication !== "boolean") throw new Error("publication must be boolean");
  if (value.children !== void 0) {
    if (value.mode !== "roadmap" || !Array.isArray(value.children)) throw new Error("Only a roadmap can authorize children");
    const preceding = /* @__PURE__ */ new Set();
    for (const child2 of value.children) {
      parseSpec(child2, runIds, true);
      const record = child2;
      if (record.dependsOn !== void 0) {
        strings(record.dependsOn, "child dependsOn", true);
        for (const dependency of record.dependsOn) if (!preceding.has(dependency)) throw new Error(`Child dependency must be a preceding sibling: ${dependency}`);
      }
      preceding.add(record.id);
    }
  }
  return value;
}
function assertAutoRecoveryPolicy(value, context = "") {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("mode" in value) || value.mode !== "auto") throw new Error(`${context}auto recovery must be an object with mode auto`);
  const policy = value;
  if (policy.maxCorrections !== void 0 && (typeof policy.maxCorrections !== "number" || !Number.isSafeInteger(policy.maxCorrections) || policy.maxCorrections < 1)) throw new Error(`${context}recovery.maxCorrections must be a positive safe integer`);
  if (Object.keys(policy).some((key) => key !== "mode" && key !== "maxCorrections")) throw new Error(`${context}auto recovery accepts only mode and maxCorrections`);
}
function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}
function required(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonempty text`);
}
function identifier(value, label) {
  required(value, label);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) throw new Error(`${label} must contain lowercase letters, numbers or hyphens`);
}
function strings(value, label, empty = false) {
  if (!Array.isArray(value) || !empty && value.length === 0) throw new Error(`${label} must be ${empty ? "an" : "a nonempty"} array`);
  for (const entry of value) required(entry, label);
  if (new Set(value).size !== value.length) throw new Error(`${label} contains duplicates`);
}
function paths(value, label) {
  strings(value, label);
  for (const entry of value) if (import_node_path4.default.isAbsolute(entry) || entry.split(/[\\/]/).includes("..") || entry.includes("\0") || entry.includes("\\")) throw new Error(`${label} must be project-relative paths or globs`);
}
function recovery(value) {
  object(value, "recovery");
  if (value.mode === "auto") {
    assertAutoRecoveryPolicy(value);
    return;
  }
  if (typeof value.maxCorrections !== "number" || !Number.isSafeInteger(value.maxCorrections) || value.maxCorrections < 1) throw new Error("recovery.maxCorrections must be a positive safe integer");
  if (Object.keys(value).some((key) => key !== "maxCorrections")) throw new Error("recovery accepts only maxCorrections, or mode auto");
}
function coordination(value) {
  object(value, "coordination");
  if (Object.keys(value).some((key) => key !== "maxActiveAgents") || typeof value.maxActiveAgents !== "number" || !Number.isSafeInteger(value.maxActiveAgents) || value.maxActiveAgents < 1) throw new Error("coordination.maxActiveAgents must be a positive safe integer");
}
function modelConfiguration(value, label) {
  object(value, label);
  if (Object.keys(value).some((key) => key !== "model" && key !== "reasoningEffort" && key !== "forkTurns") || typeof value.model !== "string" || !value.model.trim() || typeof value.reasoningEffort !== "string" || !value.reasoningEffort.trim() || value.forkTurns !== void 0 && value.forkTurns !== "none") throw new Error(`${label} requires model, reasoningEffort and optional forkTurns:none`);
}
function unique(seen, name) {
  if (seen.has(name)) throw new Error(`Duplicate id: ${name}`);
  seen.add(name);
}

// src/roadmap-lineage.ts
function roadmapBaseline(parent, child) {
  return { parentRun: parent.spec.id, parentDigest: parent.specDigest, child: child.id, originalSpecDigest: digest(JSON.stringify(child)) };
}
function promoteRoadmapLineageRecord(run) {
  run.version = 5;
  run.readerMinimumVersion = 5;
}
function retainLegacyWriterAttribution(run) {
  for (const block of run.blocks) {
    if (block.contributions !== void 0) continue;
    block.contributions = [];
    if (block.unattributedWriters === void 0 && block.writers.length) block.unattributedWriters = [...block.writers];
  }
}
function roadmapParentId(run) {
  return run.roadmapLineage?.baseline.parentRun ?? run.roadmapOrigin?.parentRun;
}
function hasValidRoadmapLineage(run) {
  const lineage = run.roadmapLineage;
  if (!lineage || run.version !== 5 || run.readerMinimumVersion !== 5) return false;
  if (!matchesAuthority(run.roadmapOrigin, lineage.baseline) || !digestValue(lineage.baseline.originalSpecDigest)) return false;
  let expected = lineage.baseline.originalSpecDigest;
  const seen = /* @__PURE__ */ new Set([expected]);
  for (const amendment of lineage.amendments) {
    if (amendment.fromDigest !== expected || seen.has(amendment.toDigest) || !isUserApproval(amendment.authorization) || amendment.authorization.specDigest !== amendment.toDigest || !["additive", "replacement"].includes(amendment.compatibility) || !["amend", "legacy-reconcile"].includes(amendment.provenance) || !timestamp(amendment.at) || !digestValue(amendment.toDigest)) return false;
    expected = amendment.toDigest;
    seen.add(expected);
  }
  return expected === run.specDigest;
}
function childSatisfiesRoadmap(parent, specification, child) {
  const originalDigest = digest(JSON.stringify(specification));
  const authority = { parentRun: parent.spec.id, parentDigest: parent.specDigest, child: child.spec.id };
  const lineage = child.roadmapLineage;
  if (lineage) return hasValidRoadmapLineage(child) && matchesAuthority(lineage.baseline, authority) && lineage.baseline.originalSpecDigest === originalDigest && lineage.amendments.every((amendment) => amendment.compatibility === "additive") && lineageApprovalMatches(child, authority, lineage);
  if (child.specDigest !== originalDigest) return false;
  return (!child.roadmapOrigin || matchesAuthority(child.roadmapOrigin, authority)) && roadmapApprovalMatches(child, authority);
}
function applyRoadmapAmendment(run, parent, specification, approval) {
  const original = originalChild(parent, run);
  const lineage = existingOrNewLineage(run, parent, original);
  const previous = run.spec;
  const compatibility = isAdditive(previous, specification) && isAdditive(original, specification) ? "additive" : "replacement";
  reopenAffectedClosedBlocks(run, previous, specification);
  for (const block of specification.blocks) if (!run.blocks.some((entry) => entry.id === block.id)) run.blocks.push(specification.coordination || specification.reviewFallback ? { id: block.id, status: "pending", writers: [], contributions: [], reviews: [], findings: [], rounds: [] } : { id: block.id, status: "pending", writers: [specification.principal], implementationTier: "luna", reviews: [], findings: [], rounds: [] });
  const now = (/* @__PURE__ */ new Date()).toISOString();
  run.roadmapLineage = { ...lineage, amendments: [...lineage.amendments, { fromDigest: run.specDigest, toDigest: approval.specDigest, authorization: approval, compatibility, at: now, provenance: "amend" }] };
  run.spec = specification;
  run.specDigest = approval.specDigest;
  run.approval = approval;
  if (specification.coordination || specification.reviewFallback) retainLegacyWriterAttribution(run);
  promoteRoadmapLineageRecord(run);
  run.events.push({ at: now, action: "amend-from", detail: JSON.stringify(previous) });
}
function reconcileRoadmapChild(project, parentId, childId) {
  return transaction(project, () => {
    const parent = readRun(project, parentId);
    const child = readRun(project, childId);
    const original = originalChild(parent, child);
    requireApprovedParent(parent);
    if (!matchesAuthority(child.roadmapOrigin, roadmapBaseline(parent, original))) throw new Error("Legacy roadmap reconciliation requires the exact durable original parent binding");
    if (child.roadmapLineage) {
      if (!childSatisfiesRoadmap(parent, original, child)) throw new Error("Existing roadmap lineage is structurally inconsistent; no reconciliation was applied");
      return child;
    }
    if (child.specDigest === digest(JSON.stringify(original))) throw new Error("Exact legacy child already satisfies the approved roadmap");
    const authorization = currentUserApproval(child);
    const sequence = legacySequence(child, original);
    if (!sequence.slice(1).every((specification, index) => isAdditive(sequence[index], specification))) throw new Error("Legacy roadmap history changes original obligations; reconciliation requires an additive chain");
    const baseline = roadmapBaseline(parent, original);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    child.roadmapLineage = { baseline, amendments: [{ fromDigest: baseline.originalSpecDigest, toDigest: child.specDigest, authorization, compatibility: "additive", at: now, provenance: "legacy-reconcile" }] };
    promoteRoadmapLineageRecord(child);
    child.events.push({ at: now, action: "roadmap-reconcile", detail: authorization.reference });
    writeRun(child);
    return child;
  });
}
function isAdditive(previous, next) {
  return previous.id === next.id && previous.mode === next.mode && previous.objective === next.objective && previous.principal === next.principal && equal(previous.recovery, next.recovery) && policyAdditive(previous, next) && previous.publication === next.publication && prefix(previous.decisions, next.decisions) && prefix(previous.checks, next.checks) && prefix(previous.dependsOn ?? [], next.dependsOn ?? []) && prefixBlocks(previous.blocks, next.blocks) && equal(previous.children, next.children);
}
function policyAdditive(previous, next) {
  return (previous.coordination === void 0 || equal(previous.coordination, next.coordination)) && (previous.reviewFallback === void 0 || equal(previous.reviewFallback, next.reviewFallback));
}
function originalChild(parent, child) {
  requireApprovedParent(parent);
  const specification = parent.spec.children?.find((entry) => entry.id === child.spec.id);
  if (!specification) throw new Error("Roadmap child is not embedded in the approved parent");
  return specification;
}
function existingOrNewLineage(run, parent, original) {
  if (!run.roadmapLineage) {
    if (run.specDigest !== digest(JSON.stringify(original))) throw new Error("Legacy amended roadmap child requires roadmap reconcile before another amendment");
    return { baseline: roadmapBaseline(parent, original), amendments: [] };
  }
  const baseline = roadmapBaseline(parent, original);
  if (!hasValidRoadmapLineage(run) || !equal(run.roadmapLineage.baseline, baseline)) throw new Error("Roadmap lineage no longer matches its approved original child");
  return run.roadmapLineage;
}
function reopenAffectedClosedBlocks(run, previous, next) {
  const changedChecks = new Set(next.checks.filter((check) => !equal(check, previous.checks.find((entry) => entry.id === check.id))).map((check) => check.id));
  for (const state of run.blocks.filter((block) => block.status === "closed")) {
    const prior = previous.blocks.find((block) => block.id === state.id);
    const amended = next.blocks.find((block) => block.id === state.id);
    if (!prior || !amended || equal(prior, amended) && !amended.checks.some((check) => changedChecks.has(check))) continue;
    state.status = "pending";
    delete state.closedSnapshot;
    delete state.closedModes;
    delete state.closedDeletions;
    delete state.externalFulfillment;
  }
}
function legacySequence(child, original) {
  const prior = child.events.filter((event2) => event2.action === "amend-from").map((event2) => parseLegacySpec(event2.detail));
  const sequence = [...prior, child.spec];
  if (!sequence.length || digest(JSON.stringify(sequence[0])) !== digest(JSON.stringify(original))) throw new Error("Legacy roadmap amendment history does not begin at the approved child");
  const digests = sequence.map((specification) => digest(JSON.stringify(specification)));
  if (new Set(digests).size !== digests.length) throw new Error("Legacy roadmap amendment history is cyclic or ambiguous");
  if (sequence.some((specification) => specification.id !== child.spec.id)) throw new Error("Legacy roadmap amendment history has a conflicting child identity");
  return sequence;
}
function parseLegacySpec(detail) {
  try {
    const value = JSON.parse(detail);
    if (!value || typeof value !== "object" || !Array.isArray(value.blocks) || !Array.isArray(value.checks)) throw new Error("invalid");
    return value;
  } catch {
    throw new Error("Legacy roadmap amendment history is partial or unparsable");
  }
}
function currentUserApproval(run) {
  if (!isUserApproval(run.approval) || run.approval.specDigest !== run.specDigest) throw new Error("Legacy roadmap reconciliation needs actual current user authorization for this child digest");
  return run.approval;
}
function requireApprovedParent(parent) {
  if (parent.spec.mode !== "roadmap" || !parent.approval || parent.status === "closed" || parent.specDigest !== digest(JSON.stringify(parent.spec))) throw new Error("Reconciliation requires an approved unchanged unfinished roadmap parent");
}
function matchesAuthority(actual, expected) {
  return actual?.parentRun === expected.parentRun && actual.parentDigest === expected.parentDigest && actual.child === expected.child;
}
function isUserApproval(approval) {
  return approval?.kind === "user" && Boolean(approval.reference?.trim()) && Boolean(approval.message?.trim()) && digestValue(approval.specDigest);
}
function lineageApprovalMatches(child, authority, lineage) {
  const amendment = lineage.amendments.at(-1);
  if (!amendment) return roadmapApprovalMatches(child, authority);
  return child.approval?.kind === "user" && equal(child.approval, amendment.authorization) && child.approval.specDigest === child.specDigest;
}
function roadmapApprovalMatches(child, authority) {
  return child.approval?.kind === "roadmap" && matchesAuthority(child.approval, authority);
}
function prefix(previous, next) {
  return previous.length <= next.length && previous.every((entry, index) => equal(entry, next[index]));
}
function prefixBlocks(previous, next) {
  return previous.length <= next.length && previous.every((block, index) => {
    const candidate = next[index];
    return candidate?.id === block.id && candidate.goal === block.goal && candidate.review === block.review && prefix(block.scope, candidate.scope) && prefix(block.criteria, candidate.criteria) && prefix(block.checks, candidate.checks) && prefix(block.dependsOn ?? [], candidate.dependsOn ?? []);
  });
}
function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function digestValue(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function timestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

// src/model-policy.ts
function tierRank(tier) {
  const index = ["luna", "terra", "astra"].indexOf(tier);
  if (index === -1) throw new Error(`Unknown model tier: ${tier}`);
  return index;
}
function configurationTier(configuration) {
  if (!configuration) return void 0;
  if (configuration.model === "gpt-5.6-luna") return "luna";
  if (configuration.model === "gpt-5.6-terra") return "terra";
  if (configuration.model === "gpt-6-astra") return "astra";
  return void 0;
}
function sameConfiguration(left, right) {
  return left?.model === right?.model && left?.reasoningEffort === right?.reasoningEffort && left?.forkTurns === right?.forkTurns;
}
function sameModelConfiguration(left, right) {
  return left?.model === right?.model && left?.reasoningEffort === right?.reasoningEffort;
}
function configurationCovers(reviewer, implementation) {
  if (!reviewer || !implementation) return false;
  const reviewerTier = configurationTier(reviewer);
  const implementationTier = configurationTier(implementation);
  if (reviewerTier && implementationTier) return tierRank(reviewerTier) >= tierRank(implementationTier);
  return sameModelConfiguration(reviewer, implementation);
}

// src/store.ts
function stateDirectory(project) {
  return import_node_path5.default.join(project, ".oso-code-codex");
}
function initializeStore(project) {
  const directory = stateDirectory(project);
  (0, import_node_fs4.mkdirSync)(directory, { recursive: true, mode: 448 });
  (0, import_node_fs4.mkdirSync)(import_node_path5.default.join(directory, "runs"), { recursive: true, mode: 448 });
  (0, import_node_fs4.writeFileSync)(import_node_path5.default.join(directory, ".gitignore"), "*\n");
}
function readRun(project, id) {
  const directory = stateDirectory(project);
  const selected = id ?? (0, import_node_fs4.readFileSync)(import_node_path5.default.join(directory, "active"), "utf8").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(selected)) throw new Error("Invalid run id");
  const current = import_node_path5.default.join(directory, "runs", `${selected}.json`);
  const run = JSON.parse((0, import_node_fs4.readFileSync)((0, import_node_fs4.existsSync)(current) ? current : import_node_path5.default.join(directory, `${selected}.json`), "utf8"));
  if (run.version !== 1 && run.version !== 2 && run.version !== 3 && run.version !== 4 && run.version !== 5 || run.project !== project) throw new Error("Unsupported or mismatched run record; no migration was applied");
  if (run.readerMinimumVersion && (run.readerMinimumVersion > 5 || run.readerMinimumVersion > run.version)) throw new Error(`Run requires runtime reader version ${run.readerMinimumVersion}; no migration was applied`);
  assertRecoveryRecord(run);
  assertExternalFulfillments(run);
  assertTruthfulAccountingRecord(run);
  if (run.roadmapLineage && !hasValidRoadmapLineage(run)) throw new Error("Roadmap lineage is malformed or discontinuous; no migration was applied");
  return run;
}
function listRuns(project) {
  const directory = stateDirectory(project);
  const records = import_node_path5.default.join(directory, "runs");
  const ids = new Set((0, import_node_fs4.existsSync)(records) ? (0, import_node_fs4.readdirSync)(records).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)) : []);
  if ((0, import_node_fs4.existsSync)(import_node_path5.default.join(directory, "active"))) ids.add((0, import_node_fs4.readFileSync)(import_node_path5.default.join(directory, "active"), "utf8").trim());
  return [...ids].sort().map((id) => readRun(project, id));
}
function writeRun(run) {
  assertRecoveryRecord(run);
  assertExternalFulfillments(run);
  assertTruthfulAccountingRecord(run);
  (0, import_node_fs4.mkdirSync)(import_node_path5.default.join(stateDirectory(run.project), "runs"), { recursive: true, mode: 448 });
  run.updated = (/* @__PURE__ */ new Date()).toISOString();
  atomicWrite(import_node_path5.default.join(stateDirectory(run.project), "runs", `${run.spec.id}.json`), JSON.stringify(run, null, 2) + "\n");
}
function selectRun(run) {
  atomicWrite(import_node_path5.default.join(stateDirectory(run.project), "active"), `${run.spec.id}
`);
}
function transaction(project, action) {
  const release = acquireLock(import_node_path5.default.join(stateDirectory(project), "transaction.lock"));
  try {
    return action();
  } finally {
    release();
  }
}
function acquireLock(directory) {
  (0, import_node_fs4.mkdirSync)(import_node_path5.default.dirname(directory), { recursive: true, mode: 448 });
  try {
    (0, import_node_fs4.mkdirSync)(directory);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const ownerPath = import_node_path5.default.join(directory, "owner.json");
    if (!(0, import_node_fs4.existsSync)(ownerPath)) throw new Error(`Lock is initializing or requires inspection: ${directory}`);
    const owner = JSON.parse((0, import_node_fs4.readFileSync)(ownerPath, "utf8"));
    if (processAlive(owner)) throw new Error(`Resource is busy (pid ${owner.pid}): ${directory}`);
    (0, import_node_fs4.rmSync)(directory, { recursive: true });
    (0, import_node_fs4.mkdirSync)(directory);
  }
  const token = (0, import_node_crypto2.randomUUID)();
  (0, import_node_fs4.writeFileSync)(import_node_path5.default.join(directory, "owner.json"), JSON.stringify({ ...processIdentity(process.pid), token }));
  return () => {
    if (!(0, import_node_fs4.existsSync)(directory)) return;
    const current = JSON.parse((0, import_node_fs4.readFileSync)(import_node_path5.default.join(directory, "owner.json"), "utf8"));
    if (current.token === token) (0, import_node_fs4.rmSync)(directory, { recursive: true });
  };
}
function processIdentity(pid) {
  if (process.platform !== "linux") return { pid };
  const namespace = (0, import_node_fs4.readlinkSync)("/proc/self/ns/pid");
  try {
    const stat = (0, import_node_fs4.readFileSync)(`/proc/${pid}/stat`, "utf8");
    return { pid, namespace, start: stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] };
  } catch (error) {
    if (error.code === "ENOENT") return { pid, namespace };
    throw error;
  }
}
function processAlive(identity) {
  if (process.platform === "linux" && identity.namespace !== (0, import_node_fs4.readlinkSync)("/proc/self/ns/pid")) return true;
  try {
    process.kill(identity.pid, 0);
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code !== "EPERM") throw error;
  }
  return !identity.start || processIdentity(identity.pid).start === identity.start;
}
function requireStoppedIdentity(identity) {
  if (process.platform === "linux" && identity.namespace !== (0, import_node_fs4.readlinkSync)("/proc/self/ns/pid")) return;
  if (processAlive(identity)) throw new Error(`Owned process ${identity.pid} is visibly still alive; wait on its native handle`);
}
function releaseStoppedCheckLocks(project, owner, sharedLocks) {
  const directory = stateDirectory(project);
  const locks = import_node_path5.default.join(directory, "locks");
  const candidates = [import_node_path5.default.join(directory, "transaction.lock"), ...(0, import_node_fs4.existsSync)(locks) ? (0, import_node_fs4.readdirSync)(locks).map((name) => import_node_path5.default.join(locks, name)) : [], ...sharedLocks && (0, import_node_fs4.existsSync)(sharedLocks) ? (0, import_node_fs4.readdirSync)(sharedLocks).map((name) => import_node_path5.default.join(sharedLocks, name)) : []];
  for (const candidate of candidates) {
    const filename = import_node_path5.default.join(candidate, "owner.json");
    if (!(0, import_node_fs4.existsSync)(filename)) continue;
    const current = JSON.parse((0, import_node_fs4.readFileSync)(filename, "utf8"));
    if (current.pid === owner.pid && current.start === owner.start && current.namespace === owner.namespace) (0, import_node_fs4.rmSync)(candidate, { recursive: true });
  }
}
function atomicWrite(filename, content) {
  const temporary = `${filename}.${(0, import_node_crypto2.randomUUID)()}.tmp`;
  (0, import_node_fs4.writeFileSync)(temporary, content, { mode: 384, flag: "wx" });
  (0, import_node_fs4.renameSync)(temporary, filename);
}
function assertRecoveryRecord(run) {
  if (run.version < 3 && (run.recovery !== void 0 || run.recoveryControl !== void 0)) throw new Error("Recovery policy requires a version 3 run record; no migration was applied");
  if (run.version < 3) return;
  const hasFulfillment = run.version >= 4 && run.blocks.some((block) => block.externalFulfillments?.length);
  const hasLineage = run.version === 5 && run.roadmapLineage !== void 0;
  const hasTruthfulAccounting = run.version === 5 && (run.spec.coordination !== void 0 || run.spec.reviewFallback !== void 0);
  if (run.readerMinimumVersion !== run.version || !run.recovery && !run.recoveryControl && !hasFulfillment && !hasLineage && !hasTruthfulAccounting) throw new Error(`Version ${run.version} run record is missing its recovery, external fulfillment, roadmap lineage or truthful-accounting state; no migration was applied`);
  if (run.recovery) assertRecoveryState(run);
  if (run.recoveryControl) assertRecoveryControl(run);
}
function assertRecoveryState(run) {
  const recovery2 = run.recovery;
  if (!identifier2(recovery2.owner) || !digest2(recovery2.specDigest) || recovery2.initialLimit !== void 0 && !positive(recovery2.initialLimit) || recovery2.adoptedUsed !== void 0 && !nonnegative(recovery2.adoptedUsed)) throw new Error("Version 3 recovery policy state is malformed; no migration was applied");
  if (run.spec.id !== recovery2.owner && (recovery2.initialLimit !== void 0 || recovery2.adoptedUsed !== void 0 || recovery2.grants?.length)) throw new Error("Only the recovery owner may store recovery grants; no migration was applied");
  if (recovery2.grants !== void 0 && !Array.isArray(recovery2.grants)) throw new Error("Version 3 recovery grants are malformed; no migration was applied");
  for (const grant of recovery2.grants ?? []) {
    const authorization = grant?.authorization;
    if (!positive(grant?.additionalCorrections) || !authorization || authorization.kind !== "user" || !text(authorization.reference) || !text(authorization.message) || authorization.specDigest !== recovery2.specDigest) throw new Error("Version 3 recovery grant is malformed; no migration was applied");
  }
  if (run.version === 3 && (recovery2.policy !== void 0 || recovery2.policySource !== void 0 || recovery2.adoptions !== void 0)) throw new Error("Version 3 recovery policy cannot contain auto policy state; no migration was applied");
  if (run.version < 4) return;
  if (run.spec.id !== recovery2.owner) {
    if (recovery2.policy !== void 0 || recovery2.policySource !== void 0 || recovery2.adoptions !== void 0) throw new Error("Only the recovery owner may store auto recovery policy state; no migration was applied");
    return;
  }
  if (recovery2.policy === void 0 && recovery2.policySource === void 0 && recovery2.adoptions === void 0 && run.spec.recovery?.mode !== "auto") return;
  assertAutoRecoveryPolicy(recovery2.policy, "Version 4 auto recovery policy state is malformed; no migration was applied: ");
  if (!["spec", "adoption"].includes(recovery2.policySource ?? "") || !Array.isArray(recovery2.adoptions)) throw new Error("Version 4 auto recovery policy state is malformed; no migration was applied");
  for (const adoption of recovery2.adoptions) {
    assertAutoRecoveryPolicy(adoption?.policy, "Version 4 recovery adoption is malformed; no migration was applied: ");
    const authorization = adoption?.authorization;
    if (!authorization || authorization.kind !== "user" || !text(authorization.reference) || !text(authorization.message) || authorization.specDigest !== recovery2.specDigest || !timestamp2(adoption.at)) throw new Error("Version 4 recovery adoption is malformed; no migration was applied");
  }
  const declared = recovery2.policySource === "spec" ? run.spec.recovery : recovery2.adoptions.at(-1)?.policy;
  if (declared?.mode !== "auto" || declared.maxCorrections !== recovery2.policy.maxCorrections || recovery2.policySource === "spec" && recovery2.adoptions.length > 0) throw new Error("Version 4 auto recovery policy does not match its declared source; no migration was applied");
}
function assertRecoveryControl(run) {
  const control = run.recoveryControl;
  if (!Array.isArray(control.strategies) || !Array.isArray(control.progress)) throw new Error("Version 3 recovery control state is malformed; no migration was applied");
  for (const strategy of control.strategies) {
    const diagnosis = strategy?.diagnosis;
    if (!identifier2(strategy?.block) || !digest2(strategy?.failureKey) || !nonnegative(strategy?.round) || !diagnosis || !text(diagnosis.agent) || !text(diagnosis.report) || !texts(diagnosis.evidence) || diagnosis.delivery && (!timestamp2(diagnosis.delivery.at) || !text(diagnosis.delivery.report)) || !text(strategy.approach) || !timestamp2(strategy.at) || strategy.progress && !validComparableProgress(strategy.progress)) throw new Error("Version 3 recovery strategy is malformed; no migration was applied");
  }
  for (const progress of control.progress) {
    if (!progress || !["check", "finding"].includes(progress.kind) || !identifier2(progress.block) || !nonnegative(progress.round) || !timestamp2(progress.at) || progress.revokedAt !== void 0 && (run.version < 4 || !timestamp2(progress.revokedAt)) || progress.kind === "check" && !text(progress.attempt) || progress.kind === "finding" && (!text(progress.id) || !text(progress.evidence) || !text(progress.resolution))) throw new Error("Recovery progress is malformed or uses unsupported revocation state; no migration was applied");
  }
}
function assertTruthfulAccountingRecord(run) {
  const enabled = run.spec.coordination !== void 0 || run.spec.reviewFallback !== void 0;
  if (!enabled) {
    if (truthfulMetadata(run)) throw new Error("Truthful accounting metadata requires a version 5 approved adoption; no migration was applied");
    if (run.version === 5 && !run.roadmapLineage) throw new Error("Version 5 run record lacks complete roadmap lineage or truthful-accounting state; no migration was applied");
    return;
  }
  if (run.version !== 5 || run.readerMinimumVersion !== 5) throw new Error("Truthful accounting requires a complete version 5 run record; no migration was applied");
  if (run.spec.coordination && (!positive(run.spec.coordination.maxActiveAgents) || Object.keys(run.spec.coordination).some((key) => key !== "maxActiveAgents"))) throw new Error("Truthful accounting coordination is malformed; no migration was applied");
  if (run.spec.reviewFallback && !modelConfiguration2(run.spec.reviewFallback)) throw new Error("Truthful accounting review fallback is malformed; no migration was applied");
  if (new Set(run.blocks.map((block) => block.id)).size !== run.blocks.length || run.blocks.some((block) => !run.spec.blocks.some((specification) => specification.id === block.id))) throw new Error("Truthful accounting blocks are not linked to the approved specification; no migration was applied");
  for (const block of run.blocks) {
    if (!Array.isArray(block.contributions)) throw new Error("Truthful accounting blocks require retained contribution history; no migration was applied");
    if (block.unattributedWriters !== void 0 && !texts(block.unattributedWriters)) throw new Error("Truthful accounting legacy authors are malformed; no migration was applied");
    for (const contribution of block.contributions) {
      if (!text(contribution?.actor) || !texts(contribution?.scope) || !text(contribution?.evidence) || !timestamp2(contribution?.at) || contribution.configuration !== void 0 && !modelConfiguration2(contribution.configuration)) throw new Error("Truthful accounting contribution is malformed; no migration was applied");
      if (!contributionActor(run, block, contribution)) throw new Error("Truthful accounting contribution lacks its delivered assigned native author; no migration was applied");
    }
    if (!completeWriters(block)) throw new Error("Truthful accounting writers omit or invent retained authors; no migration was applied");
  }
  for (const agent of run.agents) {
    if (agent.requestedConfiguration !== void 0 && !nativeConfiguration(agent.requestedConfiguration) || agent.observedConfiguration !== void 0 && !modelConfiguration2(agent.observedConfiguration) || agent.observations !== void 0 && (!Array.isArray(agent.observations) || agent.observations.some((observation) => !timestamp2(observation?.at) || !modelConfiguration2(observation?.configuration)))) throw new Error("Truthful accounting native configuration is malformed; no migration was applied");
    if (!agentAssignments(run, agent)) throw new Error("Truthful accounting native assignment history is malformed; no migration was applied");
  }
  if (run.principalObservations !== void 0 && (!Array.isArray(run.principalObservations) || run.principalObservations.some((observation) => !timestamp2(observation?.at) || !modelConfiguration2(observation?.configuration)))) throw new Error("Truthful accounting principal observation is malformed; no migration was applied");
}
function truthfulMetadata(run) {
  return run.principalObservations !== void 0 || run.blocks.some((block) => block.contributions !== void 0 || block.unattributedWriters !== void 0) || run.agents.some((agent) => agent.requestedConfiguration !== void 0 || agent.observedConfiguration !== void 0 || agent.observations !== void 0 || agent.replacementFor !== void 0 || agent.assignments !== void 0);
}
function contributionActor(run, block, contribution) {
  if (contribution.actor === run.spec.principal) return contribution.scope.every((scope) => scopeCoveredBy(blockScope(run, block), scope));
  const agent = run.agents.find((entry) => entry.id === contribution.actor);
  return Boolean(agent && agent.role === "applier" && agent.deliveries?.length && agent.assignments?.some((assignment) => assignment.block === block.id && contribution.scope.every((scope) => scopeCoveredBy(assignment.scope, scope))));
}
function completeWriters(block) {
  const authors = /* @__PURE__ */ new Set([...block.unattributedWriters ?? [], ...(block.contributions ?? []).map((contribution) => contribution.actor)]);
  return new Set(block.unattributedWriters ?? []).size === (block.unattributedWriters?.length ?? 0) && new Set(block.writers).size === block.writers.length && block.writers.length === authors.size && block.writers.every((writer) => authors.has(writer));
}
function agentAssignments(run, agent) {
  const metadata = agent.requestedConfiguration !== void 0 || agent.observedConfiguration !== void 0 || agent.observations !== void 0 || agent.replacementFor !== void 0;
  if (!metadata) return agent.assignments === void 0 || Array.isArray(agent.assignments);
  if (!Array.isArray(agent.assignments) || !agent.assignments.length) return false;
  if (agent.requestedConfiguration && !agent.assignments.some((assignment) => assignment.requestedConfiguration && sameConfiguration(assignment.requestedConfiguration, agent.requestedConfiguration))) return false;
  if (agent.observedConfiguration && (!agent.observations?.length || !sameConfiguration(agent.observations.at(-1).configuration, agent.observedConfiguration))) return false;
  if (agent.replacementFor) {
    const predecessor = run.agents.find((candidate) => candidate.id === agent.replacementFor);
    if (!predecessor || predecessor.role !== agent.role || predecessor.status !== "finished") return false;
  }
  const latest = agent.assignments.at(-1);
  if (agent.block !== latest.block || JSON.stringify(agent.scope) !== JSON.stringify(latest.scope)) return false;
  return agent.assignments.every((assignment) => {
    if (!timestamp2(assignment?.at) || !texts(assignment?.scope)) return false;
    if (assignment.requestedConfiguration !== void 0 && !nativeConfiguration(assignment.requestedConfiguration)) return false;
    if (assignment.observedConfiguration !== void 0 && !modelConfiguration2(assignment.observedConfiguration)) return false;
    if (assignment.replacementFor !== void 0 && assignment.replacementFor !== agent.replacementFor) return false;
    if (assignment.block === "final") return agent.role === "reviewer";
    return run.blocks.some((block) => block.id === assignment.block && assignment.scope.every((scope) => scopeCoveredBy(blockScope(run, block), scope)));
  });
}
function blockScope(run, block) {
  return run.spec.blocks.find((specification) => specification.id === block.id)?.scope ?? [];
}
function scopeCoveredBy(assigned, requested) {
  return assigned.some((scope) => scope === requested || scope === "." || scope === "**" || scopeMatches(requested, [scope]));
}
function assertExternalFulfillments(run) {
  for (const block of run.blocks) {
    if (block.externalFulfillment === void 0 && block.externalFulfillments === void 0) continue;
    if (run.version < 4 || !Array.isArray(block.externalFulfillments) || !block.externalFulfillments.length) throw new Error("External fulfillment requires version 4 and retained provenance history; no migration was applied");
    for (const fulfillment of block.externalFulfillments) {
      if (!fulfillment || !text(fulfillment.sourceProject) || !import_node_path5.default.isAbsolute(fulfillment.sourceProject) || !identifier2(fulfillment.sourceRun) || !digest2(fulfillment.sourceSpecDigest) || !digest2(fulfillment.targetSpecDigest) || !digest2(fulfillment.contributionDigest) || !digest2(fulfillment.sourceEvidenceDigest) || !texts(fulfillment.sourceBlocks) || !fulfillment.sourceBlocks.every(identifier2) || new Set(fulfillment.sourceBlocks).size !== fulfillment.sourceBlocks.length || !text(fulfillment.evidence) || !timestamp2(fulfillment.at) || !block.reviews.some((review) => review.id === fulfillment.acceptanceReviewId && review.verdict === "pass")) throw new Error("External fulfillment provenance is malformed; no migration was applied");
    }
    if (block.externalFulfillment !== void 0 && (block.status !== "closed" || !block.externalFulfillments.some((entry) => JSON.stringify(entry) === JSON.stringify(block.externalFulfillment)))) throw new Error("Active external fulfillment must match a closed checkpoint and its retained history; no migration was applied");
  }
}
function identifier2(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}
function digest2(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function text(value) {
  return typeof value === "string" && Boolean(value.trim());
}
function positive(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function nonnegative(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function texts(value) {
  return Array.isArray(value) && value.length > 0 && value.every(text);
}
function timestamp2(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
function modelConfiguration2(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const configuration = value;
  return Object.keys(configuration).every((key) => key === "model" || key === "reasoningEffort" || key === "forkTurns") && text(configuration.model) && text(configuration.reasoningEffort) && (configuration.forkTurns === void 0 || configuration.forkTurns === "none");
}
function nativeConfiguration(value) {
  return modelConfiguration2(value) && value.forkTurns === "none";
}
function validComparableProgress(value) {
  return text(value.beforeAttempt) && text(value.afterAttempt) && text(value.metric) && typeof value.before === "number" && Number.isFinite(value.before) && typeof value.after === "number" && Number.isFinite(value.after) && texts(value.evidence);
}

// src/parking.ts
var import_node_fs5 = require("node:fs");
var import_node_path6 = __toESM(require("node:path"), 1);
function ensureLifecycleVersion(run) {
  if (run.version >= 2) return;
  run.version = 2;
  run.readerMinimumVersion = 2;
}
function checkoutState(project) {
  const files = snapshot(project);
  const modes2 = fileModes(project, files);
  const head3 = captureCommand(["git", "rev-parse", "--revs-only", "HEAD"], project).trim() || void 0;
  const branch = captureCommand(["git", "symbolic-ref", "--quiet", "--short", "HEAD"], project).trim() || void 0;
  return { head: head3, branch, files, modes: modes2 };
}
function parkedState(run, reason) {
  const current = checkoutState(run.project);
  return {
    reason,
    at: (/* @__PURE__ */ new Date()).toISOString(),
    previousStatus: run.status === "blocked" ? "blocked" : "running",
    selectedBlock: run.activeBlock,
    globalBaseline: { ...run.baseline },
    checkout: current,
    evidence: { checks: run.checks.map((check) => check.attempt), reviews: [...run.blocks.flatMap((block) => block.reviews), ...run.finalReviews].map((review) => review.id), failures: run.blocks.flatMap((block) => block.failure ? [`${block.id}:${block.failure.signature}`] : []) },
    recoveryBudgets: Object.fromEntries(run.blocks.map((block) => [block.id, { rounds: block.rounds.length, blocked: block.status === "blocked", permissionEpisodes: Object.values(block.permissionEpisodes ?? {}).map((episode) => episode.id) }])),
    handles: { checks: run.checks.filter((check) => check.status === "running").map((check) => check.attempt), agents: run.agents.filter((agent) => agent.status !== "finished").map((agent) => agent.id) }
  };
}
function parkRun(run, reason) {
  if (!reason.trim()) throw new Error("Parking requires the actual reason for the separate approved work");
  if (!run.approval || !["running", "blocked"].includes(run.status)) throw new Error("Only an authorized running or blocked run can be parked");
  const runningChecks = run.checks.filter((check) => check.status === "running");
  const unresolvedAgents = run.agents.filter((agent) => agent.status !== "finished");
  if (runningChecks.length || unresolvedAgents.length) throw new Error(`Cannot park while native handles remain unresolved: ${[...runningChecks.map((check) => check.attempt), ...unresolvedAgents.map((agent) => agent.id)].join(", ")}`);
  ensureLifecycleVersion(run);
  run.parked = parkedState(run, reason);
  run.status = "parked";
  run.next = "Parked. Start an approved successor from this run only with a clean unchanged checkout, or resume this selected evidence.";
  event(run, "park", reason);
}
function transitionStatus(project, selected) {
  const directory = import_node_path6.default.join(stateDirectory(project), "runs");
  const ids = (0, import_node_fs5.existsSync)(directory) ? (0, import_node_fs5.readdirSync)(directory).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5)).sort() : [];
  const active = selected ?? ((0, import_node_fs5.existsSync)(import_node_path6.default.join(stateDirectory(project), "active")) ? (0, import_node_fs5.readFileSync)(import_node_path6.default.join(stateDirectory(project), "active"), "utf8").trim() : void 0);
  const runs = ids.map((id) => readRun(project, id));
  return {
    selected: active,
    transitions: runs.map((run) => ({ id: run.spec.id, status: run.status, selected: run.spec.id === active, park: parkEligibility(run), resume: resumeEligibility(run), amendUntouched: amendEligibility(run) }))
  };
}
function parkEligibility(run) {
  const reasons = [];
  if (!["running", "blocked"].includes(run.status)) reasons.push("run is not active");
  if (!run.approval) reasons.push("run lacks approval");
  if (run.checks.some((check) => check.status === "running")) reasons.push("a check is still running");
  if (run.agents.some((agent) => agent.status !== "finished")) reasons.push("a native agent is unresolved");
  return { eligible: reasons.length === 0, reasons };
}
function resumeEligibility(run) {
  const reasons = [];
  if (run.status !== "parked") reasons.push("run is not parked");
  if (!run.parked) reasons.push("park record is missing");
  if (run.parked && unresolvedSuccessors(run).length) reasons.push(`successor remains incomplete: ${unresolvedSuccessors(run).map((entry) => entry.spec.id).join(", ")}`);
  return { eligible: reasons.length === 0, reasons };
}
function amendEligibility(run) {
  const reasons = [];
  if (run.status !== "parked") reasons.push("run is not parked");
  if (!run.parked?.selectedBlock) reasons.push("no selected block was retained");
  const block = run.blocks.find((entry) => entry.id === run.parked?.selectedBlock);
  if (!block || !untouched(run, block.id)) reasons.push("selected block has material execution evidence");
  return { eligible: reasons.length === 0, reasons };
}
function startFromParkedRun(project, parked, spec) {
  if (parked.status !== "parked" || !parked.parked) throw new Error(`Run ${parked.spec.id} is not parked`);
  const selected = (0, import_node_fs5.readFileSync)(import_node_path6.default.join(stateDirectory(project), "active"), "utf8").trim();
  if (selected !== parked.spec.id) throw new Error(`Parked run ${parked.spec.id} is not selected for this checkout`);
  if (parked.spec.id === spec.id) throw new Error("A parked run must resume its own identity; use a new run id for a successor");
  if (sameObjective(spec.objective, parked.spec.objective) && parked.blocks.some((block) => block.failure)) throw new Error("A successor cannot disguise repair of the parked run\u2019s failed objective; preserve its recovery budget");
  assertSameCheckout(parked.parked.checkout, checkoutState(project), "Start a successor only from the clean checkout preserved at parking");
  if (captureCommand(["git", "status", "--porcelain=v1"], project).trim()) throw new Error("Start a successor only from a clean Git checkout; slice 3 does not move dirty parked work");
  const run = startRun(project, spec, { parkedPredecessor: parked.spec.id });
  event(run, "parked-successor", parked.spec.id);
  writeRun(run);
  return run;
}
function resumeParkedRun(run) {
  if (run.status !== "parked" || !run.parked) throw new Error("Resume selects an existing parked run");
  const successors = successorsOf(run);
  const pending = successors.filter((successor) => successor.status !== "closed");
  if (pending.length) throw new Error(`Cannot resume ${run.spec.id}; successor ${pending.map((entry) => entry.spec.id).join(", ")} is pending, so its external delta is not reviewed and committed`);
  for (const successor of successors) recordReviewedContribution(run, successor);
  run.status = run.parked.previousStatus === "blocked" ? "blocked" : "running";
  if (run.selectionAmendment?.pending || run.parked.untouchedSelectionPending) run.next = "Activate the newly approved prerequisite block before returning to the retained selection.";
  else run.next = run.activeBlock ? `Resume ${run.activeBlock} with its retained evidence and recovery budget.` : "Activate the next approved block.";
  event(run, "resume-parked", run.parked.reason);
}
function effectiveSnapshot(run, baseline, dimension = "files") {
  const effective = { ...baseline };
  for (const contribution of run.externalContributions ?? []) {
    for (const filename of changedCheckoutFiles(contribution.before, contribution.after)) {
      if (contribution.after[dimension][filename] === void 0) delete effective[filename];
      else effective[filename] = contribution.after[dimension][filename];
    }
  }
  return effective;
}
function ownershipChanges(run, baseline, modes2, reference) {
  const current = snapshot(run.project);
  const knownModes = modes2 ?? run.parked?.checkout.modes ?? Object.fromEntries((reference ? captureCommand(["git", "ls-tree", "-r", "-z", reference], run.project) : "").split("\0").filter(Boolean).map((entry) => [entry.slice(entry.indexOf("	") + 1), entry.split(" ")[0]]));
  return [.../* @__PURE__ */ new Set([...changedFiles(effectiveSnapshot(run, baseline), current), ...changedFiles(effectiveSnapshot(run, knownModes, "modes"), fileModes(run.project, current))])];
}
function amendUntouchedSelection(run, specification) {
  const selected = run.status === "parked" ? run.parked?.selectedBlock : run.activeBlock;
  if (!selected) return false;
  const prior = run.spec.blocks.findIndex((block) => block.id === selected);
  const next = specification.blocks.findIndex((block) => block.id === selected);
  if (prior < 0 || next < 1 || specification.blocks.length <= run.spec.blocks.length || !untouched(run, selected)) return false;
  const inserted = specification.blocks.slice(0, next).filter((block) => !run.blocks.some((existing) => existing.id === block.id));
  if (!inserted.length || inserted.some((block) => (block.dependsOn ?? []).includes(selected))) throw new Error("An untouched amendment may insert only a prerequisite before the retained selected block");
  if (run.parked) run.parked.untouchedSelectionPending = true;
  run.selectionAmendment = { retainedBlock: selected, pending: true };
  run.blocks.find((block) => block.id === selected).status = "pending";
  ensureLifecycleVersion(run);
  delete run.activeBlock;
  event(run, "untouched-selection-pending", inserted.map((block) => block.id).join(","));
  return true;
}
function recordReviewedContribution(run, successor) {
  const existing = run.externalContributions?.find((entry) => entry.sourceRun === successor.spec.id);
  if (existing) return;
  const closed = successor.blocks.filter((block) => block.status === "closed");
  if (successor.status !== "closed" || !closed.length || successor.activeBlock || successor.blocks.some((block) => block.status !== "closed")) throw new Error(`Successor ${successor.spec.id} lacks reviewed closed checkpoints`);
  const before = run.parked.checkout;
  const after = checkoutState(run.project);
  if (before.branch !== after.branch) throw new Error(`Successor ${successor.spec.id} was not committed on the parked run's branch`);
  if (captureCommand(["git", "status", "--porcelain=v1"], run.project).trim()) throw new Error(`Successor ${successor.spec.id} must be committed cleanly before its external contribution can be recorded`);
  const commits = commitsSince(run.project, before.head, after.head);
  if (!commits.length) throw new Error(`Successor ${successor.spec.id} is closed but has no committed external contribution`);
  const sourceDelta = changedCheckoutFiles(before, after);
  const nested = nestedContributions(run.project, successor, /* @__PURE__ */ new Set([successor.spec.id]));
  const unreviewed = sourceDelta.filter((filename) => !successor.blocks.some((block) => block.status === "closed" && matchesClosedCheckpoint(block, filename, after)) && !nested.some((entry) => matchesContribution(entry, filename, after)));
  if (unreviewed.length) throw new Error(`Successor ${successor.spec.id} has unknown or unreviewed committed delta: ${unreviewed.join(", ")}`);
  const committedFiles = commits.flatMap((commit) => commitFiles(run.project, commit));
  const reviewedScopes = [...closed.map((block) => scopeOf(successor, block.id)), ...nested.flatMap((entry) => entry.source.blocks.filter((block) => block.status === "closed").map((block) => scopeOf(entry.source, block.id)))];
  const unknownCommitted = [...new Set(committedFiles.filter((filename) => !reviewedScopes.some((scope) => scopeMatches(filename, scope))))];
  if (unknownCommitted.length) throw new Error(`Successor ${successor.spec.id} has unknown committed delta: ${unknownCommitted.join(", ")}`);
  const contribution = { sourceRun: successor.spec.id, sourceSpecDigest: successor.specDigest, reviewedCheckpoints: closed.map((block) => block.id), commits, before, after, recordedAt: (/* @__PURE__ */ new Date()).toISOString() };
  (run.externalContributions ??= []).push(contribution);
  event(run, "external-contribution", `${successor.spec.id}: ${commits.join(",")}`);
}
function nestedContributions(project, successor, seen) {
  const nested = [];
  for (const contribution of successor.externalContributions ?? []) {
    if (seen.has(contribution.sourceRun)) throw new Error(`Successor ${successor.spec.id} has cyclic external contribution provenance`);
    const source = readRun(project, contribution.sourceRun);
    if (source.status !== "closed" || source.specDigest !== contribution.sourceSpecDigest || !sameSequence(commitsSince(project, contribution.before.head, contribution.after.head), contribution.commits)) throw new Error(`Successor ${successor.spec.id} has unverifiable nested contribution ${contribution.sourceRun}`);
    const changed = changedCheckoutFiles(contribution.before, contribution.after);
    const checkpoints = new Set(contribution.reviewedCheckpoints);
    const descendants = nestedContributions(project, source, /* @__PURE__ */ new Set([...seen, contribution.sourceRun]));
    if (!changed.length || !checkpoints.size || changed.some((filename) => !source.blocks.some((block) => block.status === "closed" && checkpoints.has(block.id) && matchesClosedCheckpoint(block, filename, contribution.after)) && !descendants.some((entry) => matchesContribution(entry, filename, contribution.after)))) throw new Error(`Successor ${successor.spec.id} has unknown nested contribution ${contribution.sourceRun}`);
    nested.push({ source, contribution });
    nested.push(...descendants);
  }
  return nested;
}
function matchesContribution(entry, filename, after) {
  const changed = changedCheckoutFiles(entry.contribution.before, entry.contribution.after);
  return changed.includes(filename) && entry.contribution.after.files[filename] === after.files[filename] && entry.contribution.after.modes[filename] === after.modes[filename] && entry.source.blocks.some((block) => block.status === "closed" && entry.contribution.reviewedCheckpoints.includes(block.id) && matchesClosedCheckpoint(block, filename, entry.contribution.after));
}
function sameSequence(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
function successorsOf(run) {
  return listRuns(run.project).filter((candidate) => candidate.spec.id !== run.spec.id && candidate.link?.parkedRun === run.spec.id);
}
function unresolvedSuccessors(run) {
  return successorsOf(run).filter((successor) => successor.status !== "closed");
}
function untouched(run, id) {
  const block = run.blocks.find((entry) => entry.id === id);
  const specification = run.spec.blocks.find((entry) => entry.id === id);
  if (!block || !specification || block.reviews.length || block.findings.length || block.rounds.length || block.failure || block.writers.length !== 1 || run.agents.some((agent) => agent.block === id) || run.checks.some((check) => check.block === id)) return false;
  if (!block.baselineModes) return false;
  const before = selectScope(block.baseline ?? run.baseline, specification.scope);
  const now = snapshot(run.project, specification.scope);
  if (changedFiles(before, now).length) return false;
  const beforeModes = selectScope(block.baselineModes, specification.scope);
  const currentModes = fileModes(run.project, now);
  return changedFiles(beforeModes, currentModes).length === 0;
}
function selectScope(files, scope) {
  return Object.fromEntries(Object.entries(files).filter(([filename]) => scopeMatches(filename, scope)));
}
function assertSameCheckout(expected, actual, message) {
  if (expected.head !== actual.head || expected.branch !== actual.branch || changedCheckoutFiles(expected, actual).length) throw new Error(message);
}
function commitsSince(project, before, after) {
  if (!before || !after) return [];
  return captureCommand(["git", "rev-list", "--reverse", `${before}..${after}`], project).trim().split(/\s+/).filter(Boolean);
}
function commitFiles(project, commit) {
  return captureCommand(["git", "diff-tree", "--no-commit-id", "--name-only", "-r", commit], project).split(/\r?\n/).filter(Boolean);
}
function scopeOf(run, id) {
  return run.spec.blocks.find((block) => block.id === id)?.scope ?? [];
}
function sameObjective(left, right) {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

// src/lifecycle.ts
function startRun(project, spec, options = {}) {
  const { parkedPredecessor, deferSelection, initialLink, roadmapParent } = options;
  initializeStore(project);
  return transaction(project, () => {
    if ((0, import_node_fs6.existsSync)(import_node_path7.default.join(stateDirectory(project), "runs", `${spec.id}.json`))) throw new Error("Run already exists; resume it to retain evidence and recovery budgets");
    let parent = roadmapParent ? readRun(project, roadmapParent) : void 0;
    if ((0, import_node_fs6.existsSync)(import_node_path7.default.join(stateDirectory(project), "active"))) {
      const current = readRun(project);
      const approvedChild = current.spec.children?.some((child) => digest(JSON.stringify(child)) === digest(JSON.stringify(spec)));
      if (approvedChild) parent ??= current;
      const parkedRoadmapSibling = current.status === "parked" && roadmapParent && current.approval?.kind === "roadmap" && current.approval.parentRun === roadmapParent;
      if (current.status !== "closed" && !(parkedPredecessor === current.spec.id && current.status === "parked") && !approvedChild && !parkedRoadmapSibling) throw new Error(`Run ${current.spec.id} remains active; resume it instead of replacing its budget`);
    }
    if (parent && (!parent.approval || parent.status === "closed" || parent.spec.mode !== "roadmap" || digest(JSON.stringify(parent.spec)) !== parent.specDigest || !parent.spec.children?.some((child) => digest(JSON.stringify(child)) === digest(JSON.stringify(spec))))) throw new Error("Initial child origin requires the exact approved unfinished roadmap");
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const baseline = snapshot(project);
    const specDigest = digest(JSON.stringify(spec));
    const inheritedOwner = parent?.recovery && (parent.recovery.owner === parent.spec.id ? parent : readRun(project, parent.recovery.owner));
    const recovery2 = parent?.recovery ? { owner: parent.recovery.owner, specDigest: parent.recovery.specDigest } : spec.recovery?.mode === "auto" ? parent ? void 0 : { owner: spec.id, specDigest, policy: spec.recovery, policySource: "spec", grants: [], adoptions: [] } : spec.recovery ? { owner: spec.id, specDigest, initialLimit: spec.recovery.maxCorrections, grants: [] } : void 0;
    const version = parent || truthfulAccounting(spec) ? 5 : inheritedOwner?.recovery?.policy || spec.recovery?.mode === "auto" ? 4 : recovery2 ? 3 : parkedPredecessor || initialLink ? 2 : 1;
    const run = {
      version,
      project,
      spec,
      specDigest,
      created: now,
      updated: now,
      ...version === 1 ? {} : { readerMinimumVersion: version },
      ...recovery2 ? { recovery: recovery2 } : {},
      ...parkedPredecessor || initialLink ? { link: initialLink ?? { parkedRun: parkedPredecessor, kind: "parked-successor", createdAt: now } } : {},
      ...parent ? { roadmapOrigin: { parentRun: parent.spec.id, parentDigest: parent.specDigest, child: spec.id }, roadmapLineage: { baseline: roadmapBaseline(parent, spec), amendments: [] } } : {},
      status: "pending-approval",
      baseline,
      baselineModes: fileModes(project, baseline),
      baseHead: captureCommand(["git", "rev-parse", "--revs-only", "HEAD"], project).trim() || void 0,
      blocks: spec.blocks.map((block) => newBlockState(block.id, spec)),
      checks: [],
      agents: [],
      finalReviews: [],
      next: "Record the actual user authorization, then activate the first block",
      imports: [],
      events: []
    };
    event(run, "start", spec.objective);
    writeRun(run);
    if (!deferSelection) selectRun(run);
    return run;
  });
}
function promoteRecoveryRecord(run, minimum) {
  const version = Math.max(run.version, run.readerMinimumVersion ?? 1, minimum);
  run.version = version;
  run.readerMinimumVersion = version;
}
function truthfulAccounting(specification) {
  return specification.coordination !== void 0 || specification.reviewFallback !== void 0;
}
function newBlockState(id, specification) {
  return truthfulAccounting(specification) ? { id, status: "pending", writers: [], contributions: [], reviews: [], findings: [], rounds: [] } : { id, status: "pending", writers: [specification.principal], implementationTier: "luna", reviews: [], findings: [], rounds: [] };
}
function authorize(run, approval) {
  if (run.status !== "pending-approval") throw new Error("This run already has an authorization; resume it");
  if (approval.kind === "user") {
    if (!approval.reference?.trim() || !approval.message?.trim() || approval.specDigest !== run.specDigest) throw new Error("User authorization needs the actual message, its session/turn reference and this spec digest");
  } else if (approval.kind === "roadmap") {
    if (!matchesRoadmapAuthority(run.roadmapOrigin, approval)) throw new Error("Pending child lacks the exact durable roadmap origin; preserve its baseline and reconcile its original authority");
    const parent = readRun(run.project, approval.parentRun);
    const approvedChild = parent.spec.children?.find((child) => child.id === approval.child);
    if (!parent.approval || parent.status === "closed" || parent.spec.mode !== "roadmap" || parent.specDigest !== approval.parentDigest || !approvedChild || digest(JSON.stringify(approvedChild)) !== run.specDigest) throw new Error("Child is outside the approved roadmap; a material scope change requires user authorization");
  } else throw new Error("Unsupported authorization source");
  run.approval = approval;
  run.status = "running";
  run.next = `Activate ${run.blocks[0].id}`;
  event(run, "authorize", approval.kind === "user" ? approval.reference : `roadmap:${approval.parentRun}/${approval.child}`);
}
function matchesRoadmapAuthority(actual, expected) {
  return actual?.parentRun === expected.parentRun && actual.parentDigest === expected.parentDigest && actual.child === expected.child;
}
function activateBlock(run, id) {
  requireAuthorization(run);
  if (run.activeBlock && run.activeBlock !== id) throw new Error(`Finish active block ${run.activeBlock} first`);
  const block = run.blocks.find((entry) => entry.id === id);
  const specification = run.spec.blocks.find((entry) => entry.id === id);
  if (!block || !specification) throw new Error(`Unknown block: ${id}`);
  if (block.status === "closed") throw new Error("Block is closed; do not reset its evidence or budget");
  for (const dependency of specification.dependsOn ?? []) if (run.blocks.find((entry) => entry.id === dependency)?.status !== "closed") throw new Error(`Dependency remains open: ${dependency}`);
  if (!block.baseline) {
    block.baseline = snapshot(run.project);
    block.baselineModes = fileModes(run.project, block.baseline);
  }
  if (block.status !== "blocked") block.status = "active";
  run.activeBlock = id;
  run.next = block.failure ? `Resolve ${block.failure.kind}: ${block.failure.cause}` : `Implement and verify ${id}`;
  event(run, "activate", id);
}
function activeBlock(run) {
  requireAuthorization(run);
  const block = run.blocks.find((entry) => entry.id === run.activeBlock);
  const specification = run.spec.blocks.find((entry) => entry.id === run.activeBlock);
  if (!block || !specification) throw new Error("No active block; activate an approved block first");
  return { block, specification };
}
function requireAuthorization(run, context = "execution") {
  if (!run.approval || run.status === "pending-approval") throw new Error("Execution requires user authorization or an exact child of an approved roadmap");
  if (run.status === "closed" || context === "execution" && run.status === "parked") throw new Error(run.status === "parked" ? "Run is parked; resume its retained identity before execution" : "Run is closed");
  if (digest(JSON.stringify(run.spec)) !== run.specDigest) throw new Error("Approved specification was changed; record a material amendment with user authorization");
}
function assertScope(run, block, specification) {
  const outside = ownershipChanges(run, block.baseline ?? {}, block.baselineModes, "HEAD").filter((name) => !scopeMatches(name, specification.scope));
  if (outside.length) throw new Error(`Changes outside approved block scope need reconciliation: ${outside.join(", ")}`);
}
function event(run, action, detail) {
  run.events.push({ at: (/* @__PURE__ */ new Date()).toISOString(), action, detail });
}
function importLegacy(run, filename) {
  const contents = (0, import_node_fs6.readFileSync)(filename);
  run.imports.push({ source: import_node_path7.default.resolve(filename), digest: digest(contents), at: (/* @__PURE__ */ new Date()).toISOString() });
  event(run, "legacy-import", `${filename}: provenance only; approval, checks and reviews were not promoted`);
}
function adoptPreservedWork(run, files, authorization) {
  requireAuthorization(run);
  if (authorization.kind !== "user" || !authorization.reference?.trim() || !authorization.message?.trim() || authorization.specDigest !== run.specDigest) throw new Error("Adoption requires the actual user authorization bound to this specification");
  if (!files || typeof files !== "object" || Array.isArray(files) || !Object.keys(files).length) throw new Error("Adoption requires explicit file paths and their current SHA256 hashes");
  const now = snapshot(run.project);
  const pending = /* @__PURE__ */ new Set([
    ...captureCommand(["git", "diff", "--name-only", "-z"], run.project).split("\0"),
    ...captureCommand(["git", "diff", "--cached", "--name-only", "-z"], run.project).split("\0"),
    ...captureCommand(["git", "ls-files", "--others", "--exclude-standard", "-z"], run.project).split("\0")
  ]);
  const baseModes = new Map((run.baseHead ? captureCommand(["git", "ls-tree", "-r", "-z", run.baseHead], run.project) : "").split("\0").filter(Boolean).map((entry) => [entry.slice(entry.indexOf("	") + 1), entry.split(" ")[0]]));
  const modes2 = {};
  for (const [filename, hash4] of Object.entries(files)) {
    if (!Object.hasOwn(now, filename) || !scopeMatches(filename, run.spec.blocks.flatMap((block) => block.scope))) throw new Error(`Adoption is outside the approved source scope: ${filename}`);
    if (typeof hash4 !== "string" || !/^[a-f0-9]{64}$/.test(hash4) || hash4 !== now[filename] || hash4 !== run.baseline[filename]) throw new Error(`Adoption must match unchanged work preserved in the original baseline: ${filename}`);
    if (!pending.has(filename)) throw new Error(`Adoption requires an uncommitted change: ${filename}`);
    modes2[filename] = gitFileMode(run.project, filename);
    if (modes2[filename] !== (baseModes.get(filename) ?? "100644")) throw new Error(`Adoption cannot include a Git mode change or a new executable/symlink: ${filename}`);
  }
  run.adoptions ??= [];
  if (run.adoptions.some((entry) => digest(JSON.stringify(entry.files)) === digest(JSON.stringify(files)) && digest(JSON.stringify(entry.authorization)) === digest(JSON.stringify(authorization)))) return;
  run.adoptions.push({ files: { ...files }, modes: modes2, authorization: { ...authorization }, at: (/* @__PURE__ */ new Date()).toISOString() });
  event(run, "adopt-preserved-work", JSON.stringify({ files, modes: modes2, reference: authorization.reference }));
}

// src/isolated.ts
var import_node_fs7 = require("node:fs");
var import_node_path8 = __toESM(require("node:path"), 1);
function startIsolatedRun(project, sourceProject, sourceId, specification) {
  const source = readRun(sourceProject, sourceId);
  if (source.status !== "parked" || !source.parked) throw new Error(`Source run ${sourceId} must be parked before isolated work starts`);
  if (source.checks.some((check) => check.status === "running") || source.agents.some((agent) => agent.status !== "finished")) throw new Error(`Source run ${sourceId} has unresolved native handles`);
  if (source.spec.id === specification.id || source.spec.objective.trim().toLocaleLowerCase() === specification.objective.trim().toLocaleLowerCase() && source.blocks.some((block) => block.failure)) throw new Error("An isolated successor cannot replace the parked run or escape its failed objective budget");
  const commonDirectory = commonGitDirectory(project, sourceProject);
  const parkHead = requiredHead(source.parked.checkout.head, "Parked source has no Git head");
  if (head(project) !== parkHead || captureCommand(["git", "status", "--porcelain=v1"], project).trim()) throw new Error("Isolated checkout must be clean and start exactly from the parked source head");
  ensureLifecycleVersion(source);
  let forward = source.isolatedSuccessors?.find((successor) => successor.project === project && successor.run === specification.id);
  if (!forward) {
    forward = { project, run: specification.id, commonDirectory, parkHead, status: "starting" };
    (source.isolatedSuccessors ??= []).push(forward);
    event(source, "isolated-successor-starting", `${specification.id}@${project}`);
    writeRun(source);
  }
  const existing = listRuns(project).find((candidate) => candidate.spec.id === specification.id);
  if (existing) {
    const cross = existing.link?.crossProject;
    if (existing.specDigest !== digest(JSON.stringify(specification)) || cross?.sourceProject !== sourceProject || cross.sourceRun !== source.spec.id || cross.parkHead !== parkHead) throw new Error(`Existing isolated run ${specification.id} does not match this source and approved specification`);
    forward.status = "active";
    event(source, "isolated-successor-recovered", `${existing.spec.id}@${project}`);
    writeRun(source);
    selectRun(existing);
    return existing;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const run = startRun(project, specification, { parkedPredecessor: source.spec.id, deferSelection: true, initialLink: { parkedRun: source.spec.id, kind: "parked-successor", createdAt: now, crossProject: { sourceProject, sourceRun: source.spec.id, commonDirectory, parkHead } } });
  run.next = `Record the separate approved objective; source ${source.spec.id} remains parked with its partial work intact.`;
  writeRun(run);
  forward.status = "active";
  event(source, "isolated-successor", `${run.spec.id}@${project}`);
  writeRun(source);
  selectRun(run);
  return run;
}
function integrateIsolatedRun(project, sourceProject, sourceId) {
  const release = acquireLock(import_node_path8.default.join(stateDirectory(project), "locks", "cross-project-integration"));
  try {
    return integrateLocked(project, sourceProject, sourceId);
  } finally {
    release();
  }
}
function integrateLocked(project, sourceProject, sourceId) {
  const target = readRun(project);
  const source = readRun(sourceProject, sourceId);
  const link = source.link?.crossProject;
  if (target.status !== "parked" || !target.parked) throw new Error("Integration requires the parked source run selected in its original checkout");
  if (!link || link.sourceProject !== project || link.sourceRun !== target.spec.id) throw new Error(`Run ${sourceId} is not the recorded isolated successor of ${target.spec.id}`);
  if (commonGitDirectory(project, sourceProject) !== link.commonDirectory) throw new Error("Isolated worktree no longer belongs to the recorded shared Git repository");
  if (source.status !== "closed" || source.activeBlock || source.blocks.some((block) => block.status !== "closed")) throw new Error(`Isolated run ${sourceId} needs all reviewed checkpoints closed before integration`);
  if (captureCommand(["git", "status", "--porcelain=v1"], sourceProject).trim()) throw new Error(`Isolated run ${sourceId} must be cleanly committed before integration`);
  const sourceHead = head(sourceProject);
  if (!isAncestor(sourceProject, link.parkHead, sourceHead)) throw new Error("Isolated branch is not linear from the parked source head; integration remains pending without changing the source checkout");
  if (captureCommand(["git", "rev-list", "--merges", `${link.parkHead}..${sourceHead}`], sourceProject).trim()) throw new Error("Isolated branch contains a merge commit; integration remains pending without changing the source checkout");
  if (!checkoutState(sourceProject).branch || checkoutState(sourceProject).branch === target.parked.checkout.branch) throw new Error("Isolated work must remain on its own branch before integration");
  const contribution = verifiedContribution(source, link.parkHead, sourceHead, sourceProject);
  if (link.integration === "integrated") {
    if (head(project) !== sourceHead || !contributionPresent(checkoutState(project), contribution)) throw new Error("Isolated record says integrated but the parked checkout does not contain the recorded contribution; preserve both worktrees and reconcile the divergence");
    return finalizeIntegration(target, source, contribution);
  }
  const partial = partialPaths(project);
  const overlap = changedCheckoutFiles(contribution.before, contribution.after).filter((filename) => partial.has(filename));
  if (overlap.length) {
    markPending(source, target, `Integration collision with parked partial paths: ${overlap.join(", ")}`);
    throw new Error(`Integration collision with parked partial paths: ${overlap.join(", ")}. The parked checkout remains unchanged.`);
  }
  const before = checkoutState(project);
  const beforeIndexDigest = indexDigest(project);
  const after = applyContribution(before, contribution);
  after.head = sourceHead;
  const intent = target.integrationIntent;
  if (intent) return recoverIntegration(target, source, contribution, intent, project);
  const nextIntent = { sourceProject, sourceRun: source.spec.id, sourceSpecDigest: source.specDigest, checkpoints: contribution.reviewedCheckpoints, commits: contribution.commits, before, after, beforeIndexDigest, expectedIndexDigest: beforeIndexDigest, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
  target.integrationIntent = nextIntent;
  event(target, "integration-intent", `${source.spec.id}@${sourceProject}`);
  writeRun(target);
  return performIntegration(target, source, contribution, nextIntent, project);
}
function namedResourceLockDirectory(run) {
  const coordinator = run.link?.crossProject?.sourceProject ?? (run.isolatedSuccessors?.length ? run.project : void 0);
  return coordinator ? import_node_path8.default.join(stateDirectory(coordinator), "locks", "cross-project") : void 0;
}
function crossProjectPeers(run) {
  const peers = [];
  if (run.link?.crossProject) peers.push(readRun(run.link.crossProject.sourceProject, run.link.crossProject.sourceRun));
  for (const successor of run.isolatedSuccessors ?? []) {
    const filename = import_node_path8.default.join(stateDirectory(successor.project), "runs", `${successor.run}.json`);
    if ((0, import_node_fs7.existsSync)(filename)) peers.push(readRun(successor.project, successor.run));
  }
  return peers;
}
function recoverIntegration(target, source, contribution, intent, project) {
  if (intent.sourceProject !== source.project || intent.sourceRun !== source.spec.id || intent.sourceSpecDigest !== source.specDigest || digest(JSON.stringify(intent.checkpoints)) !== digest(JSON.stringify(contribution.reviewedCheckpoints)) || digest(JSON.stringify(intent.commits)) !== digest(JSON.stringify(contribution.commits))) throw new Error("Stored integration intent no longer matches the reviewed isolated record; preserve both worktrees and reconcile the divergence");
  const current = checkoutState(project);
  const index = indexDigest(project);
  if (sameState(current, intent.after) && index === intent.expectedIndexDigest) return finalizeIntegration(target, source, contribution);
  if (!sameState(current, intent.before) || index !== intent.beforeIndexDigest) throw new Error("Integration intent diverged from both its recorded before and expected after state; preserve both worktrees and reconcile without retrying Git");
  return performIntegration(target, source, contribution, intent, project);
}
function performIntegration(target, source, contribution, intent, project) {
  const boundary = familyBoundary(target, "commit");
  if (boundary?.status === "open") throw new Error(`Required commit remains blocked: ${boundary.cause}`);
  try {
    captureCommand(["git", "merge", "--ff-only", requiredHead(intent.after.head, "Missing isolated integration head")], project);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    blockIntegrationBoundary(target, intent, `Integration merge failed through the native Git action: ${cause}`);
    event(target, "integration-failed", cause);
    writeRun(target);
    throw error;
  }
  if (!sameState(checkoutState(project), intent.after) || indexDigest(project) !== intent.expectedIndexDigest) throw new Error("Git integration completed but the recorded expected checkout or index state did not match; preserve both worktrees and reconcile the divergence");
  return finalizeIntegration(target, source, contribution);
}
function finalizeIntegration(target, source, contribution) {
  const contributions = target.externalContributions ??= [];
  if (!contributions.some((entry) => entry.sourceRun === source.spec.id && entry.sourceSpecDigest === source.specDigest)) contributions.push(contribution);
  delete target.integrationIntent;
  const successor = target.isolatedSuccessors?.find((entry) => entry.project === source.project && entry.run === source.spec.id);
  if (successor) successor.status = "integrated";
  source.link.crossProject.integration = "integrated";
  source.next = `Integrated into parked source ${target.spec.id} with reviewed provenance.`;
  target.next = `Integrated reviewed isolated contribution ${source.spec.id}; resume the retained selected block with fresh source-run evidence.`;
  event(target, "integration-finalized", source.spec.id);
  event(source, "integration-finalized", target.spec.id);
  writeRun(source);
  writeRun(target);
  return target;
}
function verifiedContribution(source, parkHead, sourceHead, project) {
  const before = { head: parkHead, branch: void 0, files: source.baseline, modes: source.baselineModes ?? {} };
  if (!source.baselineModes) throw new Error(`Isolated run ${source.spec.id} lacks baseline Git mode provenance; reconcile it before integration`);
  const after = checkoutState(project);
  const commits = captureCommand(["git", "rev-list", "--reverse", `${parkHead}..${sourceHead}`], project).trim().split(/\s+/).filter(Boolean);
  if (!commits.length) throw new Error(`Isolated run ${source.spec.id} has no committed contribution`);
  const closed = source.blocks.filter((block) => block.status === "closed");
  const delta = changedCheckoutFiles(before, after);
  const invalid = delta.filter((filename) => !closed.some((block) => matchesClosedCheckpoint(block, filename, after)));
  if (invalid.length) throw new Error(`Isolated run ${source.spec.id} has unreviewed hash, mode or deletion delta: ${invalid.join(", ")}`);
  const commitFiles2 = commits.flatMap((commit) => captureCommand(["git", "diff-tree", "--no-commit-id", "--name-only", "-r", commit], project).split(/\r?\n/).filter(Boolean));
  const unknown = [...new Set(commitFiles2.filter((filename) => !closed.some((block) => scopeMatches(filename, source.spec.blocks.find((specification) => specification.id === block.id).scope))))];
  if (unknown.length) throw new Error(`Isolated run ${source.spec.id} has committed paths outside reviewed checkpoints: ${unknown.join(", ")}`);
  return { sourceRun: source.spec.id, sourceSpecDigest: source.specDigest, reviewedCheckpoints: closed.map((block) => block.id), commits, before, after, recordedAt: (/* @__PURE__ */ new Date()).toISOString() };
}
function applyContribution(state, contribution) {
  const files = { ...state.files };
  const modes2 = { ...state.modes };
  for (const filename of changedCheckoutFiles(contribution.before, contribution.after)) {
    if (contribution.after.files[filename] === void 0) delete files[filename];
    else files[filename] = contribution.after.files[filename];
    if (contribution.after.modes[filename] === void 0) delete modes2[filename];
    else modes2[filename] = contribution.after.modes[filename];
  }
  return { head: state.head, branch: state.branch, files, modes: modes2 };
}
function contributionPresent(state, contribution) {
  return changedCheckoutFiles(contribution.before, contribution.after).every((filename) => state.files[filename] === contribution.after.files[filename] && state.modes[filename] === contribution.after.modes[filename]);
}
function markPending(source, target, detail) {
  source.link.crossProject.integration = "pending";
  const successor = target.isolatedSuccessors?.find((entry) => entry.project === source.project && entry.run === source.spec.id);
  if (successor) successor.status = "closed-pending-integration";
  source.next = detail;
  writeRun(source);
  writeRun(target);
}
function partialPaths(project) {
  return new Set(["--cached", ""].flatMap((argument) => captureCommand(["git", "diff", ...argument ? [argument] : [], "--name-only", "-z"], project).split("\0").filter(Boolean)).concat(captureCommand(["git", "ls-files", "--others", "--exclude-standard", "-z"], project).split("\0").filter(Boolean)));
}
function indexDigest(project) {
  return digest(captureCommand(["git", "diff", "--cached", "--binary"], project));
}
function sameState(left, right) {
  return left.head === right.head && left.branch === right.branch && !changedCheckoutFiles(left, right).length;
}
function head(project) {
  return requiredHead(captureCommand(["git", "rev-parse", "--revs-only", "HEAD"], project).trim(), "Git checkout has no HEAD");
}
function requiredHead(value, message) {
  if (!value) throw new Error(message);
  return value;
}
function isAncestor(project, ancestor, descendant) {
  return captureCommand(["git", "merge-base", ancestor, descendant], project).trim() === ancestor;
}
function commonGitDirectory(project, other) {
  const directory = (0, import_node_fs7.realpathSync)(import_node_path8.default.resolve(project, captureCommand(["git", "rev-parse", "--git-common-dir"], project).trim()));
  const otherDirectory = (0, import_node_fs7.realpathSync)(import_node_path8.default.resolve(other, captureCommand(["git", "rev-parse", "--git-common-dir"], other).trim()));
  if (directory !== otherDirectory) throw new Error("Source and isolated directories are not Git worktrees of the same repository");
  return directory;
}

// src/boundaries.ts
function blockBoundary(run, action, cause) {
  requireAuthorization(run, "metadata");
  if (!cause.trim()) throw new Error("Record the actual required delivery action and its observed failure");
  const previous = familyBoundary(run, action);
  const boundaries = run.boundaries ??= {};
  boundaries[action] = { status: "open", cause, rounds: previous?.rounds ?? [] };
  syncFamilyBoundary(run, action, boundaries[action]);
  run.next = `${action} remains blocked: ${cause}. Preserve this boundary across slices; do not retry the unchanged environment.`;
  event(run, "boundary-blocked", `${action}: ${cause}`);
}
function blockIntegrationBoundary(run, intent, cause) {
  blockBoundary(run, "commit", cause);
  const boundary = run.boundaries.commit;
  boundary.integration = {
    sourceRun: intent.sourceRun,
    sourceSpecDigest: intent.sourceSpecDigest,
    commits: [...intent.commits],
    beforeHead: requiredHead2(intent.before.head),
    afterHead: requiredHead2(intent.after.head)
  };
  syncFamilyBoundary(run, "commit", boundary);
}
function resolveBoundary(run, action, evidence, escalated) {
  requireAuthorization(run, "metadata");
  const boundary = familyBoundary(run, action);
  if (!boundary || boundary.status !== "open") throw new Error("There is no unresolved delivery boundary for that action");
  if (!evidence.trim() || evidence === boundary.cause || boundary.rounds.some((round) => round.evidence === evidence)) throw new Error("Provide new actual permission, completed-action or authorized scope-change evidence");
  const ordinary = boundary.rounds.filter((round) => !round.escalated).length;
  if (!escalated && ordinary >= 2 || escalated && (ordinary < 2 || boundary.rounds.some((round) => round.escalated))) throw new Error("Delivery recovery budget exhausted or escalation out of order; preserve the concrete blocker");
  boundary.rounds.push({ evidence, escalated, at: (/* @__PURE__ */ new Date()).toISOString() });
  boundary.status = "resolved";
  syncFamilyBoundary(run, action, boundary);
  event(run, "boundary-resolved", `${action}: ${evidence}`);
  run.next = "Continue from the existing reviewed checkpoint using current evidence";
}
function resolveCompletedIntegrationBoundary(run, sourceRun, evidence) {
  requireAuthorization(run, "metadata");
  if (!sourceRun.trim() || !evidence.trim()) throw new Error("Completed integration reconciliation requires its recorded source run and actual evidence");
  const boundary = familyBoundary(run, "commit");
  if (!boundary) throw new Error("There is no recorded commit delivery boundary to reconcile");
  const contribution = matchingCompletedIntegration(run, boundary, sourceRun);
  const verifiedHead = verifyCompletedIntegration(run.project, contribution);
  const existing = boundary.completion;
  if (boundary.status === "resolved") {
    if (existing?.kind === "completed-integration" && existing.sourceRun === sourceRun && existing.evidence === evidence && existing.afterHead === contribution.after.head) return;
    throw new Error("There is no unresolved delivery boundary for that action");
  }
  boundary.status = "resolved";
  boundary.completion = {
    kind: "completed-integration",
    sourceRun,
    sourceSpecDigest: contribution.sourceSpecDigest,
    commits: [...contribution.commits],
    beforeHead: contribution.before.head,
    afterHead: contribution.after.head,
    verifiedHead,
    evidence,
    at: (/* @__PURE__ */ new Date()).toISOString()
  };
  syncFamilyBoundary(run, "commit", boundary);
  event(run, "boundary-completed-integration", `${sourceRun}: ${contribution.commits.join(",")} (${evidence})`);
  run.next = "Continue from the existing reviewed checkpoint; the completed Git integration was verified without another delivery attempt.";
}
function familyBoundary(run, action) {
  return linkedFamily(run).flatMap((candidate) => candidate.boundaries?.[action] ? [candidate.boundaries[action]] : []).sort((left, right) => right.rounds.length - left.rounds.length || Number(right.status === "open") - Number(left.status === "open"))[0];
}
function syncFamilyBoundary(run, action, boundary) {
  for (const member of linkedFamily(run)) {
    (member.boundaries ??= {})[action] = structuredClone(boundary);
    if (member.spec.id !== run.spec.id) writeRun(member);
  }
}
function linkedFamily(run) {
  const runs = [...listRuns(run.project).map((candidate) => candidate.spec.id === run.spec.id ? run : candidate), ...crossProjectPeers(run)];
  if (!runs.some((candidate) => candidate.spec.id === run.spec.id)) runs.push(run);
  const linked = /* @__PURE__ */ new Set([run.spec.id]);
  let previous = 0;
  while (previous !== linked.size) {
    previous = linked.size;
    for (const candidate of runs) {
      const parent = candidate.link?.parkedRun;
      if (parent && (linked.has(parent) || linked.has(candidate.spec.id))) {
        linked.add(parent);
        linked.add(candidate.spec.id);
      }
    }
  }
  return runs.filter((candidate) => linked.has(candidate.spec.id));
}
function matchingCompletedIntegration(run, boundary, sourceRun) {
  const matches = (run.externalContributions ?? []).filter((candidate) => candidate.sourceRun === sourceRun);
  if (matches.length !== 1) throw new Error(matches.length ? `Completed integration source ${sourceRun} is ambiguous` : `No registered completed integration exists for ${sourceRun}`);
  const contribution = matches[0];
  if (boundary.integration) {
    const operation = boundary.integration;
    if (operation.sourceRun !== contribution.sourceRun || operation.sourceSpecDigest !== contribution.sourceSpecDigest || operation.afterHead !== contribution.after.head || !sameSequence2(operation.commits, contribution.commits) || !isAncestor2(run.project, contribution.before.head, operation.beforeHead) || !isAncestor2(run.project, operation.beforeHead, contribution.after.head) || operation.beforeHead === contribution.after.head) throw new Error(`Registered source ${sourceRun} does not complete the open failed integration`);
    return contribution;
  }
  return matchingLegacyCompletedIntegration(run, boundary, sourceRun, contribution);
}
function matchingLegacyCompletedIntegration(run, boundary, sourceRun, contribution) {
  const blocked = run.events.findLastIndex((entry) => entry.action === "boundary-blocked" && entry.detail === `commit: ${boundary.cause}`);
  if (blocked < 0) throw new Error("The open integration boundary has no durable blocked-delivery event");
  const failed = run.events.findIndex((entry, index) => index > blocked && entry.action === "integration-failed");
  const intent = run.events.findLastIndex((entry, index) => index < blocked && entry.action === "integration-intent");
  const finalized = run.events.findIndex((entry, index) => index > failed && entry.action === "integration-finalized" && entry.detail === sourceRun);
  if (intent < 0 || integrationSource(run.events[intent].detail) !== sourceRun || failed !== blocked + 1 || finalized < 0 || run.events.slice(intent + 1, finalized).some((entry) => entry.action === "integration-finalized")) throw new Error(`Registered source ${sourceRun} does not complete the open failed integration`);
  return contribution;
}
function verifyCompletedIntegration(project, contribution) {
  validateContribution(contribution);
  const before = contribution.before.head;
  const after = contribution.after.head;
  const current = head2(project);
  if (!isAncestor2(project, before, after) || !isAncestor2(project, after, current)) throw new Error("Completed integration Git ancestry no longer proves the recorded after state is retained");
  const commits = captureCommand(["git", "rev-list", "--reverse", `${before}..${after}`], project).trim().split(/\s+/).filter(Boolean);
  if (!sameSequence2(commits, contribution.commits)) throw new Error("Completed integration commit interval does not match its registered provenance");
  const changed = changedCheckoutFiles(contribution.before, contribution.after);
  const actualChanged = captureCommand(["git", "diff", "--no-renames", "--name-only", "-z", before, after], project).split("\0").filter(Boolean).sort();
  if (!sameSequence2(changed, actualChanged)) throw new Error("Completed integration recorded snapshot delta does not exactly match the immutable Git diff");
  if (!changed.length && tree(project, before) !== tree(project, after)) throw new Error("Completed integration records an empty delta but its Git trees differ");
  for (const filename of changed) {
    verifyTreeEntry(project, before, filename, contribution.before);
    verifyTreeEntry(project, after, filename, contribution.after);
  }
  return current;
}
function validateContribution(contribution) {
  if (!identifier3(contribution.sourceRun) || !hash(contribution.sourceSpecDigest) || !Array.isArray(contribution.reviewedCheckpoints) || !contribution.reviewedCheckpoints.length || contribution.reviewedCheckpoints.some((checkpoint) => !identifier3(checkpoint)) || !Array.isArray(contribution.commits) || !contribution.commits.length || contribution.commits.some((commit) => !gitHash(commit)) || new Set(contribution.commits).size !== contribution.commits.length || !timestamp3(contribution.recordedAt) || !checkout(contribution.before) || !checkout(contribution.after)) throw new Error("Registered completed integration provenance is malformed");
}
function checkout(state) {
  return gitHash(state.head) && snapshot2(state.files) && modes(state.modes) && sameKeys(state.files, state.modes);
}
function snapshot2(value) {
  return Object.entries(value).every(([filename, value2]) => Boolean(filename) && hash(value2));
}
function modes(value) {
  return Object.entries(value).every(([filename, mode]) => Boolean(filename) && ["100644", "100755", "120000"].includes(mode));
}
function sameKeys(left, right) {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return sameSequence2(leftKeys, rightKeys);
}
function identifier3(value) {
  return Boolean(value.trim()) && !/[\r\n\0]/.test(value);
}
function hash(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}
function gitHash(value) {
  return typeof value === "string" && /^[a-f0-9]{40,64}$/i.test(value);
}
function timestamp3(value) {
  return !Number.isNaN(Date.parse(value));
}
function verifyTreeEntry(project, reference, filename, state) {
  const expectedHash = state.files[filename];
  const expectedMode = state.modes[filename];
  const entry = treeEntry(project, reference, filename);
  if (expectedHash === void 0 || expectedMode === void 0) {
    if (expectedHash !== void 0 || expectedMode !== void 0 || entry) throw new Error(`Completed integration tree does not match the recorded deletion of ${filename}`);
    return;
  }
  if (!entry || entry.mode !== expectedMode) throw new Error(`Completed integration tree mode does not match recorded provenance for ${filename}`);
  const bytes = captureCommandBytes(["git", "cat-file", "blob", entry.object], project);
  const actualHash = entry.mode === "120000" ? digest(`link:${bytes.toString("utf8")}:`) : digest(bytes);
  if (actualHash !== expectedHash) throw new Error(`Completed integration tree hash does not match recorded provenance for ${filename}`);
}
function treeEntry(project, reference, filename) {
  const output2 = captureCommand(["git", "ls-tree", "-z", reference, "--", filename], project);
  if (!output2) return void 0;
  const entry = output2.slice(0, -1);
  const separator = entry.indexOf("	");
  const [mode, type, object2] = entry.slice(0, separator).split(" ");
  if (separator < 0 || entry.slice(separator + 1) !== filename || type !== "blob" || !["100644", "100755", "120000"].includes(mode ?? "") || !gitHash(object2)) throw new Error(`Completed integration has an invalid Git tree entry for ${filename}`);
  return { mode, object: object2 };
}
function head2(project) {
  const value = captureCommand(["git", "rev-parse", "--revs-only", "HEAD"], project).trim();
  if (!gitHash(value)) throw new Error("Completed integration checkout has no valid Git HEAD");
  return value;
}
function requiredHead2(value) {
  if (!gitHash(value)) throw new Error("Native integration intent lacks a valid Git head");
  return value;
}
function tree(project, reference) {
  return captureCommand(["git", "rev-parse", `${reference}^{tree}`], project).trim();
}
function isAncestor2(project, ancestor, descendant) {
  return captureCommand(["git", "merge-base", ancestor, descendant], project).trim() === ancestor;
}
function sameSequence2(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
function integrationSource(detail) {
  const separator = detail.indexOf("@");
  return separator > 0 ? detail.slice(0, separator) : "";
}

// src/cli.ts
var import_node_util = require("node:util");

// src/checks.ts
var import_node_child_process2 = require("node:child_process");
var import_node_crypto3 = require("node:crypto");
var import_node_fs10 = require("node:fs");
var import_node_path9 = __toESM(require("node:path"), 1);

// src/recovery.ts
var import_node_fs9 = require("node:fs");

// src/recovery-control.ts
var import_node_fs8 = require("node:fs");

// src/recovery-policy.ts
function recoveryBudget(run) {
  const owner = recoveryOwner(run);
  const family = recoveryFamily(run, owner.record);
  const used = family.reduce((total, member) => total + member.blocks.reduce((rounds, block) => rounds + block.rounds.length, 0), 0);
  const effective = effectivePolicy(owner.record, owner.state);
  const initial = effective.policy ? effective.policy.maxCorrections : recoveryLimit(owner.record, owner.state);
  const granted = effective.policy ? 0 : grantTotal(owner.state?.grants ?? []);
  if (initial !== void 0 && initial > Number.MAX_SAFE_INTEGER - granted) throw new Error("Recovery grants exceed the largest safe correction limit");
  const limit = effective.policy ? initial : initial === void 0 ? void 0 : initial + granted;
  return {
    owner: owner.record.spec.id,
    specDigest: owner.specDigest,
    revision: revision(owner.record, owner.specDigest, owner.state, family),
    limit,
    used,
    remaining: limit === void 0 ? void 0 : Math.max(0, limit - used),
    ...effective.policy ? { policy: effective.policy } : {},
    policySource: effective.source
  };
}
function authorizeRecovery(run, value) {
  requireAuthorization(run);
  const input = recoveryAuthorization(value);
  const budget = recoveryBudget(run);
  if (budget.policy) throw new Error("Auto recovery policy changes require recovery adopt with actual user authorization");
  if (input.owner !== budget.owner || input.specDigest !== budget.specDigest || input.authorization.specDigest !== budget.specDigest) throw new Error("Recovery authorization owner or specification does not match the durable policy");
  const owner = recoveryOwnerRecord(run, budget.owner);
  const state = owner.recovery;
  const prior = state?.grants?.find((grant) => grant.authorization.reference === input.authorization.reference);
  if (prior) {
    if (sameGrant(prior, input)) return owner;
    throw new Error("Recovery authorization reference was already used with different evidence");
  }
  if (input.revision !== budget.revision) throw new Error("Recovery authorization revision is stale; inspect the current recovery budget");
  if (budget.limit !== void 0 && budget.limit > Number.MAX_SAFE_INTEGER - input.additionalCorrections) throw new Error("Recovery grant exceeds the largest safe correction limit");
  const adoptedUsed = state?.adoptedUsed ?? (budget.limit === void 0 ? budget.used : void 0);
  const initialLimit = state?.initialLimit ?? budget.limit;
  const nextGrant = { additionalCorrections: input.additionalCorrections, authorization: input.authorization };
  owner.recovery = state ? { ...state, grants: [...state.grants ?? [], nextGrant] } : { owner: budget.owner, specDigest: budget.specDigest, grants: [nextGrant], ...initialLimit === void 0 ? {} : { initialLimit }, ...adoptedUsed === void 0 ? {} : { adoptedUsed } };
  promoteRecoveryRecord(owner, 3);
  event(owner, "recovery-authorize", `${input.authorization.reference}: +${input.additionalCorrections} corrections`);
  return owner;
}
function adoptRecoveryPolicy(run, value) {
  requireAuthorization(run);
  const input = recoveryAdoption(value);
  const budget = recoveryBudget(run);
  if (input.owner !== budget.owner || input.specDigest !== budget.specDigest || input.authorization.specDigest !== budget.specDigest) throw new Error("Recovery adoption owner or specification does not match the durable policy");
  const owner = recoveryOwnerRecord(run, budget.owner);
  const prior = owner.recovery?.adoptions?.find((adoption2) => adoption2.authorization.reference === input.authorization.reference);
  if (prior) {
    if (sameAdoption(prior, input)) return owner;
    throw new Error("Recovery adoption authorization reference was already used with different evidence");
  }
  if (input.revision !== budget.revision) throw new Error("Recovery adoption revision is stale; inspect the current recovery budget");
  const state = owner.recovery;
  const adoption = { policy: input.policy, authorization: input.authorization, at: (/* @__PURE__ */ new Date()).toISOString() };
  const initialLimit = state?.initialLimit ?? (owner.spec.recovery?.mode === "auto" ? void 0 : owner.spec.recovery?.maxCorrections);
  owner.recovery = {
    owner: budget.owner,
    specDigest: budget.specDigest,
    ...initialLimit === void 0 ? {} : { initialLimit },
    ...state?.grants ? { grants: state.grants } : { grants: [] },
    ...state?.adoptedUsed === void 0 ? {} : { adoptedUsed: state.adoptedUsed },
    policy: input.policy,
    policySource: "adoption",
    adoptions: [...state?.adoptions ?? [], adoption]
  };
  promoteRecoveryRecord(owner, 4);
  event(owner, "recovery-adopt", `${input.authorization.reference}: ${input.policy.maxCorrections === void 0 ? "auto" : `auto/${input.policy.maxCorrections}`}`);
  return owner;
}
function recoveryOwner(run) {
  if (run.recovery) return durableOwner(run, run.recovery);
  const ancestor = recoveryAncestor(run);
  if (ancestor) return ancestor;
  return { record: run, specDigest: run.specDigest };
}
function recoveryOwnerRecord(run, owner) {
  return run.spec.id === owner ? run : readRun(run.project, owner);
}
function durableOwner(run, state) {
  const owner = recoveryOwnerRecord(run, state.owner);
  if (owner.spec.id !== state.owner || owner.recovery?.owner !== state.owner || owner.recovery.specDigest !== state.specDigest) throw new Error("Recovery owner record no longer matches its durable policy identity");
  return { record: owner, specDigest: state.specDigest, state: owner.recovery };
}
function recoveryAncestor(run) {
  const seen = /* @__PURE__ */ new Set([run.spec.id]);
  let current = run;
  while (current.roadmapOrigin) {
    const origin = current.roadmapOrigin;
    if (seen.has(origin.parentRun)) throw new Error("Recovery roadmap ancestry is cyclic");
    seen.add(origin.parentRun);
    const parent = readRun(run.project, origin.parentRun);
    if (parent.recovery) return durableOwner(parent, parent.recovery);
    if (parent.spec.recovery && (parent.spec.recovery.mode !== "auto" || !parent.roadmapOrigin)) return { record: parent, specDigest: parent.specDigest };
    current = parent;
  }
  return current === run ? void 0 : { record: current, specDigest: current.specDigest };
}
function recoveryFamily(run, owner) {
  const records = new Map(listRuns(run.project).map((record) => [record.spec.id, record]));
  records.set(run.spec.id, run);
  return [...records.values()].filter((record) => belongsToOwner(record, owner, records));
}
function belongsToOwner(record, owner, records) {
  if (record.spec.id === owner.spec.id) return true;
  const policyDigest = owner.recovery?.specDigest ?? owner.specDigest;
  if (record.recovery?.owner === owner.spec.id && record.recovery.specDigest === policyDigest) return true;
  const seen = /* @__PURE__ */ new Set([record.spec.id]);
  let current = record;
  while (current.roadmapOrigin) {
    const origin = current.roadmapOrigin;
    if (seen.has(origin.parentRun)) return false;
    seen.add(origin.parentRun);
    const parent = records.get(origin.parentRun);
    if (!parent) return false;
    if (parent.spec.id === owner.spec.id) return true;
    current = parent;
  }
  return false;
}
function effectivePolicy(owner, state) {
  if (state?.policy) return { policy: state.policy, source: state.policySource ?? "adoption" };
  if (owner.spec.recovery?.mode === "auto") return { policy: owner.spec.recovery, source: "spec" };
  return { source: "legacy" };
}
function recoveryLimit(owner, state) {
  if (state?.initialLimit !== void 0) return state.initialLimit;
  if (!owner.spec.recovery) return state?.adoptedUsed;
  return owner.spec.recovery.maxCorrections;
}
function grantTotal(grants) {
  return grants.reduce((total, grant) => {
    if (total > Number.MAX_SAFE_INTEGER - grant.additionalCorrections) throw new Error("Recovery grants exceed the largest safe correction limit");
    return total + grant.additionalCorrections;
  }, 0);
}
function revision(owner, specDigest, state, family) {
  const members = [...family].sort((left, right) => left.spec.id.localeCompare(right.spec.id));
  return digest(JSON.stringify({ owner: owner.spec.id, specDigest, grants: state?.grants ?? [], policy: state?.policy, policySource: state?.policySource, adoptions: state?.adoptions ?? [], family: members.map((member) => ({ id: member.spec.id, specDigest: member.specDigest, failures: member.blocks.flatMap((block) => block.failure ? [[block.id, block.failure]] : []), rounds: member.blocks.flatMap((block) => block.rounds.map((round, position) => [block.id, position, round.signature, round.at])), control: member.recoveryControl })) }));
}
function recoveryAuthorization(value) {
  const input = recoveryInput(value, "authorization");
  if (!positive2(input.additionalCorrections)) throw new Error("Recovery authorization is malformed");
  return { ...input, additionalCorrections: input.additionalCorrections };
}
function recoveryAdoption(value) {
  const input = recoveryInput(value, "policy");
  assertAutoRecoveryPolicy(input.policy, "Recovery adoption requires an auto policy with an optional positive correction limit: ");
  return { ...input, policy: input.policy };
}
function recoveryInput(value, requiredField) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Recovery ${requiredField === "policy" ? "adoption" : "authorization"} must be an object`);
  const input = value;
  const permitted = requiredField === "policy" ? ["owner", "specDigest", "revision", "policy", "authorization"] : ["owner", "specDigest", "revision", "additionalCorrections", "authorization"];
  if (Object.keys(input).some((key) => !permitted.includes(key)) || !identifier4(input.owner) || !hash2(input.specDigest) || !hash2(input.revision)) throw new Error(`Recovery ${requiredField === "policy" ? "adoption" : "authorization"} is malformed`);
  const authorization = input.authorization;
  if (!authorization || typeof authorization !== "object" || Array.isArray(authorization)) throw new Error("Recovery authorization needs actual user evidence bound to the recovery specification");
  const user = authorization;
  if (Object.keys(user).some((key) => !["kind", "reference", "message", "specDigest"].includes(key)) || user.kind !== "user" || !text2(user.reference) || !text2(user.message) || !hash2(user.specDigest)) throw new Error("Recovery authorization needs actual user evidence bound to the recovery specification");
  return { ...input, owner: input.owner, specDigest: input.specDigest, revision: input.revision, authorization: { kind: "user", reference: user.reference, message: user.message, specDigest: user.specDigest } };
}
function sameGrant(grant, input) {
  return grant.additionalCorrections === input.additionalCorrections && grant.authorization.reference === input.authorization.reference && grant.authorization.message === input.authorization.message && grant.authorization.specDigest === input.authorization.specDigest;
}
function sameAdoption(adoption, input) {
  return adoption.policy.mode === input.policy.mode && adoption.policy.maxCorrections === input.policy.maxCorrections && adoption.authorization.reference === input.authorization.reference && adoption.authorization.message === input.authorization.message && adoption.authorization.specDigest === input.authorization.specDigest;
}
function identifier4(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}
function hash2(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function positive2(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function text2(value) {
  return typeof value === "string" && Boolean(value.trim());
}

// src/recovery-control.ts
function recoveryStatus(run) {
  const budget = recoveryBudget(run);
  const block = run.blocks.find((entry) => entry.id === run.activeBlock);
  const failureKey = block?.failure ? currentFailureKey(block) : void 0;
  const pause = block?.failure ? recoveryPause(run, block, budget, failureKey) : void 0;
  const active = run.status === "running" || run.status === "blocked";
  const canCorrect = active && block ? !block.failure || !pause || pause.kind === "native-access" : false;
  const canVerify = active && Boolean(block) && !block?.failure;
  return { ...budget, run: run.spec.id, ...block ? { block: block.id } : {}, ...failureKey ? { failureKey } : {}, ...pause ? { pause } : {}, canCorrect, canVerify };
}
function recordRecoveryStrategy(run, value) {
  const { block } = activeBlock(run);
  if (!block.failure) throw new Error("Recovery strategy needs an unresolved failure");
  const input = strategyInput(value);
  const failureKey = currentFailureKey(block);
  if (input.block !== block.id || input.failureKey !== failureKey) throw new Error("Recovery strategy must bind the active unresolved failure and its current round");
  const control = run.recoveryControl ?? { strategies: [], progress: [] };
  const diagnosis = validateDiagnosis(run, block, input, control);
  validateComparableProgress(run, block, input.progress);
  if (control.strategies.some((strategy) => strategy.failureKey === failureKey && strategy.round === block.rounds.length)) throw new Error("This failure already has a recovery strategy; record actual progress or a new failure before reevaluating it");
  promoteRecoveryRecord(run, recoveryBudget(run).policy ? 4 : 3);
  run.recoveryControl = control;
  control.strategies.push({ ...input, diagnosis, round: block.rounds.length, at: (/* @__PURE__ */ new Date()).toISOString() });
  event(run, "recovery-strategy", `${block.id}:${block.rounds.length}`);
}
function recordRecoveryProgress(run, progress) {
  const auto = Boolean(recoveryBudget(run).policy);
  if (!auto && !run.recovery && !run.recoveryControl) return;
  const { block } = activeBlock(run);
  const control = run.recoveryControl ?? { strategies: [], progress: [] };
  let observation;
  const at = (/* @__PURE__ */ new Date()).toISOString();
  if (progress.kind === "check") {
    validateCheckProgress(run, block, progress.attempt);
    if (auto && !newCheckProgress(run, block, control, progress.attempt)) return;
    observation = { ...progress, block: block.id, round: block.rounds.length, at };
  } else {
    const finding = validateFindingProgress(block, progress.id);
    if (auto && control.progress.some((entry) => entry.block === block.id && entry.kind === "finding" && entry.id === progress.id)) return;
    observation = { ...progress, evidence: finding.evidence, resolution: finding.resolution, block: block.id, round: block.rounds.length, at };
  }
  const recorded = control.progress.some((entry) => entry.block === observation.block && (entry.kind === "check" && observation.kind === "check" ? entry.attempt === observation.attempt : entry.kind === "finding" && observation.kind === "finding" && entry.id === observation.id && entry.evidence === observation.evidence && entry.resolution === observation.resolution));
  if (recorded) return;
  promoteRecoveryRecord(run, auto ? 4 : 3);
  run.recoveryControl = control;
  control.progress.push(observation);
  event(run, "recovery-progress", progress.kind === "check" ? progress.attempt : progress.id);
}
function revokeFindingProgress(run, id) {
  if (!run.recoveryControl || !recoveryBudget(run).policy) return;
  const { block } = activeBlock(run);
  for (const progress of run.recoveryControl.progress) {
    if (progress.kind === "finding" && progress.block === block.id && progress.id === id && !progress.revokedAt) progress.revokedAt = (/* @__PURE__ */ new Date()).toISOString();
  }
  promoteRecoveryRecord(run, 4);
}
function recoveryPause(run, block, budget, failureKey) {
  if (block.failure.kind === "decision" && (!block.failure.approvalDigest || block.failure.approvalDigest === digest(JSON.stringify(run.approval)))) return { kind: "decision", reason: "Material decision still requires actual user authorization of its amendment.", next: "Record the approved amendment before correcting this decision failure." };
  if (budget.limit !== void 0 && budget.used >= budget.limit || !budget.policy && budget.limit === void 0 && block.rounds.length >= 3) return { kind: "budget", reason: "Recovery budget exhausted by the recorded correction limit.", next: budget.policy ? "Use recovery adopt with actual user authorization to change the explicit ceiling." : "Use applicable policy-adoption authority or an explicit finite recovery authorization before another correction." };
  if (strategyRequired(run, block, run.recoveryControl, failureKey)) return { kind: "stagnation", reason: "Recovery needs a fresh delivered diagnosis and a concrete repair strategy.", next: "Record a strategy bound to this failure before retrying." };
  if (nativeAccess(run, block)) return { kind: "native-access", reason: "The failed check is waiting for its linked native permission recovery.", next: "Record native authorization evidence for the linked permission episode, then retry that check." };
  return void 0;
}
function strategyRequired(run, block, control, failureKey) {
  if (block.rounds.length < 2) return false;
  if (control) assertControlEvidence(run, block, control);
  const current = control?.strategies.some((strategy) => strategy.failureKey === failureKey && strategy.round === block.rounds.length) ?? false;
  const auto = Boolean(recoveryBudget(run).policy);
  if (!auto && block.rounds.length === 2) return !current;
  const credited = auto ? qualifiedProgressRound(run, block, control) : Math.max(...(control?.progress ?? []).filter((entry) => entry.block === block.id).map((entry) => entry.round), 0);
  const diagnosed = Math.max(...(control?.strategies ?? []).filter((strategy) => strategy.block === block.id).map((strategy) => strategy.round), 0);
  return block.rounds.length - Math.max(credited, diagnosed) >= 2 && !current;
}
function nativeAccess(run, block) {
  const failed = run.checks.find((check) => check.attempt === block.failure?.checkAttempt);
  const episode = failed && block.permissionEpisodes?.[failed.id];
  return block.failure?.kind === "infrastructure" && failed?.status === "blocked" && failed.blocker === "permission" && Boolean(episode && failed.permissionEpisode === episode.id);
}
function validateDiagnosis(run, block, input, control) {
  if (input.diagnosis.agent === run.spec.principal) {
    const repeated = control.strategies.some((strategy) => strategy.diagnosis.agent === input.diagnosis.agent && strategy.diagnosis.report === input.diagnosis.report && strategy.approach === input.approach);
    const progressed = recoveryBudget(run).policy ? qualifiedProgressRound(run, block, control) > 0 && qualifiedProgressRound(run, block, control) >= block.rounds.length - 1 : control.progress.some((progress) => progress.block === block.id && progress.round >= block.rounds.length - 1);
    if (repeated && !progressed) throw new Error("Recovery strategy needs a changed principal diagnosis or approach, or actual recorded progress");
    return input.diagnosis;
  }
  const agent = run.agents.find((entry) => entry.id === input.diagnosis.agent);
  const delivery = agent?.deliveries?.at(-1);
  if (!agent || agent.block !== block.id || agent.status !== "finished" || !delivery) throw new Error("Recovery strategy needs the actual delivered result from its registered native diagnosis agent");
  if (!block.contributions && (!agent.tier || tierRank(agent.tier) < tierRank(block.implementationTier ?? "luna"))) throw new Error("Recovery strategy diagnosis agent tier does not cover the active implementation tier");
  if (control.strategies.some((strategy) => strategy.diagnosis.agent === agent.id && strategy.diagnosis.delivery?.at === delivery.at)) throw new Error("Recovery strategy needs a fresh native delivery; an old result cannot be relabeled as a new diagnosis");
  return { ...input.diagnosis, delivery: { ...delivery } };
}
function validateComparableProgress(run, block, progress) {
  if (!progress) return;
  const after = assertMetricLogs(run, block, progress);
  if (!recoveryBudget(run).policy) return;
  if (!run.spec.blocks.find((entry) => entry.id === block.id)?.checks.includes(after.id)) throw new Error("Comparable AUTO progress needs a required check");
  const implicated = run.checks.find((entry) => entry.attempt === block.failure?.checkAttempt);
  if (!implicated || implicated.id !== after.id) throw new Error("Comparable AUTO progress must address the check implicated by the current failure");
  const prior = (run.recoveryControl?.strategies ?? []).filter((entry) => entry.block === block.id && entry.progress && run.checks.find((check) => check.attempt === entry.progress.afterAttempt)?.id === after.id);
  if (prior.some((entry) => entry.progress.afterAttempt === progress.afterAttempt && entry.progress !== progress)) throw new Error("A measured check attempt cannot be credited again");
  if (prior.some((entry) => entry.progress.metric !== progress.metric)) throw new Error("Comparable AUTO progress must preserve the established check metric");
}
function newCheckProgress(run, block, control, attempt) {
  const check = run.checks.find((entry) => entry.attempt === attempt);
  const failed = previousFailure(run, block, attempt);
  if (!run.spec.blocks.find((entry) => entry.id === block.id)?.checks.includes(check.id) || !failed || !checkLogIntact(failed)) return false;
  return !firstCheckCredit(run, block, control, check.id);
}
function previousFailure(run, block, attempt) {
  const current = run.checks.findIndex((entry) => entry.attempt === attempt);
  const check = run.checks[current];
  return check && run.checks.slice(0, current).findLast((entry) => entry.block === block.id && entry.id === check.id && (entry.status === "fail" || entry.status === "reproduced") && entry.finished && check.finished && Date.parse(entry.finished) < Date.parse(check.finished) && JSON.stringify(entry.command) === JSON.stringify(check.command));
}
function firstCheckCredit(run, block, control, id) {
  return control.progress.find((entry) => entry.kind === "check" && entry.block === block.id && run.checks.find((check) => check.attempt === entry.attempt)?.id === id && previousFailure(run, block, entry.attempt));
}
function validateCheckProgress(run, block, attempt) {
  const check = run.checks.find((entry) => entry.attempt === attempt);
  if (!check || check.block !== block.id || check.status !== "pass" || !checkLogIntact(check)) throw new Error("Recovery check progress needs an intact recorded passing check in the active block");
}
function validateFindingProgress(block, id) {
  const finding = block.findings.find((entry) => entry.id === id);
  if (!finding || finding.disposition === "open" || !finding.resolution?.trim()) throw new Error("Recovery finding progress needs an existing resolved finding with evidence");
  return finding;
}
function strategyInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Recovery strategy must be an object");
  const input = value;
  if (Object.keys(input).some((key) => !["block", "failureKey", "diagnosis", "approach", "progress"].includes(key))) throw new Error("Recovery strategy contains unsupported fields");
  const diagnosis = input.diagnosis;
  if (!text3(input.block) || !hash3(input.failureKey) || !text3(input.approach) || !diagnosis || typeof diagnosis !== "object" || Array.isArray(diagnosis)) throw new Error("Recovery strategy is malformed");
  const details = diagnosis;
  if (Object.keys(details).some((key) => !["agent", "report", "evidence"].includes(key)) || !text3(details.agent) || !text3(details.report) || !texts2(details.evidence)) throw new Error("Recovery strategy diagnosis needs an agent, delivered outcome and concrete evidence");
  const progress = comparableProgress(input.progress);
  return { block: input.block, failureKey: input.failureKey, diagnosis: { agent: details.agent, report: details.report, evidence: details.evidence }, approach: input.approach, ...progress ? { progress } : {} };
}
function comparableProgress(value) {
  if (value === void 0) return void 0;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Comparable recovery progress must be an object");
  const progress = value;
  if (Object.keys(progress).some((key) => !["beforeAttempt", "afterAttempt", "metric", "before", "after", "evidence"].includes(key)) || !text3(progress.beforeAttempt) || !text3(progress.afterAttempt) || !text3(progress.metric) || !finite(progress.before) || !finite(progress.after) || !texts2(progress.evidence)) throw new Error("Comparable recovery progress is malformed");
  return { beforeAttempt: progress.beforeAttempt, afterAttempt: progress.afterAttempt, metric: progress.metric, before: progress.before, after: progress.after, evidence: progress.evidence };
}
function assertControlEvidence(run, block, control) {
  for (const strategy of control.strategies.filter((entry) => entry.block === block.id)) {
    if (strategy.diagnosis.delivery) {
      const agent = run.agents.find((entry) => entry.id === strategy.diagnosis.agent);
      if (!agent?.deliveries?.some((delivery) => delivery.at === strategy.diagnosis.delivery.at && delivery.report === strategy.diagnosis.delivery.report)) throw new Error("Recorded recovery strategy delivery is no longer intact");
    }
    if (strategy.progress) {
      const check = assertMetricLogs(run, block, strategy.progress);
      if (recoveryBudget(run).policy && !run.spec.blocks.find((entry) => entry.id === block.id)?.checks.includes(check.id)) throw new Error("Recorded AUTO metric progress needs a required check");
    }
  }
  for (const progress of control.progress.filter((entry) => entry.block === block.id)) {
    if (progress.kind === "check") validateCheckProgress(run, block, progress.attempt);
  }
}
function qualifiedProgressRound(run, block, control) {
  if (!control) return 0;
  const recorded = control.progress.filter((progress) => progress.block === block.id && !progress.revokedAt && (progress.kind === "check" ? currentCheckCredit(run, block, control, progress) : control.progress.find((entry) => entry.block === block.id && entry.kind === "finding" && entry.id === progress.id) === progress && block.findings.some((finding) => finding.id === progress.id && finding.disposition !== "open" && finding.evidence === progress.evidence && finding.resolution === progress.resolution))).map((progress) => progress.round);
  const comparable = control.strategies.filter((strategy) => strategy.block === block.id && strategy.progress).filter((strategy) => currentMetricBest(run, control, strategy)).map((strategy) => strategy.round);
  return Math.max(...recorded, ...comparable, 0);
}
function currentCheckCredit(run, block, control, progress) {
  const position = run.checks.findIndex((check2) => check2.attempt === progress.attempt);
  const check = run.checks[position];
  const failed = previousFailure(run, block, progress.attempt);
  if (!run.spec.blocks.find((entry) => entry.id === block.id)?.checks.includes(check.id) || !failed || !checkLogIntact(failed)) return false;
  if (firstCheckCredit(run, block, control, check.id) !== progress) return false;
  return !run.checks.slice(position + 1).some((entry) => entry.block === block.id && entry.id === check.id && entry.status !== "pass");
}
function currentMetricBest(run, control, candidate) {
  const check = run.checks.find((entry) => entry.attempt === candidate.progress.afterAttempt);
  const latestCheck = run.checks.findLast((entry) => entry.block === candidate.block && entry.id === check.id);
  if (latestCheck !== check) return false;
  const metrics = control.strategies.filter((strategy) => strategy.block === candidate.block && strategy.progress && run.checks.find((entry) => entry.attempt === strategy.progress.afterAttempt)?.id === check.id);
  if (metrics.some((strategy) => strategy.progress.metric !== candidate.progress.metric)) return false;
  if (metrics.at(-1) !== candidate) return false;
  return metrics.slice(0, -1).every((strategy) => Math.min(strategy.progress.before, strategy.progress.after) > candidate.progress.after);
}
function assertMetricLogs(run, block, progress) {
  if (!finite(progress.before) || !finite(progress.after) || progress.before < 0 || progress.after < 0 || progress.before <= progress.after) throw new Error("Comparable recovery progress needs a nonnegative reduction from before to after");
  const beforePosition = run.checks.findIndex((check) => check.attempt === progress.beforeAttempt);
  const afterPosition = run.checks.findIndex((check) => check.attempt === progress.afterAttempt);
  const before = run.checks[beforePosition];
  const after = run.checks[afterPosition];
  if (!before || !after || beforePosition >= afterPosition || before.block !== block.id || after.block !== block.id || before.id !== after.id || JSON.stringify(before.command) !== JSON.stringify(after.command) || before.status === "running" || after.status === "running" || !before.finished || !after.finished || !(Date.parse(before.finished) < Date.parse(after.finished)) || !checkLogIntact(before) || !checkLogIntact(after)) throw new Error("Comparable recovery progress needs intact chronological before and after logs from the same completed check");
  return after;
}
function checkLogIntact(check) {
  return Boolean(check.logDigest) && (0, import_node_fs8.existsSync)(check.log) && digest((0, import_node_fs8.readFileSync)(check.log)) === check.logDigest;
}
function currentFailureKey(block) {
  return digest(JSON.stringify([block.id, block.failure, block.rounds.length]));
}
function text3(value) {
  return typeof value === "string" && Boolean(value.trim());
}
function texts2(value) {
  return Array.isArray(value) && value.length > 0 && value.every(text3);
}
function hash3(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// src/recovery.ts
function recordFailure(run, kind, cause, checkAttempt) {
  const { block, specification } = activeBlock(run);
  block.failure = { kind, cause, signature: digest(JSON.stringify(snapshot(run.project, specification.scope))), approvalDigest: digest(JSON.stringify(run.approval)) };
  if (checkAttempt) block.failure.checkAttempt = checkAttempt;
  run.next = `${kind}: ${cause}. Repair the cause and use retry with evidence; do not replace the run or reviewer.`;
  event(run, "failure", `${kind}: ${cause}`);
}
function recoverCheck(run, id, recovery2) {
  const { block } = activeBlock(run);
  const failure = block.failure;
  if (!failure) throw new Error("No unresolved failure; continue without spending another round");
  const failedCheck = run.checks.find((check) => check.attempt === failure.checkAttempt);
  if (failedCheck && (failedCheck.id !== id || failedCheck.block !== block.id)) throw new Error("Recovery must target the failed check in the active block");
  if (recovery2.kind === "correction") {
    retry(run, recovery2.evidence, recovery2.escalated ?? false, recovery2.measured);
    if (block.failure || block.status === "blocked") throw new Error(run.next);
    return;
  }
  const episode = block.permissionEpisodes?.[id];
  if (failure.kind !== "infrastructure" || failedCheck?.status !== "blocked" || failedCheck.blocker !== "permission" || !episode || failedCheck.permissionEpisode !== episode.id) {
    throw new Error("Permission recovery requires the linked observed permission failure; other and legacy failures use ordinary correction");
  }
  if (!recovery2.evidence.trim()) throw new Error("Permission recovery needs evidence of actual native authorization for this invocation");
  if (episode.recovery) throw new Error("Permission recovery already attempted for this unresolved episode; preserve the blocker and diagnose the actual cause");
  if (!failedCheck.logDigest || digest((0, import_node_fs9.readFileSync)(failedCheck.log)) !== failedCheck.logDigest) throw new Error("Permission recovery needs the intact recorded failure log");
  episode.recovery = { evidence: recovery2.evidence, at: (/* @__PURE__ */ new Date()).toISOString() };
  delete block.failure;
  block.status = "active";
  run.status = "running";
  run.next = `Confirm the native-authorized permission recovery for check ${id}`;
  event(run, "permission-retry", `${episode.id}: ${recovery2.evidence}`);
}
function retry(run, evidence, escalated, changedEnvironment) {
  const { block, specification } = activeBlock(run);
  const failure = block.failure;
  if (!failure) throw new Error("No unresolved failure; continue without spending another round");
  if (!evidence.trim()) throw new Error("Recovery needs concrete evidence of what changed");
  const status = recoveryStatus(run);
  if (!status.canCorrect) throw new Error(status.pause?.reason ?? "Recovery cannot correct the current run state");
  const current = digest(JSON.stringify(snapshot(run.project, specification.scope)));
  const externalRepair = (failure.kind === "infrastructure" || failure.kind === "delivery") && changedEnvironment?.trim();
  const approvalDigest = digest(JSON.stringify(run.approval));
  const authorizedDecision = failure.kind === "decision" && Boolean(failure.approvalDigest) && failure.approvalDigest !== approvalDigest;
  if (current === failure.signature && !externalRepair && !authorizedDecision) throw new Error("Cause is unchanged; provide measured environment/delivery evidence or repair relevant inputs before retrying");
  const signature = digest(JSON.stringify([current, failure.kind, failure.cause, changedEnvironment ?? "", failure.kind === "decision" ? approvalDigest : null]));
  if (block.rounds.some((round) => round.signature === signature)) throw new Error("This unchanged recovery was already attempted; no relaunch");
  if (status.limit !== void 0 && !run.recovery && run.spec.id === status.owner) {
    promoteRecoveryRecord(run, 3);
    run.recovery = { owner: status.owner, specDigest: status.specDigest, initialLimit: status.limit, grants: [] };
  }
  block.rounds.push({ kind: failure.kind, cause: failure.cause, evidence, escalated, signature, at: (/* @__PURE__ */ new Date()).toISOString() });
  delete block.failure;
  block.status = "active";
  run.status = "running";
  run.next = `Confirm the repaired cause for ${block.id} with affected checks and the existing reviewer`;
  const correctionCount = status.limit !== void 0 ? `${status.used + 1}/${status.limit}` : status.policy ? `${status.used + 1} (auto)` : `${block.rounds.length}/3`;
  event(run, "retry", `${correctionCount}: ${evidence}`);
}
function reconcile(run) {
  for (const check of run.checks.filter((entry) => entry.status === "running")) {
    if (processAlive(check.runner)) continue;
    if (check.child && processAlive(check.child)) {
      run.next = `Check ${check.attempt} still owns pid ${check.child.pid}; do not replace it`;
      continue;
    }
    check.status = "interrupted";
    check.finished = (/* @__PURE__ */ new Date()).toISOString();
    check.diagnostics.push("Runner ended without a final result; existing logs were retained");
    if (run.activeBlock) recordFailure(run, "infrastructure", `Interrupted check ${check.id}`);
  }
  const unresolved = run.agents.filter((agent) => agent.status !== "finished");
  if (unresolved.length) run.next = `Reconcile native agent handles before replacing writers: ${unresolved.map((agent) => agent.id).join(", ")}`;
  event(run, "resume", run.next);
}
function confirmStoppedCheck(run, attempt, evidence) {
  if (!evidence.trim()) throw new Error("Provide the actual native terminal result confirming the runner and its children ended");
  const check = run.checks.find((entry) => entry.attempt === attempt);
  if (!check || check.status !== "running") throw new Error("Select the recorded running check; completed checks need no recovery");
  requireStoppedIdentity(check.runner);
  if (check.child) requireStoppedIdentity(check.child);
  releaseStoppedCheckLocks(run.project, check.runner, namedResourceLockDirectory(run));
  check.status = "interrupted";
  check.finished = (/* @__PURE__ */ new Date()).toISOString();
  check.diagnostics.push(`Native handle confirmed stopped without a final result: ${evidence}`);
  recordFailure(run, "infrastructure", `Interrupted check ${check.id}; ${evidence}`);
  event(run, "native-stop-confirmed", `${attempt}: ${evidence}`);
}

// src/checks.ts
async function executeCheck(project, id, reproduction = false, recovery2) {
  if (reproduction && recovery2) throw new Error("Recovery cannot be combined with red reproduction");
  const prepared = transaction(project, () => prepareCheck(readRun(project), id, reproduction, recovery2));
  if ("reused" in prepared) return prepared;
  const { run, specification, result, release, log } = prepared;
  try {
    const outcome = await runCommand(run, specification, result, log);
    return transaction(project, () => finishCheck(readRun(project, run.spec.id), specification, result.attempt, { ...outcome, reproduction }));
  } finally {
    (0, import_node_fs10.closeSync)(log);
    release();
  }
}
function validCheck(run, id, cache = /* @__PURE__ */ new Map()) {
  if (run.blocks.some((block) => block.permissionEpisodes?.[id])) return void 0;
  const specification = run.spec.checks.find((check) => check.id === id);
  if (!specification) return void 0;
  const fingerprint = checkFingerprint(run.project, specification, cache);
  return relatedRuns(run).flatMap((related) => related.checks).findLast((check) => check.id === id && check.status === "pass" && check.fingerprint === fingerprint && check.logDigest && intactLog(check));
}
function relatedRuns(run) {
  const parentId = roadmapParentId(run);
  const parent = run.spec.mode === "roadmap" ? run : parentId ? readRun(run.project, parentId) : run;
  if (!parent.approval || parent.spec.mode !== "roadmap") return [run];
  const member = parent.spec.children?.find((child) => child.id === run.spec.id);
  if (run !== parent && (!member || !childSatisfiesRoadmap(parent, member, run))) return [run];
  const related = [parent];
  for (const child of parent.spec.children ?? []) {
    const directory = stateDirectory(run.project);
    if (!(0, import_node_fs10.existsSync)(import_node_path9.default.join(directory, "runs", `${child.id}.json`)) && !(0, import_node_fs10.existsSync)(import_node_path9.default.join(directory, `${child.id}.json`))) continue;
    const candidate = child.id === run.spec.id ? run : readRun(run.project, child.id);
    if (childSatisfiesRoadmap(parent, child, candidate)) related.push(candidate);
  }
  return related;
}
function prepareCheck(run, id, reproduction, recovery2) {
  reconcile(run);
  const { block, specification: blockSpec } = activeBlock(run);
  if (!blockSpec.checks.includes(id)) throw new Error(`Check ${id} is outside the active block's approved verification bar`);
  const availability = recoveryStatus(run);
  if (!recovery2 && !availability.canVerify) {
    writeRun(run);
    throw new Error(availability.pause?.next ?? run.next);
  }
  if (run.checks.some((check) => check.status === "running")) throw new Error("A check executor is still running; reconcile its process before starting another");
  if (reproduction && run.checks.some((check) => check.block === block.id && check.id === id)) throw new Error("A red reproduction is only the first observation of this block/check; retain prior evidence and use ordinary correction for later failures");
  const specification = run.spec.checks.find((check) => check.id === id);
  const cache = /* @__PURE__ */ new Map();
  const previous = validCheck(run, id, cache);
  if (reproduction && previous) throw new Error("Current evidence already passes; inspect the intended reproduction instead of inventing a red result");
  if (previous) {
    if (recovery2) recoverCheck(run, id, recovery2);
    if (block.permissionEpisodes) delete block.permissionEpisodes[id];
    event(run, "check-reused", previous.attempt);
    writeRun(run);
    return { ...previous, reused: true };
  }
  const releases = [];
  let log;
  let logPath;
  try {
    releases.push(acquireLock(import_node_path9.default.join(stateDirectory(run.project), "locks", digest("project-bar"))));
    const shared = namedResourceLockDirectory(run);
    for (const resource of [...new Set(specification.resources ?? [])].sort()) releases.push(acquireLock(import_node_path9.default.join(shared ?? import_node_path9.default.join(stateDirectory(run.project), "locks"), digest(resource))));
    const attempt = `${id}-${(0, import_node_crypto3.randomUUID)()}`;
    const logs = import_node_path9.default.join(stateDirectory(run.project), "logs", run.spec.id);
    (0, import_node_fs10.mkdirSync)(logs, { recursive: true, mode: 448 });
    const result = {
      id,
      attempt,
      block: block.id,
      command: specification.command,
      cwd: insideProject(run.project, specification.cwd ?? "."),
      fingerprint: checkFingerprint(run.project, specification, cache),
      started: (/* @__PURE__ */ new Date()).toISOString(),
      status: "running",
      log: import_node_path9.default.join(logs, `${attempt}.log`),
      diagnostics: [],
      runner: processIdentity(process.pid)
    };
    log = (0, import_node_fs10.openSync)(result.log, "wx", 384);
    logPath = result.log;
    if (recovery2) recoverCheck(run, id, recovery2);
    if (block.permissionEpisodes?.[id]) result.permissionEpisode = block.permissionEpisodes[id].id;
    run.checks.push(result);
    event(run, "check-start", attempt);
    writeRun(run);
    return { run, specification, result, log, release: () => releases.reverse().forEach((unlock) => unlock()) };
  } catch (error) {
    if (log !== void 0) (0, import_node_fs10.closeSync)(log);
    if (logPath) (0, import_node_fs10.unlinkSync)(logPath);
    releases.reverse().forEach((unlock) => unlock());
    throw error;
  }
}
async function runCommand(run, specification, result, log) {
  return new Promise((resolve) => {
    const child = (0, import_node_child_process2.spawn)(specification.command[0], specification.command.slice(1), { cwd: result.cwd, stdio: ["ignore", log, log], detached: process.platform !== "win32" });
    let timeout = false;
    let error;
    if (child.pid) transaction(run.project, () => {
      const current = readRun(run.project, run.spec.id);
      current.checks.find((check) => check.attempt === result.attempt).child = processIdentity(child.pid);
      writeRun(current);
    });
    const deadline = setTimeout(() => {
      timeout = true;
      if (!child.pid) return;
      try {
        process.kill(process.platform === "win32" ? child.pid : -child.pid, "SIGKILL");
      } catch (failure) {
        if (failure.code !== "ESRCH") error = `Could not stop timed-out process: ${String(failure)}`;
      }
    }, specification.timeoutMs ?? 6e5);
    child.once("error", (failure) => {
      error = String(failure);
    });
    child.once("close", (code, signal) => {
      clearTimeout(deadline);
      resolve({ code, signal, error, timeout });
    });
  });
}
function finishCheck(run, specification, attempt, outcome) {
  const result = run.checks.find((check) => check.attempt === attempt);
  const log = (0, import_node_fs10.readFileSync)(result.log);
  const classification = classifyOutput(log.toString("utf8"), outcome);
  result.finished = (/* @__PURE__ */ new Date()).toISOString();
  result.exitCode = outcome.code;
  result.signal = outcome.signal;
  result.logDigest = digest(log);
  result.status = classification.status;
  result.diagnostics = classification.diagnostics;
  if (classification.blocker) result.blocker = classification.blocker;
  const missingReproduction = outcome.reproduction && classification.status === "pass";
  if (missingReproduction) {
    result.status = "blocked";
    result.diagnostics.push("Expected pre-implementation failure was not reproduced; inspect the reported behavior and regression coverage. No green evidence was recorded.");
  }
  if (outcome.reproduction && classification.status === "fail" && outcome.code !== null && outcome.code !== 0) {
    result.status = "reproduced";
    result.diagnostics.push("Expected pre-implementation failure observed; inspect the log to confirm the intended regression. This is not passing evidence.");
  }
  if (result.fingerprint !== checkFingerprint(run.project, specification)) {
    result.status = "stale";
    result.diagnostics.push("Relevant inputs changed during this check");
  }
  const block = activeBlock(run).block;
  if (result.status === "blocked" && result.blocker === "permission") {
    const episodes = block.permissionEpisodes ??= {};
    const episode = episodes[specification.id] ??= { id: result.attempt };
    result.permissionEpisode = episode.id;
  }
  if (result.status === "pass" && block.permissionEpisodes) delete block.permissionEpisodes[specification.id];
  if (result.status === "pass") recordRecoveryProgress(run, { kind: "check", attempt: result.attempt });
  if (result.status !== "pass" && result.status !== "reproduced") {
    recordFailure(run, missingReproduction || result.status === "stale" ? "delivery" : result.status === "blocked" ? "infrastructure" : "product", `${specification.id}: ${result.diagnostics.join("; ") || `exit ${outcome.code}`}`, result.attempt);
    const episode = block.permissionEpisodes?.[specification.id];
    if (result.status === "blocked" && result.blocker === "permission") run.next = episode?.recovery ? `Permission recovery already attempted for check ${specification.id}; preserve the blocker and diagnose the actual cause. No automatic relaunch.` : `Check ${specification.id} encountered an access error. Inspect the cause; if native authorization resolves it, submit check ${specification.id} --retry-permission --evidence TEXT through the native approval route. Otherwise repair it using ordinary correction.`;
  }
  event(run, "check-end", `${attempt}: ${result.status}`);
  writeRun(run);
  return result;
}
function classifyOutput(log, outcome) {
  const lines = log.replace(/\u001b\[[0-9;]*m/g, "").split(/\r?\n/);
  const warnings = lines.filter((line) => /^\s*(?:(?:npm|pnpm|yarn)\s+WARN\b|(?:\[[^\]]+\]\s*)?WARN(?:ING)?\b|\(?node:\d+\)?.*\b\w*Warning:|(?:▲|⚠).*\bwarning\b|[1-9]\d*\s+warnings?\b)|:\d+(?::\d+)?\s+warning\b|^\s*\d+:\d+\s+warning\b/i.test(line));
  if (outcome.timeout) return { status: "blocked", blocker: "environment", diagnostics: [outcome.error ?? "Command timed out; inspect the owned process and environment"] };
  const permissionError = (line) => /^\s*(?:Error(?::|\s*\[)|(?:EACCES|EPERM|EROFS):)/i.test(line) && /\b(?:EACCES|EPERM|EROFS)\b/.test(line) || /^\s*(?:(?:fatal|error):|(?:\/[^\s:]+\/)?(?:ba|da|z|k)?sh:)/i.test(line) && /:\s*(?:permission denied|read-only file system|operation not permitted|access is denied)\s*$/i.test(line);
  if (outcome.error) return { status: "blocked", blocker: permissionError(outcome.error) ? "permission" : "environment", diagnostics: [outcome.error] };
  if (outcome.code !== 0) {
    const permission = lines.filter(permissionError);
    const infrastructure = lines.filter((line) => /\b(?:ENOENT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED)\b|^\s*(?:permission denied|command not found)|sandbox.*(?:denied|blocked)|network is unreachable/i.test(line));
    if (permission.length || infrastructure.length) return { status: "blocked", blocker: permission.length ? "permission" : "environment", diagnostics: [...permission, ...infrastructure, ...warnings].slice(0, 30) };
    return { status: "fail", diagnostics: warnings.slice(0, 30) };
  }
  return { status: warnings.length ? "fail" : "pass", diagnostics: warnings.slice(0, 30) };
}
function intactLog(check) {
  try {
    return digest((0, import_node_fs10.readFileSync)(check.log)) === check.logDigest;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// src/hooks.ts
var import_node_fs11 = require("node:fs");
var import_node_path11 = __toESM(require("node:path"), 1);

// src/shell-actions.ts
var import_node_path10 = __toESM(require("node:path"), 1);
function shellActions(source, depth = 0) {
  const actions = /* @__PURE__ */ new Set();
  if (depth > 16) return actions;
  const addScript = (script) => {
    for (const action of shellActions(script, depth + 1)) actions.add(action);
  };
  let cursor = 0;
  let words = [];
  let redirect;
  const documents = [];
  const flush = () => {
    inspectCommand(words, actions, addScript);
    words = [];
  };
  const expansion = () => {
    if (source.startsWith("$(", cursor)) {
      const start = cursor + 2;
      cursor = closingParenthesis(source, start);
      addScript(source.slice(start, cursor));
      cursor = Math.min(cursor + 1, source.length);
      return true;
    }
    if (source[cursor] === "`") {
      let script = "";
      cursor++;
      while (cursor < source.length && source[cursor] !== "`") {
        if (source[cursor] === "\\" && /[$`\\]/.test(source[cursor + 1] ?? "")) cursor++;
        script += source[cursor++];
      }
      cursor = Math.min(cursor + 1, source.length);
      addScript(script);
      return true;
    }
    return false;
  };
  while (cursor < source.length) {
    if (source[cursor] === "#" && !redirect) {
      while (cursor < source.length && source[cursor] !== "\n") cursor++;
      continue;
    }
    const character = source[cursor];
    if (/[ \t\r]/.test(character)) {
      cursor++;
      continue;
    }
    if (/[;\n&|()]/.test(character)) {
      flush();
      cursor++;
      if (character === "\n") {
        for (const document of documents.splice(0)) {
          let body = "";
          while (cursor < source.length) {
            const end = source.indexOf("\n", cursor);
            const line = source.slice(cursor, end === -1 ? source.length : end);
            cursor = end === -1 ? source.length : end + 1;
            if ((document.tabs ? line.replace(/^\t+/, "") : line) === document.delimiter) break;
            body += `${line}
`;
          }
          if (!document.literal) addScript(heredocExpansions(body));
        }
      }
      continue;
    }
    if (character === "<" || character === ">") {
      const operator = source.slice(cursor).match(/^(?:<<<|<<-|<<|>>|<>|<&|>&|>|<)/)[0];
      redirect = operator;
      cursor += operator.length;
      continue;
    }
    let word = "";
    let quoted = false;
    let quote = "";
    while (cursor < source.length) {
      const current = source[cursor];
      if (!quote && /[\s;&|()<>]/.test(current)) break;
      if (current === quote) {
        quote = "";
        quoted = true;
        cursor++;
        continue;
      }
      if (!quote && (current === "'" || current === '"')) {
        quote = current;
        quoted = true;
        cursor++;
        continue;
      }
      if (quote !== "'" && current === "\\") {
        quoted = true;
        const next = source[cursor + 1];
        if (quote === '"' && next && !/[$`"\\\n]/.test(next)) {
          word += current;
          cursor++;
          continue;
        }
        cursor += Math.min(2, source.length - cursor);
        if (next && next !== "\n") word += next;
        continue;
      }
      if (quote !== "'" && expansion()) {
        word += "\0";
        continue;
      }
      word += current;
      cursor++;
    }
    if (redirect) {
      if (redirect === "<<" || redirect === "<<-") documents.push({ delimiter: word, literal: quoted, tabs: redirect === "<<-" });
      redirect = void 0;
    } else if (!(/^\d+$/.test(word) && /[<>]/.test(source[cursor] ?? ""))) words.push(word);
  }
  flush();
  return actions;
}
function closingParenthesis(source, start) {
  let level = 1;
  let quote = "";
  for (let cursor = start; cursor < source.length; cursor++) {
    const current = source[cursor];
    if (current === "\\" && quote !== "'") {
      cursor++;
      continue;
    }
    if (current === quote) {
      quote = "";
      continue;
    }
    if (!quote && (current === "'" || current === '"' || current === "`")) {
      quote = current;
      continue;
    }
    if (quote) continue;
    if (current === "(") level++;
    if (current === ")" && --level === 0) return cursor;
  }
  return source.length;
}
function heredocExpansions(body) {
  const scripts = [];
  for (let cursor = 0; cursor < body.length; cursor++) {
    if (body[cursor] === "\\" && /[$`\\\n]/.test(body[cursor + 1] ?? "")) {
      cursor++;
      continue;
    }
    if (body.startsWith("$(", cursor)) {
      const end = closingParenthesis(body, cursor + 2);
      scripts.push(body.slice(cursor + 2, end));
      cursor = end;
    } else if (body[cursor] === "`") {
      const start = ++cursor;
      while (cursor < body.length && body[cursor] !== "`") {
        if (body[cursor] === "\\") cursor++;
        cursor++;
      }
      scripts.push(body.slice(start, cursor));
    }
  }
  return scripts.join("\n");
}
function inspectCommand(input, actions, addScript) {
  const words = [...input];
  while (words.length && (/^[A-Za-z_][A-Za-z_0-9]*=/.test(words[0]) || ["!", "{", "if", "then", "elif", "else", "do", "while", "until"].includes(words[0]))) words.shift();
  let executable = import_node_path10.default.basename(words.shift() ?? "");
  while (["env", "command", "exec", "sudo", "nohup", "time", "nice"].includes(executable)) {
    while (words.length && (words[0].startsWith("-") || /^[A-Za-z_][A-Za-z_0-9]*=/.test(words[0]))) {
      const option = words.shift();
      if (["-u", "--unset", "-C", "--chdir", "-a", "-g", "--group", "--user", "-f", "--format", "-o", "--output", "-n", "--adjustment"].includes(option)) words.shift();
    }
    executable = import_node_path10.default.basename(words.shift() ?? "");
  }
  if (["sh", "bash", "dash", "zsh", "ksh"].includes(executable)) {
    const option = words.findIndex((word) => /^-[^-]*c/.test(word));
    if (option !== -1 && words[option + 1]) addScript(words[option + 1]);
  } else if (executable === "eval") addScript(words.join(" "));
  else if (executable === "git") {
    while (words[0]?.startsWith("-")) {
      const option = words.shift();
      if (["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"].includes(option)) words.shift();
    }
    if (["commit", "commit-tree", "update-ref", "fast-import", "filter-branch"].includes(words[0] ?? "") || gitReplaceMutation(words)) actions.add("commit");
    if (words[0] === "push") actions.add("publication");
  } else if (["npm", "pnpm"].includes(executable) && words[0] === "publish" || ["vercel", "netlify", "firebase", "wrangler"].includes(executable) && ["deploy", "publish"].includes(words[0] ?? "")) actions.add("publication");
}
function gitReplaceMutation(words) {
  if (words[0] !== "replace") return false;
  const options = words.slice(1);
  return !options.includes("--list") && !options.includes("-l") && !options.includes("--help") && !options.includes("-h");
}

// src/hooks.ts
function hookDecision(input) {
  if (!input.cwd || input.hook_event_name !== "PreToolUse") return { allow: true };
  const tool = input.tool_name ?? "";
  const command = typeof input.tool_input === "string" ? input.tool_input : input.tool_input?.command ?? input.tool_input?.cmd ?? input.tool_input?.input ?? input.tool_input?.patch ?? "";
  const editing = /apply_patch|Edit|Write/.test(tool);
  const actions = /^(?:Bash|(?:.*[._])?exec_command|shell_command)$/.test(tool) ? shellActions(command) : /* @__PURE__ */ new Set();
  if (mcpPublicationAction(tool)) actions.add("publication");
  if (!editing && actions.size === 0) return { allow: true };
  try {
    let project;
    try {
      project = projectRoot(input.cwd);
    } catch (error) {
      if (error.status === 128) return { allow: true };
      throw error;
    }
    if (!(0, import_node_fs11.existsSync)(import_node_path11.default.join(stateDirectory(project), "active"))) return { allow: true };
    const run = readRun(project);
    if (run.status === "closed") return { allow: true };
    if (editing) {
      if (run.status === "parked") return { allow: false, reason: "OsoCode: this selected run is parked; retain its evidence and resume it before editing." };
      if (metadataOnlyPatch(command, run)) return { allow: true };
      if (!run.approval || !run.activeBlock) return { allow: false, reason: "OsoCode: code edits require authorization and an active approved block. Read status; do not restart the run." };
      const recovery2 = recoveryStatus(run);
      if (!recovery2.canCorrect) return { allow: false, reason: recovery2.pause?.next ?? run.next };
      return { allow: true };
    }
    if (actions.has("commit")) {
      const decision = commitDecision(run);
      if (!decision.allow) return decision;
    }
    if (actions.has("publication")) {
      const publication = familyBoundary(run, "publication");
      if (publication?.status === "open") return { allow: false, reason: publication.cause };
      if (!run.approval || !run.spec.publication) return { allow: false, reason: "Publication or production action is outside the recorded authorization. Obtain approval for the concrete external action." };
    }
    return { allow: true };
  } catch (error) {
    return { allow: false, reason: `OsoCode could not validate this protected action: ${error instanceof Error ? error.message : String(error)}. Preserve the run and inspect its evidence with the compatible runtime; after a plugin update, continue in a fresh Codex thread.` };
  }
}
function mcpPublicationAction(tool) {
  if (!tool.startsWith("mcp__")) return false;
  const action = tool.split("__").at(-1)?.toLocaleLowerCase() ?? "";
  if (/^(?:get|list|read|fetch|search|preview|prepare|status)(?:_|$)/.test(action)) return false;
  return /^(?:publish|deploy)(?:_|$)/.test(action) || ["release", "create_release", "create_deployment"].includes(action);
}
function metadataOnlyPatch(patch, run) {
  const filenames = [...patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)].map((match) => match[1]);
  return filenames.length > 0 && filenames.every((filename) => {
    const relative = import_node_path11.default.relative(stateDirectory(run.project), import_node_path11.default.resolve(run.project, filename));
    return relative !== ".." && !relative.startsWith(`..${import_node_path11.default.sep}`) && !import_node_path11.default.isAbsolute(relative) && !["runs", "logs", "reviews", "locks", "active", `${run.spec.id}.json`].includes(relative.split(import_node_path11.default.sep)[0]);
  });
}
function commitDecision(run) {
  const commit = familyBoundary(run, "commit");
  if (commit?.status === "open") return { allow: false, reason: `Required commit remains blocked: ${commit.cause}. Record actual changed-permission evidence before retrying.` };
  if (!run.approval || run.activeBlock) return { allow: false, reason: "Close the active block with its executed checks and independent review before committing." };
  const block = run.blocks.findLast((entry) => entry.status === "closed");
  if (!block) return { allow: false, reason: "No reviewed block is ready to commit." };
  const specification = run.spec.blocks.find((entry) => entry.id === block.id);
  if (digest(JSON.stringify(block.closedSnapshot)) !== digest(JSON.stringify(snapshot(run.project, specification.scope)))) return { allow: false, reason: "Code changed after block closure; reopen the block and verify affected evidence." };
  if (!block.closedModes || digest(JSON.stringify(block.closedModes)) !== digest(JSON.stringify(fileModes(run.project, snapshot(run.project, specification.scope))))) return { allow: false, reason: "Current Git mode provenance is missing or changed after closure; reopen and review the affected change." };
  const cache = /* @__PURE__ */ new Map();
  if (specification.checks.some((id) => !validCheck(run, id, cache))) return { allow: false, reason: "Required checks are stale or incomplete." };
  const staged = captureCommand(["git", "diff", "--cached", "--name-only", "-z"], run.project).split("\0").filter(Boolean);
  const current = snapshot(run.project);
  const owned = new Set(ownershipChanges(run, run.baseline, run.baselineModes, run.baseHead));
  const unstaged = new Set(captureCommand(["git", "diff", "--name-only", "-z"], run.project).split("\0"));
  const indexedModes = new Map(captureCommand(["git", "ls-files", "--stage", "-z"], run.project).split("\0").filter(Boolean).map((entry) => [entry.slice(entry.indexOf("	") + 1), entry.split(" ")[0]]));
  for (const adoption of run.adoptions ?? []) {
    for (const [filename, hash4] of Object.entries(adoption.files)) {
      if (current[filename] === hash4 && run.baseline[filename] === hash4 && !unstaged.has(filename) && adoption.modes?.[filename] === gitFileMode(run.project, filename) && adoption.modes[filename] === indexedModes.get(filename)) owned.add(filename);
    }
  }
  if ([...owned].some((filename) => !scopeMatches(filename, run.spec.blocks.flatMap((entry) => entry.scope)))) return { allow: false, reason: "Reconcile changes outside the approved run scope before committing." };
  if (staged.some((filename) => !owned.has(filename))) return { allow: false, reason: "The index includes files this run did not change. Stage only the owned change." };
  if (staged.some((filename) => unstaged.has(filename) || current[filename] !== void 0 && indexedModes.get(filename) !== gitFileMode(run.project, filename))) return { allow: false, reason: "The index differs from the reviewed worktree. Stage the reviewed version before committing." };
  if (staged.some((filename) => !run.blocks.some((entry) => entry.status === "closed" && scopeMatches(filename, run.spec.blocks.find((spec) => spec.id === entry.id).scope) && entry.closedSnapshot?.[filename] === current[filename]))) return { allow: false, reason: "A staged file has no matching reviewed checkpoint. Reconcile its approved block before committing." };
  return { allow: true };
}

// src/external-fulfillment.ts
var import_node_fs13 = require("node:fs");
var import_node_path13 = __toESM(require("node:path"), 1);

// src/reviews.ts
var import_node_crypto4 = require("node:crypto");
var import_node_fs12 = require("node:fs");
var import_node_path12 = __toESM(require("node:path"), 1);
function registerAgent(run, assignment, final = false) {
  requireAuthorization(run);
  const truthful = Boolean(run.spec.coordination || run.spec.reviewFallback);
  const previous = run.agents.find((agent) => agent.id === assignment.id);
  if (assignment.observation && previous && Object.keys(assignment).every((key) => key === "id" || key === "observation")) {
    if (!truthful) throw new Error("Observed model configuration requires a truthful-accounting adoption");
    if (!validConfiguration(assignment.observation)) throw new Error("Observed configuration requires model and reasoningEffort");
    (previous.observations ??= []).push({ at: (/* @__PURE__ */ new Date()).toISOString(), configuration: assignment.observation });
    previous.observedConfiguration = assignment.observation;
    event(run, "agent-observation", assignment.id);
    return;
  }
  if (!["plan", "roadmap"].includes(run.spec.mode)) final = false;
  const block = final ? void 0 : activeBlock(run).block;
  const launch = assignment;
  if (!truthful && (launch.configuration || launch.observation || launch.replaces)) throw new Error("Model configuration and replacement history require a truthful-accounting adoption");
  if (block && launch.role === "applier") {
    const recovery2 = recoveryStatus(run);
    if (!recovery2.canCorrect) throw new Error(recovery2.pause?.next ?? run.next);
  }
  if (final && launch.role !== "reviewer") throw new Error("Cumulative closure only delegates independent review");
  if (!launch.id.trim() || launch.id === run.spec.principal) throw new Error("Use the native child agent identity");
  if (launch.configuration && !validNativeConfiguration(launch.configuration) || launch.observation && !validConfiguration(launch.observation)) throw new Error("Requested configuration requires model, reasoningEffort and forkTurns:none; observed configuration requires model and reasoningEffort");
  if (launch.observation && !previous) throw new Error("Observed configuration must extend an existing native identity");
  if (previous && previous.status !== "finished") throw new Error("Agent is still registered as running; reconcile its native handle before follow-up");
  if (previous && previous.role !== launch.role) throw new Error("An existing native agent cannot silently change roles");
  if (!(block?.contributions || final && run.blocks.some((entry) => entry.contributions)) && !launch.tier) throw new Error("Legacy native assignments require their actual model tier");
  if (previous?.requestedConfiguration && launch.configuration && !sameConfiguration(previous.requestedConfiguration, launch.configuration)) throw new Error("An existing native agent cannot silently change its original launch configuration");
  if (launch.replaces) {
    const replaced = run.agents.find((agent) => agent.id === launch.replaces);
    if (!replaced || replaced.status !== "finished" || replaced.role !== launch.role || launch.replaces === launch.id) throw new Error("A replacement must retain a completed same-role native assignment");
  }
  const failureKey = block?.failure ? digest(JSON.stringify([block.id, block.failure, block.rounds.length])) : void 0;
  if (failureKey && run.agents.some((agent) => agent.id !== launch.id && agent.role === launch.role && agent.failureKey === failureKey)) throw new Error("This unresolved failure already has a native agent for that role; recover its result instead of launching a replacement");
  const maximum = run.spec.coordination?.maxActiveAgents ?? 2;
  if (run.agents.filter((agent) => agent.status !== "finished").length >= maximum) throw new Error(run.spec.coordination ? "configured child capacity is full; reconcile a native handle before launching another child" : "Maximum two concurrent child agents; no recursive delegation");
  if (launch.role === "applier") {
    const overlaps = run.agents.some((agent) => agent.status !== "finished" && agent.role === "applier" && scopesOverlap(agent.scope, launch.scope));
    if (overlaps) throw new Error("A writer still owns this scope; reconcile it before replacement");
    if (!block.contributions) {
      if (!block.writers.includes(launch.id)) block.writers.push(launch.id);
      if (!block.implementationTier || tierRank(launch.tier) > tierRank(block.implementationTier)) block.implementationTier = launch.tier;
    }
  }
  const registered = { id: launch.id, role: launch.role, ...launch.tier ? { tier: launch.tier } : {}, scope: launch.scope, block: block?.id ?? "final", status: "running", failureKey, ...truthful && launch.configuration ? { requestedConfiguration: launch.configuration } : {}, ...truthful && launch.replaces ? { replacementFor: launch.replaces } : {} };
  if (previous) {
    if (launch.observation) (previous.observations ??= []).push({ at: (/* @__PURE__ */ new Date()).toISOString(), configuration: launch.observation });
    Object.assign(previous, registered, { requestedConfiguration: previous.requestedConfiguration ?? launch.configuration, observedConfiguration: launch.observation ?? previous.observedConfiguration, observations: previous.observations, result: void 0 });
  } else run.agents.push(registered);
  if (truthful) {
    const target = previous ?? registered;
    (target.assignments ??= []).push({ at: (/* @__PURE__ */ new Date()).toISOString(), block: registered.block, scope: [...registered.scope], ...target.requestedConfiguration ? { requestedConfiguration: target.requestedConfiguration } : {}, ...target.observedConfiguration ? { observedConfiguration: target.observedConfiguration } : {}, ...registered.replacementFor ? { replacementFor: registered.replacementFor } : {} });
  }
  event(run, "agent-start", `${launch.id}: ${launch.role}/${launch.tier ?? launch.configuration?.model ?? "unconfigured"}`);
}
function recordContribution(run, value) {
  const { block, specification } = activeBlock(run);
  if (!block.contributions) throw new Error("Implementation contributions are available only for truthful-accounting blocks");
  const contribution = contributionInput(value);
  if (!contribution.scope.every((entry) => specification.scope.some((approved) => coversScope(approved, entry)))) throw new Error("Contribution scope must stay within the active block scope");
  const agent = run.agents.find((entry) => entry.id === contribution.actor);
  if (contribution.actor !== run.spec.principal && (!agent || agent.role !== "applier" || agent.block !== block.id || agent.status !== "finished" || !agent.result || !contribution.scope.every((entry) => agent.scope.some((assigned) => coversScope(assigned, entry))))) throw new Error("Applier contributions require that agent\u2019s explicit delivered completed assignment and assigned scope");
  if (contribution.actor === run.spec.principal && contribution.configuration) throw new Error("Principal model provenance requires observation --file; remove configuration from the contribution payload");
  const configuration = contribution.configuration ?? agent?.observedConfiguration ?? agent?.requestedConfiguration;
  if (contribution.configuration && agent?.requestedConfiguration && !sameModelConfiguration(contribution.configuration, agent.observedConfiguration ?? agent.requestedConfiguration)) throw new Error("Applier contribution configuration must match the native assignment");
  const recorded = { ...contribution, ...configuration ? { configuration } : {}, at: (/* @__PURE__ */ new Date()).toISOString() };
  if (block.contributions.some((entry) => entry.actor === recorded.actor && entry.evidence === recorded.evidence && JSON.stringify(entry.scope) === JSON.stringify(recorded.scope))) return;
  block.contributions.push(recorded);
  if (!block.writers.includes(recorded.actor)) block.writers.push(recorded.actor);
  const tier = configurationTier(configuration);
  if (tier && (!block.implementationTier || tierRank(tier) > tierRank(block.implementationTier))) block.implementationTier = tier;
  event(run, "contribution", recorded.actor);
}
function recordObservation(run, value) {
  const input = observationInput(value);
  if (!run.spec.coordination && !run.spec.reviewFallback) throw new Error("Observed model configuration requires a truthful-accounting adoption");
  if (input.actor !== run.spec.principal) {
    registerAgent(run, { id: input.actor, observation: input.observation });
    return;
  }
  requireAuthorization(run, "metadata");
  (run.principalObservations ??= []).push({ at: (/* @__PURE__ */ new Date()).toISOString(), configuration: input.observation });
  event(run, "principal-observation", run.spec.principal);
}
function finishAgent(run, id, report) {
  const agent = run.agents.find((entry) => entry.id === id);
  if (!agent) throw new Error("Unknown native agent handle");
  if (!report.trim()) throw new Error("Read the native result before marking delivery complete");
  if (agent.status === "finished" && agent.result === report) return;
  agent.status = "finished";
  agent.result = report;
  (agent.deliveries ??= []).push({ at: (/* @__PURE__ */ new Date()).toISOString(), report });
  event(run, "agent-result", id);
}
function recordReview(run, input, final = false) {
  requireAuthorization(run);
  if (!["plan", "roadmap"].includes(run.spec.mode)) final = false;
  const agent = run.agents.find((entry) => entry.id === input.agent);
  const block = final ? void 0 : activeBlock(run).block;
  const specification = final ? void 0 : activeBlock(run).specification;
  const writers = final ? run.blocks.flatMap((entry) => entry.writers) : block.writers;
  const implementationTier = final ? Math.max(...run.blocks.map((entry) => tierRank(entry.implementationTier ?? "luna"))) : tierRank(block.implementationTier ?? "luna");
  if (!agent || agent.role !== "reviewer" || agent.status !== "finished" || !agent.result || writers.includes(input.agent)) throw new Error("Review needs a delivered result from a registered independent native reviewer");
  const truthful = final ? run.blocks.some((entry) => Boolean(entry.contributions)) : Boolean(block.contributions);
  if (!truthful && (!agent.tier || tierRank(agent.tier) < implementationTier)) throw new Error("Reviewer tier must cover the implementation tier");
  const coverage = input.verdict === "pass" ? final ? finalCoverage(run, agent) : blockCoverage(run, block, agent, specification) : void 0;
  if (!final && agent.block !== block.id) throw new Error("Reviewer assignment belongs to another block");
  const expected = final ? ["rubric", "conformance"] : specification.criteria;
  if (input.verdict === "pass" && expected.some((criterion) => !input.criteria.includes(criterion))) throw new Error("Review is missing required criteria; recover substantive evidence without relaunching for formatting");
  const ids = final ? [...new Set(run.spec.blocks.flatMap((entry) => entry.checks))] : specification.checks;
  const cache = /* @__PURE__ */ new Map();
  const checks = ids.map((id2) => validCheck(run, id2, cache));
  if (input.verdict === "pass" && checks.some((check) => !check)) throw new Error("A required check is incomplete, stale or failed");
  const scope = final ? run.spec.blocks.flatMap((entry) => entry.scope) : specification.scope;
  if (run.blocks.some((entry) => entry.contributions?.some((contribution) => contribution.actor === input.agent && scopesOverlap(contribution.scope, scope)))) throw new Error("A reviewer cannot attest to a scope they implemented");
  if (!scope.every((requested) => agent.scope.some((assigned) => coversScope(assigned, requested)))) throw new Error("Reviewer assignment does not cover the required scope; obtain focused coverage before recording a pass");
  const id = (0, import_node_crypto4.randomUUID)();
  const directory = import_node_path12.default.join(stateDirectory(run.project), "reviews", run.spec.id);
  (0, import_node_fs12.mkdirSync)(directory, { recursive: true, mode: 448 });
  const report = import_node_path12.default.join(directory, `${id}.txt`);
  (0, import_node_fs12.writeFileSync)(report, agent.result, { mode: 384, flag: "wx" });
  const reviewFiles = snapshot(run.project, scope);
  const review = { ...input, id, ...agent.tier ? { tier: agent.tier } : {}, scopeDigest: digest(JSON.stringify(reviewFiles)), scopeModes: fileModes(run.project, reviewFiles), checkAttempts: checks.flatMap((check) => check ? [check.attempt] : []), report, reportDigest: digest(agent.result), ...coverage ? { coverage } : {} };
  (final ? run.finalReviews : block.reviews).push(review);
  if (input.verdict !== "pass" && run.activeBlock) recordFailure(run, input.verdict === "blocked" ? "delivery" : "product", `Reviewer ${input.agent}: ${input.verdict}; inspect ${report}`);
  event(run, "review", `${id}: ${input.verdict}`);
  return review;
}
function upsertFinding(run, finding) {
  const { block } = activeBlock(run);
  if (!finding.id?.trim() || !finding.rule?.trim() || !finding.evidence?.trim()) throw new Error("Finding needs id, rule and concrete code evidence");
  if (!["open", "fixed", "false-positive"].includes(finding.disposition)) throw new Error("No residual waiver exists for a real rubric violation");
  if (finding.disposition !== "open" && !finding.resolution?.trim()) throw new Error("Resolution needs a code fix or evidence disproving the claimed violation");
  const existing = block.findings.find((entry) => entry.id === finding.id);
  const resolved = existing?.disposition === "open" && finding.disposition !== "open";
  if (existing && existing.disposition !== "open" && finding.disposition === "open") revokeFindingProgress(run, finding.id);
  if (existing) Object.assign(existing, finding);
  else block.findings.push(finding);
  if (resolved) recordRecoveryProgress(run, { kind: "finding", id: finding.id });
  event(run, "finding", `${finding.id}: ${finding.disposition} ${finding.resolution ?? finding.evidence}`);
}
function closeBlock(run) {
  const { block, specification } = activeBlock(run);
  if (block.failure || block.status === "blocked") throw new Error(run.next);
  if (run.agents.some((agent) => agent.status !== "finished")) throw new Error("Reconcile outstanding native agents before closure");
  if (block.findings.some((finding) => finding.disposition === "open")) throw new Error("Unresolved rubric or conformance findings prevent closure");
  assertScope(run, block, specification);
  const review = currentBlockReview(run, block, specification);
  block.closedSnapshot = snapshot(run.project, specification.scope);
  block.closedModes = fileModes(run.project, block.closedSnapshot);
  block.closedDeletions = Object.keys(block.baseline ?? {}).filter((filename) => scopeMatches(filename, specification.scope) && block.closedSnapshot[filename] === void 0);
  block.status = "closed";
  delete block.externalFulfillment;
  delete run.activeBlock;
  run.next = run.blocks.some((entry) => entry.status !== "closed") ? "Activate the next approved block" : ["plan", "roadmap"].includes(run.spec.mode) ? "Perform cumulative independent debt/conformance review, then close" : "Close the run; the combined independent review is complete";
  event(run, "block-close", block.id);
  return review;
}
function currentBlockReview(run, block, specification) {
  const current = digest(JSON.stringify(snapshot(run.project, specification.scope)));
  const reviewedModes = fileModes(run.project, snapshot(run.project, specification.scope));
  const candidates = block.reviews.filter((entry) => entry.verdict === "pass" && entry.kind === (specification.review ?? "general") && specification.criteria.every((criterion) => entry.criteria.includes(criterion)) && entry.scopeDigest === current && digest((0, import_node_fs12.readFileSync)(entry.report)) === entry.reportDigest);
  const review = candidates.findLast((entry) => digest(JSON.stringify(entry.scopeModes)) === digest(JSON.stringify(reviewedModes)));
  if (!review) throw new Error("A current independent review with Git mode provenance is required before committing this block");
  const reviewer = run.agents.find((agent) => agent.id === review.agent);
  if (!reviewer) throw new Error("A current independent native reviewer is required before committing this block");
  blockCoverage(run, block, reviewer, specification);
  const cache = /* @__PURE__ */ new Map();
  for (const id of specification.checks) {
    const check = validCheck(run, id, cache);
    if (!check || !review.checkAttempts.includes(check.attempt)) throw new Error(`Check ${id} needs current executed evidence covered by the review`);
  }
  return review;
}
function closeRun(run) {
  requireAuthorization(run);
  if (["commit", "publication"].some((action) => familyBoundary(run, action)?.status === "open")) throw new Error("A required delivery action remains blocked; resolve its recorded boundary before closing");
  if (run.blocks.some((block) => block.status !== "closed")) throw new Error("Every approved block must be closed");
  if (run.agents.some((agent) => agent.status !== "finished")) throw new Error("Native agents still need reconciliation");
  for (const child of run.spec.children ?? []) {
    const record = readRun(run.project, child.id);
    if (record.status !== "closed" || !childSatisfiesRoadmap(run, child, record)) throw new Error(`Roadmap child remains incomplete: ${child.id}`);
  }
  const scope = run.spec.blocks.flatMap((block) => block.scope);
  const outside = ownershipChanges(run, run.baseline, run.baselineModes, run.baseHead).filter((filename) => !scopeMatches(filename, scope));
  if (outside.length) throw new Error(`Changes outside approved run scope need reconciliation: ${outside.join(", ")}`);
  const cache = /* @__PURE__ */ new Map();
  const checks = [...new Set(run.spec.blocks.flatMap((block) => block.checks))].map((id) => validCheck(run, id, cache));
  if (checks.some((check) => !check)) throw new Error("A required check is stale or incomplete");
  const current = digest(JSON.stringify(snapshot(run.project, scope)));
  if (run.spec.mode === "plan" || run.spec.mode === "roadmap") {
    const currentModes = fileModes(run.project, snapshot(run.project, scope));
    const final = run.finalReviews.findLast((review) => digest(JSON.stringify(review.scopeModes)) === digest(JSON.stringify(currentModes)) && review.verdict === "pass" && review.scopeDigest === current && checks.every((check) => review.checkAttempts.includes(check.attempt)) && digest((0, import_node_fs12.readFileSync)(review.report)) === review.reportDigest);
    if (!final) throw new Error("Cumulative independent debt and conformance review is required");
    const reviewer = run.agents.find((agent) => agent.id === final.agent);
    if (!reviewer) throw new Error("Cumulative independent review needs its registered native reviewer");
    finalCoverage(run, reviewer);
  } else {
    for (const block of run.blocks.filter((block2) => run.spec.blocks.some((specification) => specification.id === block2.id))) {
      const specification = run.spec.blocks.find((entry) => entry.id === block.id);
      if (digest(JSON.stringify(block.closedSnapshot)) !== digest(JSON.stringify(snapshot(run.project, specification.scope)))) throw new Error(`Code changed after review of ${block.id}`);
      if (!block.closedModes) throw new Error(`Closed checkpoint ${block.id} lacks Git mode provenance; reconcile with a focused current review`);
      const currentModes = fileModes(run.project, snapshot(run.project, specification.scope));
      if (digest(JSON.stringify(block.closedModes)) !== digest(JSON.stringify(currentModes))) throw new Error(`Git mode changed after review of ${block.id}`);
    }
  }
  run.status = "closed";
  run.next = "Complete. Report the result, verification and any deployment boundary.";
  event(run, "close", run.spec.objective);
  const parent = roadmapParentId(run);
  if (parent) selectRun(readRun(run.project, parent));
}
function scopesOverlap(left, right) {
  return left.some((pattern) => right.some((other) => scopeMatches(pattern, [other]) || scopeMatches(other, [pattern]) || pattern.includes("*") || other.includes("*")));
}
function coversScope(assigned, requested) {
  if (assigned === requested || assigned === "." || assigned === "**") return true;
  const directory = assigned.endsWith("/**") ? assigned.slice(0, -3) : assigned;
  if (!directory.includes("*") && !directory.includes("?")) return scopeMatches(requested, [directory]);
  return !requested.includes("*") && !requested.includes("?") && scopeMatches(requested, [assigned]);
}
function contributionInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Contribution must be an object");
  const input = value;
  if (Object.keys(input).some((key) => !["actor", "scope", "evidence", "configuration"].includes(key)) || typeof input.actor !== "string" || !input.actor.trim() || !Array.isArray(input.scope) || !input.scope.length || !input.scope.every((entry) => typeof entry === "string" && entry.trim()) || typeof input.evidence !== "string" || !input.evidence.trim()) throw new Error("Contribution requires actor, nonempty scope and explicit evidence");
  if (input.configuration !== void 0 && !validConfiguration(input.configuration)) throw new Error("Contribution configuration requires model and reasoningEffort");
  return { actor: input.actor, scope: input.scope, evidence: input.evidence, ...input.configuration ? { configuration: input.configuration } : {} };
}
function blockCoverage(run, block, reviewer, specification) {
  if (!block.contributions) return void 0;
  const configuration = reviewer.observedConfiguration ?? reviewer.requestedConfiguration;
  const legacyFallback = Boolean(block.unattributedWriters?.length);
  if (legacyFallback && (!run.spec.reviewFallback || !configurationCovers(configuration, run.spec.reviewFallback))) throw new Error("Legacy implementation authors have unknown configuration; the approved review fallback is required");
  if (!block.contributions.length) {
    if (legacyFallback) {
      return { ...reviewer.requestedConfiguration ? { requested: reviewer.requestedConfiguration } : {}, ...reviewer.observedConfiguration ? { observed: reviewer.observedConfiguration } : {}, fallback: run.spec.reviewFallback };
    }
    if (scopeChangedWithoutContribution(run, block, specification)) throw new Error("Truthful closure requires an actual implementation contribution");
    return { ...reviewer.requestedConfiguration ? { requested: reviewer.requestedConfiguration } : {}, ...reviewer.observedConfiguration ? { observed: reviewer.observedConfiguration } : {} };
  }
  let usesFallback = legacyFallback;
  for (const contribution of block.contributions) {
    const contributed = effectiveContributionConfiguration(run, block, contribution);
    if (contributed && configurationCovers(configuration, contributed)) continue;
    if (!configurationTier(contributed) && run.spec.reviewFallback && configurationCovers(configuration, run.spec.reviewFallback)) {
      usesFallback = true;
      continue;
    }
    throw new Error("Reviewer configuration does not cover the actual implementation; unknown principal work needs the approved review fallback");
  }
  return { ...reviewer.requestedConfiguration ? { requested: reviewer.requestedConfiguration } : {}, ...reviewer.observedConfiguration ? { observed: reviewer.observedConfiguration } : {}, ...usesFallback ? { fallback: run.spec.reviewFallback } : {} };
}
function effectiveContributionConfiguration(run, block, contribution) {
  if (contribution.actor === run.spec.principal) return run.principalObservations?.at(-1)?.configuration;
  const agent = run.agents.find((entry) => entry.id === contribution.actor);
  if (agent?.observedConfiguration || agent?.requestedConfiguration) return agent.observedConfiguration ?? agent.requestedConfiguration;
  return block.contributions.findLast((entry) => entry.actor === contribution.actor && entry.configuration)?.configuration;
}
function finalCoverage(run, reviewer) {
  const coverage = run.blocks.map((block) => blockCoverage(run, block, reviewer, run.spec.blocks.find((specification) => specification.id === block.id)));
  return coverage.some(Boolean) ? { ...reviewer.requestedConfiguration ? { requested: reviewer.requestedConfiguration } : {}, ...reviewer.observedConfiguration ? { observed: reviewer.observedConfiguration } : {}, ...coverage.some((entry) => entry?.fallback) ? { fallback: run.spec.reviewFallback } : {} } : void 0;
}
function scopeChangedWithoutContribution(run, block, specification) {
  const current = snapshot(run.project, specification.scope);
  const names = /* @__PURE__ */ new Set([...Object.keys(block.baseline ?? {}), ...Object.keys(current)]);
  return [...names].some((filename) => scopeMatches(filename, specification.scope) && block.baseline?.[filename] !== current[filename]);
}
function validConfiguration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const configuration = value;
  return Object.keys(configuration).every((key) => key === "model" || key === "reasoningEffort" || key === "forkTurns") && typeof configuration.model === "string" && Boolean(configuration.model.trim()) && typeof configuration.reasoningEffort === "string" && Boolean(configuration.reasoningEffort.trim()) && (configuration.forkTurns === void 0 || configuration.forkTurns === "none");
}
function validNativeConfiguration(value) {
  return validConfiguration(value) && value.forkTurns === "none";
}
function observationInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Observation must be an object");
  const input = value;
  if (Object.keys(input).some((key) => key !== "actor" && key !== "observation") || typeof input.actor !== "string" || !input.actor.trim() || !validConfiguration(input.observation)) throw new Error("Observation requires actor plus observed model and reasoningEffort");
  return { actor: input.actor, observation: input.observation };
}

// src/external-fulfillment.ts
function closeExternalBlock(run, value) {
  const input = fulfillmentInput(value);
  const block = run.blocks.find((entry) => entry.id === input.block);
  const specification = run.spec.blocks.find((entry) => entry.id === input.block);
  if (!block || !specification || input.targetSpecDigest !== run.specDigest || digest(JSON.stringify(run.spec)) !== run.specDigest) throw new Error("External fulfillment target block or specification is stale or unknown");
  const imported = run.externalContributions?.filter((entry) => entry.sourceRun === input.sourceRun && entry.sourceSpecDigest === input.sourceSpecDigest) ?? [];
  if (imported.length !== 1) throw new Error("External fulfillment requires one already imported source contribution");
  const contribution = imported[0];
  const source = fulfillmentSource(run, input.sourceRun);
  if (source.specDigest !== input.sourceSpecDigest || digest(JSON.stringify(source.spec)) !== source.specDigest || source.status !== "closed" || source.activeBlock || source.blocks.some((entry) => entry.status !== "closed")) throw new Error("External fulfillment source identity, specification or closed checkpoints no longer match");
  const checkpoints = input.sourceBlocks.map((id) => sourceCheckpoint(source, contribution, id));
  assertContributionCommits(run, contribution);
  assertCheckpointCoverage(run, specification, contribution, checkpoints);
  const provenance = { ...input, sourceProject: source.project, contributionDigest: digest(JSON.stringify(contribution)), sourceEvidenceDigest: digest(JSON.stringify(checkpoints)) };
  if (block.status === "closed") {
    const prior = block.externalFulfillment;
    if (!prior || !sameFulfillment(prior, provenance) || currentBlockReview(run, block, specification).id !== prior.acceptanceReviewId) throw new Error("External fulfillment conflicts with the closed checkpoint or its current acceptance evidence");
    return false;
  }
  if (run.activeBlock !== input.block || block.externalFulfillments?.some((entry) => sameMapping(entry, input))) throw new Error("External fulfillment requires the selected block and a mapping that has not been reopened");
  const candidate = structuredClone(run);
  const acceptance = closeBlock(candidate);
  const fulfilled = candidate.blocks.find((entry) => entry.id === input.block);
  const { block: selectedBlock, ...metadata } = provenance;
  const recorded = { ...metadata, acceptanceReviewId: acceptance.id, at: (/* @__PURE__ */ new Date()).toISOString() };
  fulfilled.externalFulfillment = recorded;
  (fulfilled.externalFulfillments ??= []).push(recorded);
  promoteRecoveryRecord(candidate, 4);
  event(candidate, "external-fulfillment", `${selectedBlock}: ${source.spec.id}/${input.sourceBlocks.join(",")}`);
  Object.assign(run, candidate);
  delete run.activeBlock;
  return true;
}
function fulfillmentInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("External fulfillment mapping must be an object");
  const input = value;
  const identifier5 = (entry) => typeof entry === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(entry);
  const hash4 = (entry) => typeof entry === "string" && /^[a-f0-9]{64}$/.test(entry);
  if (Object.keys(input).some((key) => !["block", "targetSpecDigest", "sourceRun", "sourceSpecDigest", "sourceBlocks", "evidence"].includes(key)) || !identifier5(input.block) || !identifier5(input.sourceRun) || !hash4(input.targetSpecDigest) || !hash4(input.sourceSpecDigest) || !Array.isArray(input.sourceBlocks) || !input.sourceBlocks.length || !input.sourceBlocks.every(identifier5) || new Set(input.sourceBlocks).size !== input.sourceBlocks.length || typeof input.evidence !== "string" || !input.evidence.trim()) throw new Error("External fulfillment mapping requires exact block, specification, source checkpoints and rationale");
  return { block: input.block, targetSpecDigest: input.targetSpecDigest, sourceRun: input.sourceRun, sourceSpecDigest: input.sourceSpecDigest, sourceBlocks: [...input.sourceBlocks], evidence: input.evidence };
}
function fulfillmentSource(run, id) {
  const isolated = run.isolatedSuccessors?.filter((entry) => entry.run === id) ?? [];
  const local = (0, import_node_fs13.existsSync)(import_node_path13.default.join(stateDirectory(run.project), "runs", `${id}.json`));
  if (isolated.length + Number(local) !== 1) throw new Error("External fulfillment source must resolve uniquely from the retained run links");
  const forward = isolated[0];
  if (forward && (forward.status !== "integrated" || run.integrationIntent?.sourceRun === id)) throw new Error("External fulfillment requires completed isolated integration");
  const source = readRun(forward?.project ?? run.project, id);
  if (source.link?.parkedRun !== run.spec.id) throw new Error("External fulfillment source is not the linked successor of this target");
  const cross = source.link.crossProject;
  if (forward ? !cross || cross.sourceProject !== run.project || cross.sourceRun !== run.spec.id || cross.integration !== "integrated" || cross.commonDirectory !== forward.commonDirectory || cross.parkHead !== forward.parkHead : Boolean(cross)) throw new Error("External fulfillment source links do not prove completed integration");
  return source;
}
function sourceCheckpoint(source, contribution, id) {
  const block = source.blocks.find((entry) => entry.id === id);
  const specification = source.spec.blocks.find((entry) => entry.id === id);
  if (!block || !specification || !contribution.reviewedCheckpoints.includes(id) || block.status !== "closed" || !block.closedSnapshot || !block.closedModes || !block.closedDeletions || block.failure || block.findings.some((entry) => entry.disposition === "open")) throw new Error(`External fulfillment source checkpoint ${id} lacks complete closed evidence`);
  const review = block.reviews.findLast((entry) => entry.verdict === "pass" && entry.kind === (specification.review ?? "general") && specification.criteria.every((criterion) => entry.criteria.includes(criterion)) && entry.scopeDigest === digest(JSON.stringify(block.closedSnapshot)) && digest(JSON.stringify(entry.scopeModes)) === digest(JSON.stringify(block.closedModes)) && entry.agent !== source.spec.principal && !block.writers.includes(entry.agent) && (block.contributions ? Boolean(entry.coverage) : Boolean(entry.tier && tierRank(entry.tier) >= tierRank(block.implementationTier ?? "luna"))));
  if (!review || digest((0, import_node_fs13.readFileSync)(review.report)) !== review.reportDigest) throw new Error(`External fulfillment source checkpoint ${id} needs an intact independent review`);
  const agent = source.agents.find((entry) => entry.id === review.agent);
  if (!agent || agent.role !== "reviewer" || agent.status !== "finished" || !agent.deliveries?.some((delivery) => digest(delivery.report) === review.reportDigest)) throw new Error(`External fulfillment source checkpoint ${id} lacks its delivered native review`);
  const history = relatedRuns(source).flatMap((record) => record.checks);
  const checks = specification.checks.map((checkId) => {
    const configured = source.spec.checks.find((check) => check.id === checkId);
    return configured && history.findLast((check) => check.id === checkId && check.status === "pass" && review.checkAttempts.includes(check.attempt) && JSON.stringify(check.command) === JSON.stringify(configured.command) && check.cwd === insideProject(source.project, configured.cwd ?? "."));
  });
  if (checks.some((check) => !check || !check.logDigest || digest((0, import_node_fs13.readFileSync)(check.log)) !== check.logDigest)) throw new Error(`External fulfillment source checkpoint ${id} has missing or altered check logs`);
  return { specification, block, review, checks };
}
function assertContributionCommits(run, contribution) {
  const before = contribution.before.head;
  const after = contribution.after.head;
  if (!before || !after || !/^[a-f0-9]{40,64}$/.test(before) || !/^[a-f0-9]{40,64}$/.test(after) || !contribution.commits.length) throw new Error("External fulfillment contribution lacks its committed before/after interval");
  if (captureCommand(["git", "merge-base", before, after], run.project).trim() !== before) throw new Error("External fulfillment contribution does not descend from its recorded before head");
  const commits = captureCommand(["git", "rev-list", "--reverse", `${before}..${after}`], run.project).trim().split(/\s+/).filter(Boolean);
  if (JSON.stringify(commits) !== JSON.stringify(contribution.commits)) throw new Error("External fulfillment contribution commit interval no longer matches its recorded commits");
  if (captureCommand(["git", "merge-base", after, "HEAD"], run.project).trim() !== after) throw new Error("External fulfillment contribution is not an ancestor of the current target HEAD");
}
function assertCheckpointCoverage(run, target, contribution, checkpoints) {
  const scopes = checkpoints.flatMap((entry) => entry.specification.scope);
  if (!target.scope.every((requested) => scopes.some((assigned) => coversScope(assigned, requested)))) throw new Error("External fulfillment source checkpoints do not cover the complete target scope");
  const current = checkoutState(run.project);
  const targetBlock = run.blocks.find((entry) => entry.id === target.id);
  const known = /* @__PURE__ */ new Set([...Object.keys(run.baseline), ...Object.keys(targetBlock.baseline ?? {}), ...Object.keys(current.files), ...Object.keys(contribution.before.files), ...Object.keys(contribution.after.files), ...checkpoints.flatMap((entry) => [...Object.keys(entry.block.closedSnapshot), ...entry.block.closedDeletions])]);
  const paths2 = [...known].filter((filename) => scopeMatches(filename, target.scope));
  if (!target.scope.every((pattern) => paths2.some((filename) => scopeMatches(filename, [pattern])))) throw new Error("External fulfillment needs explicit checkpoint evidence for every target scope");
  if (paths2.some((filename) => !checkpoints.some((entry) => scopeMatches(filename, entry.specification.scope) && matchesClosedCheckpoint(entry.block, filename, contribution.after) && matchesClosedCheckpoint(entry.block, filename, current)))) throw new Error("External fulfillment target files, Git modes or explicit deletions differ from the selected source checkpoints");
}
function sameFulfillment(prior, current) {
  return sameMapping(prior, current) && prior.sourceProject === current.sourceProject && prior.contributionDigest === current.contributionDigest && prior.sourceEvidenceDigest === current.sourceEvidenceDigest;
}
function sameMapping(prior, current) {
  return prior.targetSpecDigest === current.targetSpecDigest && prior.sourceRun === current.sourceRun && prior.sourceSpecDigest === current.sourceSpecDigest && JSON.stringify(prior.sourceBlocks) === JSON.stringify(current.sourceBlocks) && prior.evidence === current.evidence;
}

// src/memory.ts
var import_node_crypto5 = require("node:crypto");
var import_node_fs14 = require("node:fs");
var import_node_path14 = __toESM(require("node:path"), 1);
function pendingMemory(project, full = false) {
  return { position: memoryPosition(project), entries: readQueue(project).entries.map((entry) => {
    const { content, superseded, ...metadata } = entry;
    return { ...metadata, stale: !samePosition(entry.position, memoryPosition(project, entry.position.runId)), ...full ? { content, superseded } : {} };
  }) };
}
function queueMemory(project, value) {
  const draft = parseDraft(value);
  initializeStore(project);
  return transaction(project, () => {
    if (!samePosition(draft.position, memoryPosition(project, draft.position.runId))) throw new Error("Pending memory revision is stale; reconcile the current run and Engram observation before queueing its latest state");
    const queue = readQueue(project);
    const previous = queue.entries.find((entry2) => entry2.project === draft.project && entry2.topic === draft.topic);
    if (previous && previous.content === draft.content && previous.observationId === draft.observationId && samePosition(previous.position, draft.position)) return previous;
    if (previous && draft.previousId !== previous.id) throw new Error("Pending topic revision changed; read and merge its current entry before replacing it");
    const { previousId, ...current } = draft;
    const entry = { ...current, id: (0, import_node_crypto5.randomUUID)(), superseded: previous ? [...previous.superseded, { project: previous.project, topic: previous.topic, observationId: previous.observationId, content: previous.content, error: previous.error, position: previous.position }] : [] };
    queue.entries = queue.entries.filter((candidate) => candidate !== previous);
    queue.entries.push(entry);
    writeQueue(project, queue);
    return entry;
  });
}
function confirmMemoryDelivery(project, value) {
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" || !value.id.trim() || !("evidence" in value) || typeof value.evidence !== "string" || !value.evidence.trim()) throw new Error("Memory delivery requires the exact queued id and actual MCP acknowledgement evidence");
  return transaction(project, () => {
    const queue = readQueue(project);
    const delivered = queue.entries.find((entry) => entry.id === value.id);
    if (delivered && !samePosition(delivered.position, memoryPosition(project, delivered.position.runId))) throw new Error("Delivered memory revision is stale; retain the pending handoff and reconcile the current state");
    const remaining = queue.entries.filter((entry) => entry.id !== value.id);
    if (remaining.length === queue.entries.length) return { removed: false };
    writeQueue(project, { ...queue, entries: remaining });
    return { removed: true };
  });
}
function memoryPosition(project, runId) {
  if (!runId && !(0, import_node_fs14.existsSync)(import_node_path14.default.join(stateDirectory(project), "active"))) return { revision: 0 };
  const run = readRun(project, runId);
  return { runId: run.spec.id, revision: run.events.length, recoveryRevision: recoveryBudget(run).revision };
}
function samePosition(left, right) {
  return left.runId === right.runId && left.revision === right.revision && left.recoveryRevision === right.recoveryRevision;
}
function readQueue(project) {
  const filename = import_node_path14.default.join(stateDirectory(project), "memory-pending.json");
  if (!(0, import_node_fs14.existsSync)(filename)) return { version: 1, entries: [] };
  const queue = JSON.parse((0, import_node_fs14.readFileSync)(filename, "utf8"));
  if (queue.version !== 1 || !Array.isArray(queue.entries)) throw new Error("Unsupported memory queue; preserve it and reconcile its entries before changing format");
  for (const entry of queue.entries) {
    parseDraft(entry);
    if (!entry.id || !Array.isArray(entry.superseded)) throw new Error("Invalid memory queue entry; preserve its pending content");
  }
  return queue;
}
function writeQueue(project, queue) {
  atomicWrite(import_node_path14.default.join(stateDirectory(project), "memory-pending.json"), JSON.stringify(queue, null, 2) + "\n");
}
function parseDraft(value) {
  if (!value || typeof value !== "object") throw new Error("Memory draft must be an object");
  const draft = value;
  for (const key of ["project", "topic", "content", "error"]) if (typeof draft[key] !== "string" || !draft[key].trim()) throw new Error(`Memory draft requires ${key}`);
  if (draft.observationId !== void 0 && (!Number.isSafeInteger(draft.observationId) || draft.observationId <= 0)) throw new Error("Memory observation id must be a positive integer");
  if (!draft.position || !Number.isSafeInteger(draft.position.revision) || draft.position.revision < 0 || draft.position.runId !== void 0 && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(draft.position.runId)) throw new Error("Memory draft requires the observed run id and revision from memory pending");
  if (draft.position.recoveryRevision !== void 0 && !/^[a-f0-9]{64}$/.test(draft.position.recoveryRevision)) throw new Error("Memory recovery revision must match the observed recovery budget");
  return draft;
}

// src/roadmap.ts
function selectRoadmapChild(project, parentId, childId) {
  const initial = selection(project, parentId, childId);
  if (!initial.child) {
    requireDependencies(initial.parent, initial.specification, initial.children);
    startRun(project, initial.specification, { deferSelection: true, roadmapParent: initial.parent.spec.id });
  }
  return transaction(project, () => finalizeSelection(project, parentId, childId));
}
function finalizeSelection(project, parentId, childId) {
  const current = selection(project, parentId, childId);
  const { parent, specification, children, child } = current;
  for (const sibling of children.filter((entry) => entry.status === "running")) reconcile(sibling);
  const active = children.filter((entry) => ["running", "blocked"].includes(entry.status));
  if (active.some((entry) => entry.spec.id !== childId)) throw new Error(`Roadmap child ${active.map((entry) => entry.spec.id).join(", ")} remains active; reconcile its native handles instead of replacing the executor`);
  const parkedSiblings = children.filter((entry) => entry.status === "parked" && entry.spec.id !== childId);
  if (parkedSiblings.length && captureCommand(["git", "status", "--porcelain=v1"], project).trim()) throw new Error(`Parked roadmap child ${parkedSiblings.map((entry) => entry.spec.id).join(", ")} has partial work; use the isolated worktree route before selecting a sibling`);
  if (!child) throw new Error(`Child ${childId} was not durably created; preserve the current selector and reconcile the interrupted start`);
  assertChild(parent, specification, child);
  if (child.status === "closed") {
    selectRun(parent);
    return parent;
  }
  requireDependencies(parent, specification, children);
  if (child.status === "pending-approval") {
    authorize(child, { kind: "roadmap", parentRun: parent.spec.id, parentDigest: parent.specDigest, child: child.spec.id });
    activateBlock(child, child.blocks[0].id);
  } else if (child.status === "parked") {
    const completed = children.filter((entry) => entry.spec.id !== child.spec.id && entry.status === "closed" && entry.baseHead === child.parked?.checkout.head);
    if (completed.length && captureCommand(["git", "status", "--porcelain=v1"], project).trim()) throw new Error(`Parked roadmap child ${childId} needs the isolated worktree route before absorbing a reviewed sibling contribution`);
    for (const sibling of terminalContributions(completed)) recordReviewedContribution(child, sibling);
    resumeParkedRun(child);
  }
  for (const sibling of children.filter((entry) => entry.status === "running" && entry.spec.id !== child.spec.id)) writeRun(sibling);
  writeRun(child);
  selectRun(child);
  return child;
}
function selection(project, parentId, childId) {
  const parent = readRun(project, parentId);
  if (parent.spec.mode !== "roadmap" || !parent.approval || parent.status === "closed" || digest(JSON.stringify(parent.spec)) !== parent.specDigest) throw new Error("Select an approved unchanged unfinished roadmap parent before choosing a child");
  const specification = parent.spec.children?.find((child2) => child2.id === childId);
  if (!specification) throw new Error("Select an exact child id from the approved roadmap");
  const childIds = new Set(parent.spec.children?.map((child2) => child2.id) ?? []);
  const selected = readRun(project);
  if (selected.spec.id !== parent.spec.id && !childIds.has(selected.spec.id) && selected.status !== "closed") throw new Error(`Selected run ${selected.spec.id} is unrelated and remains active; --run cannot displace it`);
  const children = listRuns(project).filter((run) => childIds.has(run.spec.id));
  for (const record of children) assertChild(parent, parent.spec.children.find((entry) => entry.id === record.spec.id), record);
  const child = children.find((entry) => entry.spec.id === childId);
  return { parent, specification, children, child };
}
function assertChild(parent, specification, child) {
  const authority = { parentRun: parent.spec.id, parentDigest: parent.specDigest, child: child.spec.id };
  const originalDigest = digest(JSON.stringify(specification));
  const lineage = child.roadmapLineage;
  if (child.roadmapOrigin && !matchesRoadmapAuthority(child.roadmapOrigin, authority)) throw new Error("Existing child origin no longer matches the approved roadmap");
  if (lineage && (!hasValidRoadmapLineage(child) || lineage.baseline.parentRun !== authority.parentRun || lineage.baseline.parentDigest !== authority.parentDigest || lineage.baseline.child !== authority.child || lineage.baseline.originalSpecDigest !== originalDigest)) throw new Error("Existing child lineage no longer matches the approved roadmap");
  if (child.specDigest !== originalDigest && !lineage) throw new Error("Existing child no longer matches the approved roadmap; reconcile the material amendment");
  if (child.status === "pending-approval" && !matchesRoadmapAuthority(child.roadmapOrigin, authority)) throw new Error("Pending child lacks its exact durable roadmap origin; reconcile its original parent and baseline");
  if (child.status !== "pending-approval" && child.approval?.kind === "roadmap" && !matchesRoadmapAuthority(child.approval, authority)) throw new Error("Existing child authority no longer matches the approved roadmap");
  if (child.status !== "pending-approval" && child.approval?.kind === "user" && child.approval.specDigest !== child.specDigest) throw new Error("Existing child user authorization no longer matches its amended roadmap specification");
}
function requireDependencies(parent, specification, children) {
  for (const dependency of specification.dependsOn ?? []) {
    const record = children.find((child) => child.spec.id === dependency);
    const original = parent.spec.children?.find((child) => child.id === dependency);
    if (!record || !original || record.status !== "closed" || !childSatisfiesRoadmap(parent, original, record)) throw new Error(`Roadmap child dependency remains incomplete: ${dependency}`);
  }
}
function terminalContributions(children) {
  const embedded = new Set(children.flatMap((child) => child.externalContributions?.map((contribution) => contribution.sourceRun) ?? []));
  return children.filter((child) => !embedded.has(child.spec.id));
}

// src/cli.ts
async function main() {
  const { positionals, values } = (0, import_node_util.parseArgs)({ allowPositionals: true, options: {
    file: { type: "string" },
    authorization: { type: "string" },
    project: { type: "string" },
    run: { type: "string" },
    child: { type: "string" },
    block: { type: "string" },
    agent: { type: "string" },
    report: { type: "string" },
    verdict: { type: "string" },
    criteria: { type: "string" },
    tier: { type: "string" },
    kind: { type: "string" },
    cause: { type: "string" },
    evidence: { type: "string" },
    measured: { type: "string" },
    next: { type: "string" },
    all: { type: "boolean" },
    final: { type: "boolean" },
    escalated: { type: "boolean" },
    full: { type: "boolean" },
    help: { type: "boolean" },
    "all-criteria": { type: "boolean" },
    finish: { type: "boolean" },
    "stopped-check": { type: "string" },
    action: { type: "string" },
    resolved: { type: "boolean" },
    "completed-integration": { type: "string" },
    red: { type: "boolean" },
    retry: { type: "boolean" },
    "retry-permission": { type: "boolean" },
    reason: { type: "string" },
    transitions: { type: "boolean" },
    "from-run": { type: "string" },
    "from-project": { type: "string" }
  } });
  const command = positionals[0] ?? "help";
  if (command === "help" || values.help) {
    output(help);
    return;
  }
  if (command === "hook") {
    const decision = hookDecision(JSON.parse((0, import_node_fs15.readFileSync)(0, "utf8")));
    output(JSON.stringify(decision.allow ? {} : { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: decision.reason } }));
    return;
  }
  if (command === "diagnostic") {
    output(JSON.stringify({ node: process.version, codex: captureCommand(["codex", "--version"], process.cwd()).trim(), state: "project/.oso-code-codex (local, git-ignored)", models: "User-selected principal. Oso delegates substantial work with explicit Luna/max and scoped context. Terra/high and Astra/high require the evidence and conditions in references/execution.md#model-selection-and-escalation. Independent new work starts at Luna; review covers escalated implementation. This is instruction-led routing, not a runtime launch gate.", integrations: "Engram stores shared plans, decisions and progress through native MCP. Other integrations preserve their criteria with equivalent evidence. No permissions or model settings are modified." }, null, 2));
    return;
  }
  const project = projectRoot(values.project ?? process.cwd());
  if (command === "recovery") {
    const action = positionals[1];
    if (action === "status") {
      output(JSON.stringify(recoveryStatus(readRun(project, values.run)), null, 2));
      return;
    }
    if (action !== "authorize" && action !== "strategy" && action !== "adopt") throw new Error("Choose recovery status, recovery strategy --file -, recovery authorize --file - or recovery adopt --file -");
    transaction(project, () => {
      const selected = readRun(project);
      const run = values.run ? readRun(project, values.run) : selected;
      if (action === "strategy") {
        assertSelectedMutation(project, run, values.run);
        recordRecoveryStrategy(run, jsonFile(required2(values.file, "--file")));
        writeRun(run);
        output(JSON.stringify(recoveryStatus(run), null, 2));
        return;
      }
      if (run.spec.id !== selected.spec.id && recoveryBudget(selected).owner !== run.spec.id) throw new Error("Recovery authorization must target the selected run or its approved budget owner");
      if (action === "adopt") {
        const owner2 = adoptRecoveryPolicy(run, jsonFile(required2(values.file, "--file")));
        if (JSON.stringify(owner2) !== JSON.stringify(readRun(project, owner2.spec.id))) writeRun(owner2);
        output(JSON.stringify(recoveryStatus(readRun(project, run.spec.id)), null, 2));
        return;
      }
      const owner = authorizeRecovery(run, jsonFile(required2(values.file, "--file")));
      if (JSON.stringify(owner) !== JSON.stringify(readRun(project, owner.spec.id))) writeRun(owner);
      output(JSON.stringify(recoveryStatus(readRun(project, run.spec.id)), null, 2));
    });
    return;
  }
  if (command === "memory") {
    const action = positionals[1];
    if (!["pending", "queue", "delivered"].includes(action ?? "")) throw new Error("Choose memory pending, queue or delivered");
    const result = action === "pending" ? pendingMemory(project, values.full) : action === "queue" ? queueMemory(project, jsonFile(required2(values.file, "--file"))) : confirmMemoryDelivery(project, jsonFile(required2(values.file, "--file")));
    output(JSON.stringify(action === "queue" ? { ...result, content: void 0, superseded: void 0 } : result, null, 2));
    return;
  }
  if (command === "status" && values.transitions) {
    output(JSON.stringify(transitionStatus(project, values.run), null, 2));
    return;
  }
  if (command === "status" && !values.run && !(0, import_node_fs15.existsSync)(import_node_path15.default.join(stateDirectory(project), "active"))) {
    output(JSON.stringify({ status: "not-started", next: "Start the authorized task once with spec and authorization files." }));
    return;
  }
  if (command === "roadmap") {
    if (positionals[1] !== "reconcile") throw new Error("Choose roadmap reconcile --run PARENT --child CHILD");
    const child = reconcileRoadmapChild(project, required2(values.run, "--run"), required2(values.child, "--child"));
    printStatus(child, values.full);
    return;
  }
  if (command === "child") {
    const child = selectRoadmapChild(project, values.run, required2(positionals[1], "child id"));
    printStatus(child, values.full);
    return;
  }
  if (command === "start") {
    const specification = specificationFile(required2(values.file, "--file"));
    if (values["from-run"] && !values.authorization) throw new Error("A parked successor requires its own actual user authorization");
    if (values["from-project"] && !values["from-run"]) throw new Error("--from-project requires --from-run");
    const run = values["from-project"] ? startIsolatedRun(project, projectRoot(values["from-project"]), values["from-run"], specification) : values["from-run"] ? startFromParkedRun(project, readRun(project, values["from-run"]), specification) : startRun(project, specification);
    if (values.authorization) transaction(project, () => {
      authorize(run, approvalFile(values.authorization, run.specDigest));
      activateBlock(run, run.blocks[0].id);
      writeRun(run);
    });
    printStatus(run, values.full);
    return;
  }
  if (command === "integrate") {
    if (!values["from-run"] || !values["from-project"]) throw new Error("integrate requires --from-run and --from-project");
    const run = integrateIsolatedRun(project, projectRoot(values["from-project"]), values["from-run"]);
    printStatus(run, values.full);
    return;
  }
  if (command === "check") {
    const recovering = values.retry || values["retry-permission"];
    if (recovering && (values.all || values.red || values.retry && values["retry-permission"])) throw new Error("Choose one recovery for one check ID; recovery cannot use --all or --red");
    if (values["retry-permission"] && (values.measured || values.escalated)) throw new Error("Permission recovery uses native authorization evidence, not --measured or --escalated");
    if (!recovering && (values.evidence || values.measured || values.escalated)) throw new Error("Check recovery evidence requires --retry or --retry-permission");
    const recovery2 = values.retry ? { kind: "correction", evidence: required2(values.evidence, "--evidence"), measured: values.measured, escalated: values.escalated } : values["retry-permission"] ? { kind: "permission", evidence: required2(values.evidence, "--evidence") } : void 0;
    const ids = values.all ? activeBlock(readRun(project)).specification.checks : [required2(positionals[1], "check id or --all")];
    for (const id of ids) {
      const result = await executeCheck(project, id, values.red, recovery2);
      output(JSON.stringify(result.status === "pass" ? result : { ...result, next: readRun(project).next }));
      if (result.status !== "pass") {
        process.exitCode = 2;
        break;
      }
    }
    return;
  }
  if (command === "resume" && values["stopped-check"]) {
    const run = readRun(project, values.run);
    confirmStoppedCheck(run, values["stopped-check"], required2(values.evidence, "--evidence"));
    transaction(project, () => {
      writeRun(run);
      selectRun(run);
    });
    printStatus(run, values.full);
    return;
  }
  if (command === "resume") {
    transaction(project, () => {
      const run = readRun(project, values.run);
      if (run.status === "parked") resumeParkedRun(run);
      else {
        assertSelectedMutation(project, run, values.run);
        reconcile(run);
      }
      selectRun(run);
      writeRun(run);
      printStatus(run, values.full);
    });
    return;
  }
  transaction(project, () => {
    const run = readRun(project, values.run);
    if (command !== "status") assertSelectedMutation(project, run, values.run);
    if (!["plan", "roadmap"].includes(run.spec.mode)) values.final = false;
    switch (command) {
      case "status":
        printStatus(run, values.full);
        return;
      case "park":
        parkRun(run, required2(values.reason, "--reason"));
        break;
      case "authorize":
        authorize(run, approvalFile(required2(values.file, "--file"), run.specDigest));
        break;
      case "activate":
        activateBlock(run, required2(values.block ?? positionals[1], "block id"));
        break;
      case "reopen": {
        const id = required2(values.block, "--block");
        const block = run.blocks.find((entry) => entry.id === id);
        if (run.status === "closed" || !block || block.status !== "closed" || run.activeBlock) throw new Error("Reopen a closed block within an unfinished run; recovery budgets are preserved");
        block.status = "active";
        delete block.externalFulfillment;
        activateBlock(run, id);
        event(run, "reopen", id);
        break;
      }
      case "agent":
        registerAgent(run, jsonFile(required2(values.file, "--file")), values.final);
        break;
      case "delivered":
        finishAgent(run, required2(values.agent, "--agent"), textFile(required2(values.report, "--report")));
        break;
      case "contribution":
        recordContribution(run, jsonFile(required2(values.file, "--file")));
        break;
      case "observation":
        recordObservation(run, jsonFile(required2(values.file, "--file")));
        break;
      case "review": {
        const agent = required2(values.agent, "--agent");
        const verdict = required2(values.verdict, "--verdict");
        if (values.finish && verdict !== "pass") throw new Error("--finish requires a passing review; record findings or blockers without closure");
        const kind = values.kind ?? "general";
        if (!["pass", "findings", "blocked"].includes(verdict) || !["general", "security", "design"].includes(kind)) throw new Error("Invalid semantic review verdict or dimension");
        if (!run.agents.some((entry) => entry.id === agent)) {
          const truthful = values.final ? run.blocks.some((block) => block.contributions) : Boolean(activeBlock(run).block.contributions);
          if (truthful) throw new Error("Truthful reviews require a registered native reviewer configuration; use agent --file before review");
          registerAgent(run, { id: agent, role: "reviewer", tier: values.tier ?? "luna", scope: values.final ? run.spec.blocks.flatMap((block) => block.scope) : activeBlock(run).specification.scope }, values.final);
        }
        finishAgent(run, agent, textFile(required2(values.report, "--report")));
        const criteria = values["all-criteria"] ? values.final ? ["rubric", "conformance"] : activeBlock(run).specification.criteria : required2(values.criteria, "--criteria or --all-criteria").split(",");
        recordReview(run, { agent, verdict, kind, criteria }, values.final);
        if (values.finish) {
          if (values.final) closeRun(run);
          else {
            closeBlock(run);
            if (!["plan", "roadmap"].includes(run.spec.mode)) closeRun(run);
          }
        }
        break;
      }
      case "finding":
        upsertFinding(run, jsonFile(required2(values.file, "--file")));
        break;
      case "failure": {
        const kind = required2(values.kind, "--kind");
        if (!["product", "infrastructure", "delivery", "decision"].includes(kind)) throw new Error("Invalid failure kind");
        recordFailure(run, kind, required2(values.cause, "--cause"));
        break;
      }
      case "retry":
        retry(run, required2(values.evidence, "--evidence"), values.escalated ?? false, values.measured);
        break;
      case "checkpoint": {
        if (!values.file) closeBlock(run);
        else if (!closeExternalBlock(run, jsonFile(values.file))) {
          printStatus(run, values.full);
          return;
        }
        break;
      }
      case "close":
        closeRun(run);
        break;
      case "note":
        run.next = required2(values.next, "--next");
        event(run, "checkpoint-note", run.next);
        break;
      case "boundary": {
        const action = required2(values.action, "--action");
        if (!["commit", "publication"].includes(action)) throw new Error("Delivery boundary action must be commit or publication");
        if (values["completed-integration"]) {
          if (action !== "commit" || !values.resolved || values.escalated) throw new Error("--completed-integration requires boundary --action commit --resolved and cannot use --escalated");
          resolveCompletedIntegrationBoundary(run, values["completed-integration"], required2(values.evidence, "--evidence"));
        } else if (values.resolved) resolveBoundary(run, action, required2(values.evidence, "--evidence"), values.escalated ?? false);
        else blockBoundary(run, action, required2(values.cause, "--cause"));
        break;
      }
      case "import":
        importLegacy(run, required2(values.file, "--file"));
        break;
      case "adopt": {
        const document = jsonFile(required2(values.file, "--file"));
        adoptPreservedWork(run, document.files, approvalFile(required2(values.authorization, "--authorization"), run.specDigest));
        break;
      }
      case "amend": {
        const specification = specificationFile(required2(values.file, "--file"));
        if (specification.id !== run.spec.id || run.status === "closed" || !run.roadmapOrigin && run.blocks.some((block) => !specification.blocks.some((entry) => entry.id === block.id))) throw new Error("Amendments preserve run and block identities, findings and budgets");
        if (JSON.stringify(specification.recovery) !== JSON.stringify(run.spec.recovery)) throw new Error("Amendments preserve the recovery policy; use recovery authorize for a finite additional budget");
        const approval = approvalFile(required2(values.authorization, "--authorization"), digest(JSON.stringify(specification)));
        if (approval.kind !== "user" || approval.specDigest !== digest(JSON.stringify(specification)) || !approval.message?.trim() || !approval.reference?.trim()) throw new Error("Material amendments require actual user authorization for the new specification");
        const untouchedSelection = amendUntouchedSelection(run, specification);
        if (run.roadmapOrigin) applyRoadmapAmendment(run, readRun(project, run.roadmapOrigin.parentRun), specification, approval);
        else {
          event(run, "amend-from", JSON.stringify(run.spec));
          for (const block of specification.blocks) if (!run.blocks.some((entry) => entry.id === block.id)) run.blocks.push(newBlockState(block.id, specification));
          run.spec = specification;
          run.specDigest = approval.specDigest;
          run.approval = approval;
          if (specification.coordination || specification.reviewFallback) {
            run.version = 5;
            run.readerMinimumVersion = 5;
            retainLegacyWriterAttribution(run);
          }
        }
        if (untouchedSelection) run.next = "The former selection remains parked and untouched; resume, then activate the inserted prerequisite.";
        break;
      }
      default:
        throw new Error(`Unknown command: ${command}. Run oso-codex help.`);
    }
    writeRun(run);
    printStatus(run, values.full);
  });
}
var standardInput;
function textFile(filename) {
  if (filename !== "-") return (0, import_node_fs15.readFileSync)(filename, "utf8");
  return standardInput ??= (0, import_node_fs15.readFileSync)(0, "utf8");
}
function jsonFile(filename) {
  return JSON.parse(textFile(filename));
}
function specificationFile(filename) {
  const submitted = jsonFile(filename);
  return parseSpec(bindPrincipal(submitted.specification ?? submitted, process.env.CODEX_THREAD_ID ?? process.env.CODEX_SESSION_ID));
}
function bindPrincipal(specification, inherited) {
  const principal = specification.principal ?? inherited;
  return { ...specification, principal, ...Array.isArray(specification.children) ? { children: specification.children.map((child) => bindPrincipal(child, principal)) } : {} };
}
function approvalFile(filename, specDigest) {
  const document = jsonFile(filename);
  const submitted = document.authorization ?? document;
  return submitted.kind === "user" ? { ...submitted, specDigest: submitted.specDigest ?? specDigest } : submitted;
}
function required2(value, name) {
  if (!value?.trim()) throw new Error(`Missing ${name}; run oso-codex help`);
  return value;
}
function printStatus(run, full = false) {
  const cache = /* @__PURE__ */ new Map();
  const currentChecks = run.spec.checks.map((check) => {
    const evidence = validCheck(run, check.id, cache);
    const last = run.checks.findLast((result) => result.id === check.id);
    return { id: check.id, evidence, refreshReason: !evidence && last?.status === "pass" && !last.fingerprint.startsWith("v2:") ? "Historical fingerprint lacks executable/helper provenance. Refresh this required check once in its existing block; preserve the old evidence and budget." : void 0 };
  });
  output(JSON.stringify(full ? { ...run, currentChecks } : {
    id: run.spec.id,
    mode: run.spec.mode,
    status: run.status,
    specDigest: run.specDigest,
    activeBlock: run.activeBlock,
    blocks: run.blocks.map((block) => {
      const specification = run.spec.blocks.find((entry) => entry.id === block.id);
      const historicalCoverage = block.reviews.findLast((review) => review.verdict === "pass")?.coverage;
      const currentCoverage = block.status === "closed" ? { status: "closed" } : (() => {
        try {
          return { status: "satisfied", coverage: currentBlockReview(run, block, specification).coverage };
        } catch (error) {
          return { status: "pending", reason: error instanceof Error ? error.message : String(error) };
        }
      })();
      return { id: block.id, status: block.status, rounds: block.rounds.length, findings: block.findings.filter((finding) => finding.disposition === "open").length, accounting: block.contributions ? { contributions: block.contributions.length, writers: block.writers, historicalCoverage, currentCoverage } : { model: "legacy-unknown" } };
    }),
    modelAccounting: run.spec.coordination || run.spec.reviewFallback ? { requested: run.agents.map((agent) => ({ id: agent.id, configuration: agent.requestedConfiguration })), observed: [...(run.principalObservations ?? []).map((observation) => ({ id: run.spec.principal, configuration: observation.configuration })), ...run.agents.flatMap((agent) => agent.observations?.map((observation) => ({ id: agent.id, configuration: observation.configuration })) ?? [])], fallback: run.spec.reviewFallback } : { model: "legacy-unknown" },
    checks: currentChecks.map((check) => ({ id: check.id, valid: Boolean(check.evidence), last: check.evidence?.status ?? run.checks.findLast((result) => result.id === check.id)?.status, attempt: check.evidence?.attempt, log: check.evidence?.log, refreshReason: check.refreshReason })),
    next: run.next,
    boundaries: run.boundaries,
    recovery: recoveryStatus(run)
  }, null, 2));
}
var help = `oso-codex \u2014 local Codex execution evidence (no permission overrides)

start --file - [--authorization -] [--from-run ID] [--from-project PATH]
                                                    Start an isolated successor from a parked dirty checkout
child ID [--run PARENT]                               Start/resume the exact approved child with inherited authority
roadmap reconcile --run PARENT --child CHILD           Promote one approved additive legacy child lineage
authorize --file approval.json                        Record actual user or approved roadmap authorization
activate BLOCK | reopen --block BLOCK                 Select work; reopening preserves recovery budgets
check ID | check --all                                Execute affected checks; reuse valid evidence
check ID --retry --evidence TEXT [--measured TEXT] [--escalated]
                                                    Record correction and execute in one operation
check ID --retry-permission --evidence TEXT           One native-authorized retry per access episode
agent --file - [--final]                Record a live native child handle; never spawn recursively
delivered --agent ID --report -                       Reconcile actual native prose from stdin
contribution --file -                                 Record actual principal or delivered applier implementation
observation --file -                                  Append observed native or principal model evidence
review --agent ID --report - --verdict pass|findings|blocked --criteria rubric,conformance,...
       [--all-criteria instead of --criteria] [--finish] [--tier luna|terra|astra] [--kind general|security|design] [--final]
finding --file -                                      Preserve each finding and its evidenced resolution
failure --kind product|infrastructure|delivery|decision --cause TEXT
retry --evidence TEXT [--measured TEXT] [--escalated]   Record one repaired cycle within approved recovery authority
recovery status [--run ID]                            Inspect the approved shared correction budget without writes
recovery strategy --file -                           Record actual directed diagnosis and a changed recovery approach
recovery authorize --file -                          Record a finite actual user-authorized budget extension
recovery adopt --file -                              Adopt or revise an AUTO policy with actual user authorization
checkpoint | close                                   Compute closure prerequisites; no manual green flag
checkpoint --file -                                  Close selected A block with explicit imported B checkpoint provenance
park --reason TEXT                                    Retain selected approved evidence before separate work
integrate --from-run ID --from-project PATH            Fast-forward a reviewed isolated successor into the parked source
resume [--run ID] | status [--full|--transitions]      Reconcile or read parked lifecycle eligibility without writes
note --next TEXT                                     Persist the next concrete action
boundary --action commit|publication --cause TEXT    Preserve a required external delivery blocker across slices
boundary --action ACTION --resolved --evidence TEXT [--escalated]
boundary --action commit --resolved --completed-integration RUN --evidence TEXT
amend --file - --authorization -  Material changes keep existing block identities
import --file LEGACY                                  Record read-only provenance; never import a green flag
adopt --file - --authorization -                     Record authorized preserved file paths and SHA256 hashes
diagnostic                                           Show runtime and host capabilities
memory pending [--full] | memory queue --file -       Inspect or retain undelivered Engram state with its revision
memory delivered --file -                            Remove only the exact acknowledged queue entry

All project commands accept --project PATH. Records/logs live in .oso-code-codex/.
JSON --file - and --report - read stdin; existing file arguments remain supported.
import reads an existing legacy file as provenance only.
start --file - --authorization - accepts {"specification": {...}, "authorization": {...}}.
Schemas and examples: references/runtime.md. Reviews accept ordinary native prose.
`;
main().catch((error) => {
  (0, import_node_fs15.writeSync)(2, `oso-codex: ${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = 1;
});
function output(message) {
  (0, import_node_fs15.writeSync)(1, `${message}
`);
}
function assertSelectedMutation(project, run, supplied) {
  if (!supplied) return;
  const active = import_node_path15.default.join(stateDirectory(project), "active");
  if (!(0, import_node_fs15.existsSync)(active) || (0, import_node_fs15.readFileSync)(active, "utf8").trim() !== run.spec.id) throw new Error(`Run ${run.spec.id} is not selected; --run cannot mutate an unrelated run`);
}
