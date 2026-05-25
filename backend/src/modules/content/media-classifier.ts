/**
 * Classify a source URL the user pasted into `imagesText` as a YouTube embed,
 * an uploadable video file, or an image (the default).
 *
 * Why this split matters in the sync flow:
 * - **image / video**  → sideloaded via `POST /media/upload`. The plugin's
 *   `MediaImporter::sideloadFromUrl` sniffs MIME from the downloaded file and
 *   allows both image and video types, so the same call site handles both.
 * - **youtube**        → cannot be sideloaded (it's an embeddable iframe, not
 *   a file). The 11-char video id is collected separately and shipped via
 *   `youtube_ids[]` so the plugin writes `_fb_youtube_ids` post-meta; the
 *   theme reads that meta and renders an `<iframe>` slide.
 *
 * Featured image policy: the worker that consumes this picks `featured_image_id`
 * from the first IMAGE only — never a video attachment — so product cards keep
 * a usable thumbnail even if the user pastes a video as the first URL.
 */
export type MediaKind =
  | { kind: 'youtube'; videoId: string }
  | { kind: 'video' }
  | { kind: 'image' };

/** File extensions WP can ingest as video; matched against the URL path only. */
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv|ogg)(?:$|[?#])/i;

/** YouTube video ids are always exactly 11 chars from this alphabet. */
const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function classifyMediaUrl(rawUrl: string): MediaKind {
  const trimmed = rawUrl.trim();

  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    // Not a parseable URL — let upstream zod URL validation reject it; we
    // default to 'image' so the caller's existing failure path runs.
    return { kind: 'image' };
  }

  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtube.com' || host === 'youtu.be') {
    const id = extractYouTubeId(host, u);
    if (id) return { kind: 'youtube', videoId: id };
  }

  if (VIDEO_EXT.test(u.pathname)) return { kind: 'video' };
  return { kind: 'image' };
}

function extractYouTubeId(host: string, u: URL): string | null {
  // youtu.be/<id>
  if (host === 'youtu.be') {
    const m = u.pathname.match(/^\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/);
    return m?.[1] ?? null;
  }
  // youtube.com/watch?v=<id>
  if (u.pathname === '/watch') {
    const v = u.searchParams.get('v') ?? '';
    return YT_ID.test(v) ? v : null;
  }
  // youtube.com/{embed,shorts,v,live}/<id>
  const m = u.pathname.match(/^\/(?:embed|shorts|v|live)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/);
  return m?.[1] ?? null;
}
