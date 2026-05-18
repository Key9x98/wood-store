import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { SourceService } from './source.service';

const testRoot = path.join(os.tmpdir(), `cms-test-source-${Date.now()}-${process.pid}`);
const sitesRoot = path.join(testRoot, 'sites');
const wpCoreDir = path.join(testRoot, 'wp-core');
const themeDir = path.join(testRoot, 'tpl-theme');

beforeAll(async () => {
  await fs.mkdir(sitesRoot, { recursive: true });
  await fs.mkdir(path.join(wpCoreDir, 'wp-content', 'themes'), { recursive: true });
  await fs.writeFile(path.join(wpCoreDir, 'index.php'), '<?php echo "wp";');
  await fs.mkdir(themeDir, { recursive: true });
  await fs.writeFile(path.join(themeDir, 'style.css'), '/* theme */');
});

afterAll(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

describe('SourceService.materializeSite', () => {
  it('copies WP core into siteRoot', async () => {
    const svc = new SourceService({ sitesRoot, wpCoreDir });
    const siteRoot = path.join(sitesRoot, 'a.example.com');
    await svc.materializeSite(siteRoot);
    const idx = await fs.readFile(path.join(siteRoot, 'index.php'), 'utf8');
    expect(idx).toContain('wp');
  });

  it('overlays theme into wp-content/themes/<slug>', async () => {
    const svc = new SourceService({ sitesRoot, wpCoreDir });
    const siteRoot = path.join(sitesRoot, 'theme.example.com');
    await svc.materializeSite(siteRoot, { srcDir: themeDir, slug: 'furniture-basic' });
    const css = await fs.readFile(
      path.join(siteRoot, 'wp-content', 'themes', 'furniture-basic', 'style.css'),
      'utf8',
    );
    expect(css).toContain('theme');
  });

  it('is idempotent — second call skips when target populated', async () => {
    const svc = new SourceService({ sitesRoot, wpCoreDir });
    const siteRoot = path.join(sitesRoot, 'b.example.com');
    await svc.materializeSite(siteRoot);
    await svc.materializeSite(siteRoot);
    const idx = await fs.readFile(path.join(siteRoot, 'index.php'), 'utf8');
    expect(idx).toContain('wp');
  });

  it('throws when WP core dir is missing', async () => {
    const svc = new SourceService({ sitesRoot, wpCoreDir: path.join(testRoot, 'nope') });
    await expect(
      svc.materializeSite(path.join(sitesRoot, 'd.example.com')),
    ).rejects.toThrow(/wp_core_missing/);
  });

  it('rejects path traversal outside sitesRoot', async () => {
    const svc = new SourceService({ sitesRoot, wpCoreDir });
    await expect(svc.materializeSite('/etc/passwd')).rejects.toThrow(/unsafe_path/);
    await expect(svc.removeSite('/etc')).rejects.toThrow(/unsafe_path/);
    await expect(svc.removeSite(path.join(sitesRoot, '..', '..', 'etc'))).rejects.toThrow(
      /unsafe_path/,
    );
  });

  it('rejects an unsafe theme slug', async () => {
    const svc = new SourceService({ sitesRoot, wpCoreDir });
    await expect(
      svc.materializeSite(path.join(sitesRoot, 'e.example.com'), {
        srcDir: themeDir,
        slug: '../evil',
      }),
    ).rejects.toThrow(/invalid_theme_slug/);
  });

  it('removeSite removes folder', async () => {
    const svc = new SourceService({ sitesRoot, wpCoreDir });
    const siteRoot = path.join(sitesRoot, 'c.example.com');
    await svc.materializeSite(siteRoot);
    await svc.removeSite(siteRoot);
    await expect(fs.access(siteRoot)).rejects.toThrow();
  });
});
