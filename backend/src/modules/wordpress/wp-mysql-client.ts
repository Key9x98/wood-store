import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createPool, type Pool } from 'mysql2/promise';
import type { IMysqlClient } from './wp-db.service';

export interface WpMysqlClientOpts {
  host: string;
  port: number;
  user: string;
  password: string;
}

/**
 * Real {@link IMysqlClient} backed by a privileged MySQL account. Used to
 * create per-site WordPress databases/users. `importDump` shells out to the
 * `mysql` CLI because a full `wp db export` dump is not safe to run through a
 * single multi-statement query.
 */
export class WpMysqlClient implements IMysqlClient {
  private readonly pool: Pool;

  constructor(private readonly opts: WpMysqlClientOpts) {
    this.pool = createPool({
      host: opts.host,
      port: opts.port,
      user: opts.user,
      password: opts.password,
      connectionLimit: 4,
      multipleStatements: false,
      charset: 'utf8mb4',
    });
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.pool.query(sql, params);
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const [rows] = await this.pool.query(sql, params);
    return rows as unknown as T[];
  }

  async importDump(dbName: string, dumpPath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'mysql',
        [
          `--host=${this.opts.host}`,
          `--port=${this.opts.port}`,
          `--user=${this.opts.user}`,
          '--protocol=TCP',
          '--default-character-set=utf8mb4',
          dbName,
        ],
        {
          env: { ...process.env, MYSQL_PWD: this.opts.password },
          stdio: ['pipe', 'ignore', 'pipe'],
        },
      );
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`mysql import failed (exit ${code}): ${stderr.trim()}`));
      });
      const stream = createReadStream(dumpPath);
      stream.on('error', reject);
      stream.pipe(child.stdin!);
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
