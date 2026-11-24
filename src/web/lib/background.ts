// Full-screen background photo (dxexb.com style): the Bing daily wallpaper sits
// behind the whole app, and every panel paints over it as frosted glass.
// Everything here is localStorage only — no server state, no new API routes.
// The photo changes daily; a custom URL overrides it; if nothing loads, the
// CSS fallback gradient in index.css shows instead.
//
// Bing's metadata API sends no CORS headers, so a browser fetch() to it is
// refused — the daily photo is therefore loaded through the redirect endpoint
// below (plain <img>, no CORS needed), which serves Bing's photo of the day.
// The metadata API is only tried as a best-effort extra for the photo title
// and the canonical URL; when it fails (the normal case in browsers) the
// redirect URL keeps working and nothing breaks.
import { useEffect, useSyncExternalStore } from 'react';
import { storageGet, storageSet } from './utils';

export type WallpaperSource = 'bing' | 'custom';

export interface WallpaperState {
  /** Resolved image URL, or null while loading / when nothing could be resolved. */
  url: string | null;
  source: WallpaperSource;
  /** Bing's copyright line for today's photo, when known. */
  title: string | null;
  loading: boolean;
}

const BING_API = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=8&mkt=zh-CN';
const BING_ORIGIN = 'https://www.bing.com';
const CUSTOM_KEY = 'oi.wallpaper.custom';
const CACHE_KEY = 'oi.wallpaper.cache';
const IDX_KEY = 'oi.wallpaper.idx';

interface BingImage {
  url: string;
  copyright: string;
}

interface BingCache {
  date: string;
  images: BingImage[];
}

const todayKey = () => new Date().toISOString().slice(0, 10);

function readCache(): BingCache | null {
  const c = storageGet<BingCache | null>(CACHE_KEY, null);
  return c && c.date === todayKey() && Array.isArray(c.images) && c.images.length > 0 ? c : null;
}

function readIdx(): number {
  const n = storageGet<number>(IDX_KEY, 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function bingImageUrl(img: BingImage): string {
  return img.url.startsWith('http') ? img.url : `${BING_ORIGIN}${img.url}`;
}

/** Daily-image URL that needs no CORS (plain <img> load). This is the primary
    source: it redirects to Bing's photo of the day (or an earlier day by
    index). The metadata API below is only a best-effort extra. */
function biturlImageUrl(idx: number): string {
  return `https://bing.biturl.top/?resolution=1920&format=image&index=${idx}&mkt=zh-CN`;
}

let state: WallpaperState = { url: biturlImageUrl(readIdx()), source: 'bing', title: null, loading: false };
const listeners = new Set<() => void>();
let fetching = false;

function emit(next: WallpaperState): void {
  state = next;
  listeners.forEach((l) => l());
}

function resolveFromCache(cache: BingCache | null, idx: number): WallpaperState {
  if (!cache) return { url: null, source: 'bing', title: null, loading: false };
  const img = cache.images[idx % cache.images.length];
  return { url: bingImageUrl(img), source: 'bing', title: img.copyright || null, loading: false };
}

function applyCustomOrBing(): void {
  const custom = storageGet<string>(CUSTOM_KEY, '');
  if (custom.trim()) {
    emit({ url: custom.trim(), source: 'custom', title: null, loading: false });
    return;
  }
  const cache = readCache();
  emit(cache ? resolveFromCache(cache, readIdx()) : { url: biturlImageUrl(readIdx()), source: 'bing', title: null, loading: false });
}

async function fetchBing(): Promise<void> {
  if (fetching) return;
  fetching = true;
  try {
    const res = await fetch(BING_API);
    if (!res.ok) throw new Error(`Bing ${res.status}`);
    const data = (await res.json()) as { images?: BingImage[] };
    const images = (data.images ?? []).filter((i) => i.url);
    if (images.length === 0) throw new Error('Bing returned no images');
    storageSet(CACHE_KEY, { date: todayKey(), images } satisfies BingCache);
    if (!storageGet<string>(CUSTOM_KEY, '').trim()) {
      emit(resolveFromCache({ date: todayKey(), images }, readIdx()));
    }
  } catch {
    // Expected in browsers (no CORS headers on Bing's API): keep the
    // redirect URL that's already showing. The CSS gradient covers a total
    // failure of both sources.
    emit({ ...state, loading: false });
  } finally {
    fetching = false;
  }
}

/** Cycle to another recent Bing photo (today and the previous 7 days). */
export function nextWallpaper(): void {
  const cache = readCache();
  const count = cache ? cache.images.length : 8;
  const idx = (readIdx() + 1) % count;
  storageSet(IDX_KEY, idx);
  if (storageGet<string>(CUSTOM_KEY, '').trim()) return;
  if (cache) emit(resolveFromCache(cache, idx));
  else emit({ url: biturlImageUrl(idx), source: 'bing', title: null, loading: false });
  void fetchBing();
}

export function setCustomWallpaper(url: string): void {
  const clean = url.trim();
  if (!clean) {
    clearCustomWallpaper();
    return;
  }
  storageSet(CUSTOM_KEY, clean);
  emit({ url: clean, source: 'custom', title: null, loading: false });
}

export function clearCustomWallpaper(): void {
  storageSet(CUSTOM_KEY, '');
  applyCustomOrBing();
  void fetchBing();
}

export function getCustomWallpaper(): string {
  return storageGet<string>(CUSTOM_KEY, '');
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function useWallpaper(): WallpaperState & {
  next: () => void;
  setCustom: (url: string) => void;
  clearCustom: () => void;
} {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  // Kick off the daily fetch once, on first mount.
  useEffect(() => {
    applyCustomOrBing();
    void fetchBing();
  }, []);
  return { ...snapshot, next: nextWallpaper, setCustom: setCustomWallpaper, clearCustom: clearCustomWallpaper };
}
