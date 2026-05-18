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
}
