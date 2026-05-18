import { describe, it, expect, vi } from 'vitest';
import { WpDbService, type IMysqlClient } from './wp-db.service';

const buildClient = (): IMysqlClient => ({
  execute: vi.fn(async () => undefined),
  query: vi.fn(async () => []),
  importDump: vi.fn(async () => undefined),
});

describe('WpDbService — happy path', () => {
  it('createDatabase issues idempotent CREATE', async () => {
    const m = buildClient();
    const svc = new WpDbService(m);
    await svc.createDatabase('wp_abc_com');
    expect(m.execute).toHaveBeenCalledTimes(1);
    const sql = (m.execute as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(sql).toContain('CREATE DATABASE IF NOT EXISTS `wp_abc_com`');
    expect(sql).toContain('utf8mb4');
  });

  it('createUser skips when user already exists', async () => {
    const m = buildClient();
    (m.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ count: 1 }]);
    const svc = new WpDbService(m);
    await svc.createUser('wp_abc_com', 's3cret');
    expect(m.execute).not.toHaveBeenCalled();
  });

  it('createUser issues CREATE USER when absent', async () => {
    const m = buildClient();
    (m.query as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ count: 0 }]);
    const svc = new WpDbService(m);
    await svc.createUser('wp_abc_com', 's3cret');
    expect(m.execute).toHaveBeenCalledWith(
      "CREATE USER ?@'localhost' IDENTIFIED BY ?",
      ['wp_abc_com', 's3cret'],
    );
  });

  it('grant runs GRANT + FLUSH', async () => {
    const m = buildClient();
    const svc = new WpDbService(m);
    await svc.grant('wp_abc_com', 'wp_abc_com');
    const calls = (m.execute as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toContain('GRANT ALL ON `wp_abc_com`.*');
    expect(calls[1]?.[0]).toBe('FLUSH PRIVILEGES');
  });

  it('importDump delegates to client', async () => {
    const m = buildClient();
    const svc = new WpDbService(m);
    await svc.importDump('wp_abc_com', '/tmp/dump.sql');
    expect(m.importDump).toHaveBeenCalledWith('wp_abc_com', '/tmp/dump.sql');
  });

  it('drop is idempotent', async () => {
    const m = buildClient();
    const svc = new WpDbService(m);
    await svc.dropDatabase('wp_abc_com');
    await svc.dropUser('wp_abc_com');
    const calls = (m.execute as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toContain('DROP DATABASE IF EXISTS `wp_abc_com`');
    expect(calls[1]?.[0]).toContain('DROP USER IF EXISTS');
  });
});

describe('WpDbService — identifier validation', () => {
  it.each(['wp; DROP TABLE x', 'wp_abc.com', '1bad', '', 'wp-abc', '../etc'])(
    'rejects bad database name: %s',
    async (n) => {
      const svc = new WpDbService(buildClient());
      await expect(svc.createDatabase(n)).rejects.toThrow(/invalid_database_name/);
    },
  );

  it('rejects database name > 64 chars', async () => {
    const svc = new WpDbService(buildClient());
    await expect(svc.createDatabase('a'.repeat(65))).rejects.toThrow();
  });
});
