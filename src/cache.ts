/**
 * The videos gathered so far, and the searches already run, kept on disk
 * (`.cache/`, not in git) so the dataset can be rebuilt without asking
 * YouTube again and no search is paid for twice.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { Video } from "./matcher.ts";

const videoSchema = z.object({
  youtubeId: z.string(),
  title: z.string(),
  publishedAt: z.string(),
});

const cacheSchema = z.object({
  videos: z.array(videoSchema),
  searches: z.array(z.string()),
});

export class VideoCache {
  readonly #videos = new Map<string, Video>();
  readonly #searches = new Set<string>();

  static read(path: string): VideoCache {
    const cache = new VideoCache();
    if (!existsSync(path)) return cache;
    const parsed = cacheSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    cache.add(parsed.videos);
    for (const search of parsed.searches) cache.#searches.add(search);
    return cache;
  }

  write(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ videos: this.videos, searches: [...this.#searches] }),
    );
  }

  /** Videos in the order first seen, each with the latest title seen for it. */
  get videos(): Video[] {
    return [...this.#videos.values()];
  }

  /** Adds videos, returning how many were new. */
  add(videos: readonly Video[]): number {
    let added = 0;
    for (const video of videos) {
      if (!this.#videos.has(video.youtubeId)) added += 1;
      this.#videos.set(video.youtubeId, video);
    }
    return added;
  }

  /** Forgets a video, such as one taken down, so nothing matches it again. */
  delete(youtubeId: string): void {
    this.#videos.delete(youtubeId);
  }

  has(youtubeId: string): boolean {
    return this.#videos.has(youtubeId);
  }

  searched(key: string): boolean {
    return this.#searches.has(key);
  }

  markSearched(key: string): void {
    this.#searches.add(key);
  }
}
