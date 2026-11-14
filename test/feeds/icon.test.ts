import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inflateSync } from "node:zlib";
import {
  buildIcons,
  ICON_SIZE,
  iconColors,
  teamIcon,
} from "../../src/feeds/icon.ts";
import { NFL, nflTeam } from "../../src/leagues/nfl.ts";

/** A PNG's size and RGBA pixels, as icon.ts writes them (no filtering). */
function decode(png: Uint8Array) {
  const bytes = Buffer.from(png);
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  let at = 8;
  let width = 0;
  const data: Buffer[] = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("ascii", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") width = body.readUInt32BE(0);
    if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(data));
  const pixel = (x: number, y: number) => {
    const start = y * (width * 4 + 1) + 1 + x * 4;
    return [...rows.subarray(start, start + 4)];
  };
  return { width, pixel };
}

describe("team icons", () => {
  it("draws one for every team", () => {
    const icons = buildIcons(NFL);
    assert.equal(icons.size, NFL.teams.length);
    assert.ok(icons.has("nfl/icons/min.png"));
  });

  it("fills the tile with the darker color and the ball with the lighter", () => {
    assert.deepEqual(iconColors(nflTeam("MIN")), {
      tile: [0x4f, 0x26, 0x83],
      ball: [0xff, 0xc6, 0x2f],
    });
    // The Steelers list black first, then gold: still a gold ball.
    assert.deepEqual(iconColors(nflTeam("PIT")), {
      tile: [0, 0, 0],
      ball: [0xff, 0xb6, 0x12],
    });
  });

  it("lifts a ball too dark to read, keeping its hue", () => {
    const { tile, ball } = iconColors(nflTeam("PHI"));
    assert.deepEqual(tile, [0, 0, 0]);
    // The Eagles' midnight green, lighter but still green-blue.
    const [r, g, b] = ball;
    assert.ok(r < g && r < b, `${ball}`);
    assert.ok(g > 0x42 && b > 0x4d, `${ball}`);
  });

  it("draws the tile, the ball and the laces cut out of it", () => {
    const { width, pixel } = decode(teamIcon(nflTeam("MIN")));
    assert.equal(width, ICON_SIZE);
    const middle = ICON_SIZE / 2;
    // A rounded corner is clear; inside it, the tile.
    assert.deepEqual(pixel(0, 0), [0, 0, 0, 0]);
    assert.deepEqual(pixel(10, middle), [0x4f, 0x26, 0x83, 255]);
    // The ball, either side of the laces, and the laces in the tile's color.
    assert.deepEqual(pixel(middle, middle - 20), [0xff, 0xc6, 0x2f, 255]);
    assert.deepEqual(pixel(middle, middle), [0x4f, 0x26, 0x83, 255]);
  });

  it("is a pure function of the team", () => {
    const team = nflTeam("KC");
    assert.deepEqual(teamIcon(team), teamIcon(team));
  });
});
