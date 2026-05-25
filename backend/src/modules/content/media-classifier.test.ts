import { describe, it, expect } from 'vitest';
import { classifyMediaUrl } from './media-classifier';

describe('classifyMediaUrl — YouTube', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?si=share&v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=share', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/v/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('%s → id %s', (url, id) => {
    const r = classifyMediaUrl(url);
    expect(r.kind).toBe('youtube');
    if (r.kind === 'youtube') expect(r.videoId).toBe(id);
  });

  it('rejects short ids (not 11 chars)', () => {
    expect(classifyMediaUrl('https://youtu.be/short').kind).not.toBe('youtube');
  });

  it('rejects watch route with no v=', () => {
    expect(classifyMediaUrl('https://youtube.com/watch').kind).not.toBe('youtube');
  });

  it('does not mis-classify a youtube domain image URL', () => {
    expect(classifyMediaUrl('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toEqual({ kind: 'image' });
  });
});

describe('classifyMediaUrl — video files', () => {
  it.each([
    'https://cdn.example.com/video.mp4',
    'https://cdn.example.com/path/clip.MP4',
    'https://cdn.example.com/clip.webm',
    'https://cdn.example.com/clip.mov',
    'https://cdn.example.com/clip.m4v',
    'https://cdn.example.com/clip.mp4?token=x',
    'https://cdn.example.com/clip.mp4#t=10',
  ])('%s → video', (url) => {
    expect(classifyMediaUrl(url)).toEqual({ kind: 'video' });
  });
});

describe('classifyMediaUrl — image (default)', () => {
  it.each([
    'https://cdn.example.com/photo.jpg',
    'https://cdn.example.com/photo.png',
    'https://cdn.example.com/photo.webp',
    'https://cdn.example.com/no-ext-just-a-path',
    'not a url at all',
    '',
  ])('%s → image', (url) => {
    expect(classifyMediaUrl(url)).toEqual({ kind: 'image' });
  });
});
