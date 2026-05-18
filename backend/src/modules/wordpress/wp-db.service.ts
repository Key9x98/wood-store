export interface IMysqlClient {
  /** Execute a non-query statement. Driver may parameterize via `params`. */
  execute(sql: string, params?: unknown[]): Promise<void>;
  /** Execute a SELECT and return rows. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Stream a SQL dump file into the named database. */
  importDump(dbName: string, dumpPath: string): Promise<void>;
}

const IDENT_REGEX = /^[a-z][a-z0-9_]*$/i;

function assertSafeIdentifier(name: string, kind: 'database' | 'user'): void {
  if (!IDENT_REGEX.test(name) || name.length > 64) {
    throw new Error(`wp-db.invalid_${kind}_name: ${name}`);
  }
}

export class WpDbService {
  constructor(private readonly mysql: IMysqlClient) {}

  async createDatabase(dbName: string): Promise<void> {
    assertSafeIdentifier(dbName, 'database');
    await this.mysql.execute(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  }

  async dropDatabase(dbName: string): Promise<void> {
    assertSafeIdentifier(dbName, 'database');
    await this.mysql.execute(`DROP DATABASE IF EXISTS \`${dbName}\``);
  }

  async createUser(dbUser: string, password: string): Promise<void> {
    assertSafeIdentifier(dbUser, 'user');
    const rows = await this.mysql.query<{ count: number }>(
      'SELECT COUNT(*) AS count FROM mysql.user WHERE User = ? AND Host = ?',
      [dbUser, 'localhost'],
    );
    if ((rows[0]?.count ?? 0) > 0) return;
    await this.mysql.execute(`CREATE USER ?@'localhost' IDENTIFIED BY ?`, [dbUser, password]);
  }

  async dropUser(dbUser: string): Promise<void> {
    assertSafeIdentifier(dbUser, 'user');
    await this.mysql.execute(`DROP USER IF EXISTS ?@'localhost'`, [dbUser]);
  }

  async grant(dbName: string, dbUser: string): Promise<void> {
    assertSafeIdentifier(dbName, 'database');
    assertSafeIdentifier(dbUser, 'user');
    await this.mysql.execute(`GRANT ALL ON \`${dbName}\`.* TO ?@'localhost'`, [dbUser]);
    await this.mysql.execute('FLUSH PRIVILEGES');
  }

  async importDump(dbName: string, dumpPath: string): Promise<void> {
    assertSafeIdentifier(dbName, 'database');
    await this.mysql.importDump(dbName, dumpPath);
  }
}
