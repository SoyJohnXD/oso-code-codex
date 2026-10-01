import { accessSync, constants, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

type Executable = [string, string, string, string, string, string, string];
export type LookupCache = Map<string, Record<string, Executable>>;

export function executableIdentity(filename: string): Executable | null {
  try {
    const resolved = realpathSync(filename);
    const stat = statSync(resolved, { bigint: true });
    if (!stat.isFile()) return null;
    accessSync(filename, constants.X_OK);
    return [resolved, stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, stat.mode].map(String) as Executable;
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
}

export function executableLookup(cwd: string, cache: LookupCache): Record<string, Executable> {
  const searchPath = process.env.PATH ?? (process.platform === 'win32' ? '' : '/usr/bin:/bin');
  const key = JSON.stringify([cwd, searchPath]);
  const previous = cache.get(key);
  if (previous) return previous;
  const selected = new Map<string, Executable>();
  const visited = new Set<string>();
  for (const entry of searchPath.split(path.delimiter)) {
    let directory: string;
    let names: string[];
    try {
      directory = realpathSync(path.resolve(cwd, entry));
      if (visited.has(directory)) continue;
      visited.add(directory);
      names = readdirSync(directory);
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) continue;
      throw error;
    }
    for (const name of names) {
      if (selected.has(name)) continue;
      const identity = executableIdentity(path.join(directory, name));
      if (identity) selected.set(name, identity);
    }
  }
  const result = Object.fromEntries([...selected].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  cache.set(key, result);
  return result;
}
