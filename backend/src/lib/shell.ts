import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pExecFile = promisify(execFile);

export interface RunOptions {
  timeout?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/**
 * Safe shell exec. Always uses execFile (args array) — never a shell string.
 * Callers MUST validate any user-derived value (domain, dbName, slug) before passing it in args.
 */
export async function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const res = await pExecFile(cmd, args, {
    timeout: opts.timeout ?? 60_000,
    cwd: opts.cwd,
    env: opts.env,
    maxBuffer: opts.maxBuffer ?? 10 * 1024 * 1024,
  });
  return { stdout: res.stdout.toString(), stderr: res.stderr.toString() };
}
