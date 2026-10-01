import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { CheckSpec, Snapshot } from './types.ts';
import { captureCommand } from './command.ts';
import { executableIdentity, executableLookup, type LookupCache } from './environment.ts';

export function projectRoot(cwd: string): string {
  return realpathSync(captureCommand(['git', 'rev-parse', '--show-toplevel'], cwd).trim());
}

export function digest(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function gitFileMode(project: string, filename: string): string {
  const stat = lstatSync(path.join(project, filename));
  if (stat.isSymbolicLink()) return '120000';
  if (!stat.isFile()) throw new Error(`Not a Git source file: ${filename}`);
  return stat.mode & 0o100 ? '100755' : '100644';
}

export function fileModes(project: string, files: Snapshot): Snapshot {
  return Object.fromEntries(Object.keys(files).map(filename => [filename, gitFileMode(project, filename)]));
}

export function scopeMatches(filename: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    if (pattern === '.' || pattern === '**') return true;
    if (!pattern.includes('*') && !pattern.includes('?')) return filename === pattern || filename.startsWith(`${pattern.replace(/\/$/, '')}/`);
    const expression = pattern.match(/\*\*\/|\*\*|\*|\?|[^*?]+/g)!.map(part => part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part === '?' ? '[^/]' : part.replace(/[.+^${}()|[\]\\]/g, '\\$&')).join('');
    return new RegExp(`^${expression}$`).test(filename);
  });
}

export function snapshot(project: string, scope: string[] = ['.'], includeIgnored = false): Snapshot {
  if (includeIgnored) assertCheckInputs(scope);
  const names = captureCommand(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], project);
  const result: Snapshot = {};
  const candidates = includeIgnored ? [...names.split('\0'), ...declaredInputs(project, scope)] : names.split('\0');
  for (const name of [...new Set(candidates.filter(Boolean))].sort()) {
    if (name.startsWith('.oso-code-codex/') && !(includeIgnored && explicitInternalInput(name, scope)) || !scopeMatches(name, scope)) continue;
    const filename = path.join(project, name);
    try {
      const stat = lstatSync(filename);
      if (stat.isSymbolicLink()) {
        const target = realpathSync(filename);
        if (includeIgnored && target !== project && !target.startsWith(`${project}${path.sep}`)) throw new Error(`Check input ${name} links outside this project; declare reproducible local inputs`);
        if (includeIgnored && lstatSync(target).isDirectory()) throw new Error(`Check input ${name} is a directory symlink; declare its local target as an input`);
        result[name] = digest(`link:${readlinkSync(filename)}:${includeIgnored && lstatSync(target).isFile() ? digest(readFileSync(target)) : ''}`);
      }
      else if (stat.isFile()) result[name] = digest(readFileSync(filename));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return result;
}

export function changedFiles(before: Snapshot, after: Snapshot): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(name => before[name] !== after[name]);
}

export function checkFingerprint(project: string, check: CheckSpec, cache: LookupCache = new Map()): string {
  assertCheckInputs(check.inputs);
  const cwd = insideProject(project, check.cwd ?? '.');
  const lookup = executableLookup(cwd, cache);
  const environment = Object.fromEntries([...new Set(['NODE_OPTIONS', ...(check.envKeys ?? [])])].filter(key => key !== 'PATH').sort().map(key => [key, process.env[key] ?? null]));
  const executable = check.command[0]!;
  const entrypoint = executable.includes('/') || executable.includes('\\') ? executableIdentity(path.resolve(cwd, executable)) : lookup[executable] ?? null;
  return `v2:${digest(JSON.stringify({ check, files: snapshot(project, check.inputs, true), environment, lookup, entrypoint,
    literalPath: check.pathMode === 'literal' || process.platform === 'win32' ? process.env.PATH ?? null : undefined,
    runtime: [process.version, process.platform, process.arch] }))}`;
}

export function insideProject(project: string, relative: string): string {
  const resolved = realpathSync(path.resolve(project, relative));
  if (resolved !== project && !resolved.startsWith(`${project}${path.sep}`)) throw new Error(`Path is outside this project: ${relative}`);
  return resolved;
}

function declaredInputs(project: string, scope: string[]): string[] {
  const files = new Set<string>();
  for (const pattern of scope) {
    const wildcard = pattern.search(/[*?]/);
    const prefix = wildcard === -1 ? pattern : pattern.slice(0, wildcard);
    const relative = wildcard === -1 ? prefix : prefix.endsWith('/') ? prefix : path.posix.dirname(prefix);
    const root = path.join(project, relative || '.');
    if (!existsSync(root)) continue;
    const pending = [root];
    while (pending.length) {
      const filename = pending.pop()!;
      const name = path.relative(project, filename).split(path.sep).join('/');
      if (name === '.git' || name.startsWith('.git/') || (name === '.oso-code-codex' || name.startsWith('.oso-code-codex/')) && !explicitInternalInput(name, scope)) continue;
      const stat = lstatSync(filename);
      if (stat.isDirectory()) pending.push(...readdirSync(filename).map(child => path.join(filename, child)));
      else files.add(name);
    }
  }
  return [...files];
}

function explicitInternalInput(name: string, scope: string[]): boolean {
  return !isRuntimeRecord(name) && scope.some(pattern => pattern.startsWith('.oso-code-codex/') && !pattern.includes('*') && !pattern.includes('?') && pattern === name);
}

export function assertCheckInputs(inputs: string[]): void {
  const runtimeInput = inputs.find(isRuntimeRecord);
  if (runtimeInput) throw new Error(`Runtime records cannot be check inputs: ${runtimeInput}. Declare source/configuration helpers instead`);
}

function isRuntimeRecord(filename: string): boolean {
  const [directory, entry] = path.posix.normalize(filename).split('/');
  return directory === '.oso-code-codex' && ['runs', 'logs', 'reviews', 'locks', 'active', 'transaction.lock', 'memory-pending.json'].includes(entry ?? '');
}
