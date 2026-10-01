import { spawnSync } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function captureCommand(command: string[], cwd: string): string {
  return captureCommandBytes(command, cwd).toString('utf8');
}

/**
 * Runs a command whose stdout is an immutable Git object. Keeping the bytes
 * intact matters when provenance records contain a digest of a binary file.
 */
export function captureCommandBytes(command: string[], cwd: string): Buffer {
  const directory = mkdtempSync(path.join(tmpdir(), 'oso-code-codex-command-'));
  const stdoutPath = path.join(directory, 'stdout');
  const stderrPath = path.join(directory, 'stderr');
  const stdoutFile = openSync(stdoutPath, 'wx', 0o600);
  const stderrFile = openSync(stderrPath, 'wx', 0o600);
  try {
    const outcome = spawnSync(command[0]!, command.slice(1), { cwd, stdio: ['ignore', stdoutFile, stderrFile], timeout: 30_000 });
    const stdout = readFileSync(stdoutPath);
    const stderr = readFileSync(stderrPath, 'utf8');
    if (outcome.error || outcome.status !== 0) {
      const failure = outcome.error as NodeJS.ErrnoException | undefined;
      throw Object.assign(new Error(`${command[0]} failed: ${failure?.message ?? (outcome.signal ? `signal ${outcome.signal}` : `exit ${outcome.status}`)}\n${stderr}`, { cause: failure }), { status: outcome.status, signal: outcome.signal, code: failure?.code, stdout: stdout.toString('utf8'), stderr });
    }
    if (stderr) writeSync(2, stderr);
    return stdout;
  } finally {
    closeSync(stdoutFile);
    closeSync(stderrFile);
    rmSync(directory, { recursive: true });
  }
}
