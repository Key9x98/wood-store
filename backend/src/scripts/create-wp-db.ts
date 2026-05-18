/**
 * CLI: tạo database + user WordPress cho một domain, rồi (tuỳ chọn) import dump.
 *
 *   npm run wp-db:create -- --domain abc.com [--dump /path/to/dump.sql]
 *
 * Dùng tài khoản MySQL đặc quyền cấu hình qua PROVISION_DB_* trong .env.
 * In ra credentials để tự điền vào wp-config.php.
 */
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
import { env } from '../config/env';
import { DomainSchema } from '../modules/sites/sites.schema';
import { dbNameFromDomain } from '../modules/provision/domain.util';
import { WpDbService } from '../modules/wordpress/wp-db.service';
import { WpMysqlClient } from '../modules/wordpress/wp-mysql-client';

function fail(msg: string): never {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      domain: { type: 'string' },
      dump: { type: 'string' },
    },
  });

  if (!values.domain) {
    fail('Thiếu --domain. Ví dụ: npm run wp-db:create -- --domain abc.com --dump dump.sql');
  }
  const domainCheck = DomainSchema.safeParse(values.domain);
  if (!domainCheck.success) {
    fail(`Domain không hợp lệ: ${values.domain}`);
  }
  const domain = domainCheck.data;

  if (!env.PROVISION_DB_ADMIN_USER) {
    fail('Chưa cấu hình PROVISION_DB_ADMIN_USER trong .env (xem hướng dẫn tạo cms_provisioner).');
  }

  const dumpPath = values.dump;
  if (dumpPath) {
    try {
      await access(dumpPath);
    } catch {
      fail(`Không tìm thấy file dump: ${dumpPath}`);
    }
  }

  const dbName = dbNameFromDomain(domain);
  const dbUser = dbName;
  const dbPassword = randomBytes(18).toString('base64url');

  const client = new WpMysqlClient({
    host: env.PROVISION_DB_HOST,
    port: env.PROVISION_DB_PORT,
    user: env.PROVISION_DB_ADMIN_USER,
    password: env.PROVISION_DB_ADMIN_PASSWORD,
  });
  const wpDb = new WpDbService(client);

  try {
    console.log(`→ Tạo database \`${dbName}\` ...`);
    await wpDb.createDatabase(dbName);

    console.log(`→ Tạo user \`${dbUser}\`@'localhost' ...`);
    await wpDb.createUser(dbUser, dbPassword);

    console.log(`→ Grant quyền trên \`${dbName}\` cho \`${dbUser}\` ...`);
    await wpDb.grant(dbName, dbUser);

    if (dumpPath) {
      console.log(`→ Import dump ${dumpPath} ...`);
      await wpDb.importDump(dbName, dumpPath);
    }
  } catch (e) {
    fail(`Thất bại: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await client.close();
  }

  console.log('\n✔ Xong. Điền vào wp-config.php của site:\n');
  console.log(`  define( 'DB_NAME', '${dbName}' );`);
  console.log(`  define( 'DB_USER', '${dbUser}' );`);
  console.log(`  define( 'DB_PASSWORD', '${dbPassword}' );`);
  console.log(`  define( 'DB_HOST', 'localhost' );`);
  if (dumpPath) {
    console.log(
      `\n  Dump có placeholder {{SITE_URL}} thì sau khi trỏ WP vào DB, chạy:\n` +
        `  wp search-replace '{{SITE_URL}}' 'https://${domain}' --all-tables`,
    );
  }
}

main().catch((e) => {
  fail(e instanceof Error ? e.message : String(e));
});
