import { describe, it, expect, vi } from 'vitest';
import { WpCliService, type ShellRunner } from './wp-cli.service';

const buildRunner = (): ShellRunner =>
  vi.fn(async () => ({ stdout: '', stderr: '' })) as unknown as ShellRunner;

describe('WpCliService', () => {
  it('activateTheme runs `wp theme activate <slug>` with --path', async () => {
    const runShell = buildRunner();
    const svc = new WpCliService({ runShell });
    await svc.activateTheme('/var/www/html/sites/abc.com', 'restaurant-theme');
    expect(runShell).toHaveBeenCalledWith('wp', [
      '--path=/var/www/html/sites/abc.com',
      'theme',
      'activate',
      'restaurant-theme',
    ]);
  });

  it('uses sudo -u <wpUser> when configured', async () => {
    const runShell = buildRunner();
    const svc = new WpCliService({ runShell, wpUser: 'www-data' });
    await svc.activatePlugin('/var/www/html/sites/abc.com', 'ai-builder-plugin');
    expect(runShell).toHaveBeenCalledWith('sudo', [
      '-u',
      'www-data',
      'wp',
      '--path=/var/www/html/sites/abc.com',
      'plugin',
      'activate',
      'ai-builder-plugin',
    ]);
  });

  it('flushRewrite runs `wp rewrite flush`', async () => {
    const runShell = buildRunner();
    const svc = new WpCliService({ runShell });
    await svc.flushRewrite('/x');
    const call = (runShell as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call?.[1]).toEqual(['--path=/x', 'rewrite', 'flush']);
  });
});
