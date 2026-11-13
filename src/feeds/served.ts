/**
 * What a build would change on the site served now. The workflow asks
 * before it deploys, for two reasons.
 *
 * - A build that changes nothing is not deployed. Most of the publisher's
 *   pushes change no feed (a game going final, a recap still searched for,
 *   a retitle), and GitHub Pages dates every file by the deploy, not its
 *   contents: each deploy gives every feed a new `ETag` and
 *   `Last-Modified`, so every reader polling every feed downloads it whole
 *   again rather than being told it has not changed.
 * - The feeds that did change are pinged to the WebSub hub once the deploy
 *   is live (`HUB` in atom.ts), so readers subscribed through it hear at
 *   once.
 *
 * A file that cannot be read counts as changed: a needless deploy or ping
 * costs a little, a missed one leaves the site behind. A file the build no
 * longer writes is not noticed; a manual run of the workflow deploys
 * regardless.
 */

/** The bytes served at an address now, or null where nothing is. */
export type FetchBytes = (url: string) => Promise<Uint8Array | null>;

/** The paths of the built files whose bytes differ from those served at `baseUrl`. */
export async function changedFiles(
  files: ReadonlyMap<string, string | Uint8Array>,
  baseUrl: string,
  fetchBytes: FetchBytes = servedBytes,
): Promise<string[]> {
  const changed = await Promise.all(
    [...files].map(async ([path, contents]) => {
      const served = await fetchBytes(baseUrl + path).catch(() => null);
      const built =
        typeof contents === "string" ? Buffer.from(contents) : contents;
      return served && Buffer.from(served).equals(built) ? null : path;
    }),
  );
  return changed.filter((path) => path !== null);
}

async function servedBytes(url: string): Promise<Uint8Array | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
}
