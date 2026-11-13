import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { changedFiles } from "../../src/feeds/served.ts";

const BASE = "https://example.test/feeds/";

function serving(files: Record<string, string>) {
  return async (url: string) => {
    const text = files[url.slice(BASE.length)];
    return text === undefined ? null : new TextEncoder().encode(text);
  };
}

describe("changedFiles", () => {
  it("names the files whose bytes differ from those served", async () => {
    const built = new Map<string, string | Uint8Array>([
      ["nfl/all.atom", "all, new"],
      ["nfl/kc.atom", "kc, same"],
      ["index.html", "page, new"],
      ["icon.png", new Uint8Array([1, 2, 3])],
    ]);
    const served = serving({
      "nfl/all.atom": "all, old",
      "nfl/kc.atom": "kc, same",
      "index.html": "page, old",
      "icon.png": "\u0001\u0002\u0003",
    });
    assert.deepEqual(await changedFiles(built, BASE, served), [
      "nfl/all.atom",
      "index.html",
    ]);
  });

  it("names none when nothing changed", async () => {
    const built = new Map([["nfl/kc.atom", "kc, same"]]);
    const served = serving({ "nfl/kc.atom": "kc, same" });
    assert.deepEqual(await changedFiles(built, BASE, served), []);
  });

  it("counts a file it cannot read as changed", async () => {
    const built = new Map([["nfl/kc.atom", "kc"]]);
    assert.deepEqual(await changedFiles(built, BASE, serving({})), [
      "nfl/kc.atom",
    ]);
    assert.deepEqual(
      await changedFiles(built, BASE, async () => {
        throw new Error("offline");
      }),
      ["nfl/kc.atom"],
    );
  });
});
