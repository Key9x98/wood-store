export type ShellRunner = (
  cmd: string,
  args: string[],
  opts?: { timeout?: number; cwd?: string },
) => Promise<{ stdout: string; stderr: string }>;

export interface WpCliServiceOpts {
  runShell: ShellRunner;
  /** Run as this OS user via sudo (production: 'www-data'). Omit to run as current user. */
  wpUser?: string;
  /** wp binary path; default 'wp'. */
  wpBinary?: string;
}

export class WpCliService {
  constructor(private readonly opts: WpCliServiceOpts) {}

  private wpCommand(siteRoot: string, args: string[]): { cmd: string; argv: string[] } {
    const wp = this.opts.wpBinary ?? 'wp';
    const wpArgs = [`--path=${siteRoot}`, ...args];
    if (this.opts.wpUser) {
      return { cmd: 'sudo', argv: ['-u', this.opts.wpUser, wp, ...wpArgs] };
    }
    return { cmd: wp, argv: wpArgs };
  }

  async activateTheme(siteRoot: string, themeSlug: string): Promise<void> {
    const { cmd, argv } = this.wpCommand(siteRoot, ['theme', 'activate', themeSlug]);
    await this.opts.runShell(cmd, argv);
  }

  async activatePlugin(siteRoot: string, pluginSlug: string): Promise<void> {
    const { cmd, argv } = this.wpCommand(siteRoot, ['plugin', 'activate', pluginSlug]);
    await this.opts.runShell(cmd, argv);
  }

  async flushRewrite(siteRoot: string): Promise<void> {
    const { cmd, argv } = this.wpCommand(siteRoot, ['rewrite', 'flush']);
    await this.opts.runShell(cmd, argv);
  }

  async setOption(siteRoot: string, key: string, value: string): Promise<void> {
    const { cmd, argv } = this.wpCommand(siteRoot, ['option', 'update', key, value]);
    await this.opts.runShell(cmd, argv);
  }

  /**
   * Trả `true` nếu site đã chạy `wp core install` xong (wp_options đã có dữ
   * liệu). `wp core is-installed` exit code 0 nghĩa installed; non-zero nghĩa
   * chưa (runShell throws) — bắt qua try/catch.
   */
  async isCoreInstalled(siteRoot: string): Promise<boolean> {
    const { cmd, argv } = this.wpCommand(siteRoot, ['core', 'is-installed']);
    try {
      await this.opts.runShell(cmd, argv);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Chạy `wp core install` để populate wp_options / wp_users / wp_usermeta etc.
   * Caller phải đảm bảo step F (wp-config.php) đã chạy + DB credentials hợp lệ.
   * `--skip-email` ngăn WP gửi mail welcome ra admin_email.
   */
  async coreInstall(
    siteRoot: string,
    opts: {
      url: string;
      title: string;
      adminUser: string;
      adminPassword: string;
      adminEmail: string;
    },
  ): Promise<void> {
    const { cmd, argv } = this.wpCommand(siteRoot, [
      'core',
      'install',
      `--url=${opts.url}`,
      `--title=${opts.title}`,
      `--admin_user=${opts.adminUser}`,
      `--admin_password=${opts.adminPassword}`,
      `--admin_email=${opts.adminEmail}`,
      '--skip-email',
    ]);
    await this.opts.runShell(cmd, argv);
  }
}
