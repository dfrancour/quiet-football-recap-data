/**
 * Each team feed's icon: Quiet Football's football in the team's two colors,
 * so a reader's folder of four feeds shows four teams, not one mark four
 * times. The darker color fills the tile and the lighter the ball, with the
 * laces cut out in the tile's color. A ball too dark to read on its tile
 * (the Ravens' purple, the Eagles' teal, both on black) is lifted to a
 * floor of lightness, keeping its hue.
 *
 * The icon is drawn here, pixel by pixel, and written as a PNG, since few
 * readers show an SVG icon. The shapes are three (a rounded square, the
 * football's two arcs, the laces), so this needs no image library, and the
 * colors live with the team (src/leagues/). Like a feed, an icon is a pure
 * function of the data.
 */

import { crc32, deflateSync } from "node:zlib";
import type { League, Team } from "../model.ts";

/** An icon's width and height in pixels, as the site's touch icon. */
export const ICON_SIZE = 180;

/** The lightness a ball is lifted to, in OKLab, where 1 is white. */
const BALL_LIGHTNESS = 0.55;

/** `nfl/icons/min.png`. */
export function iconPath(league: string, team: Team): string {
  return `${league}/icons/${team.abbreviation.toLowerCase()}.png`;
}

/** Every team's icon, by path. */
export function buildIcons(league: League): Map<string, Uint8Array> {
  return new Map(
    league.teams.map((team) => [iconPath(league.id, team), teamIcon(team)]),
  );
}

type Rgb = readonly [number, number, number];

/** The tile's and the ball's colors, as 0–255 sRGB. */
export function iconColors(team: Team): { tile: Rgb; ball: Rgb } {
  const [first, second] = team.colors.map(parseHex) as [Rgb, Rgb];
  const [tile, ball] =
    toOklab(first)[0] <= toOklab(second)[0] ? [first, second] : [second, first];
  const [lightness, a, b] = toOklab(ball);
  if (lightness >= BALL_LIGHTNESS) return { tile, ball };
  // Lifted along the same hue and chroma.
  return { tile, ball: fromOklab([BALL_LIGHTNESS, a, b]) };
}

/** The team's icon as a PNG. */
export function teamIcon(team: Team, size = ICON_SIZE): Uint8Array {
  const { tile, ball } = iconColors(team);
  return png(size, rasterize(size, tile, ball));
}

/*
 * The drawing, in a 76-unit square (the mark's own units, as Quiet
 * Football's SVG draws it): a tile with corners of radius 15, the football
 * as the lens between two circles of radius 28.149 meeting at (14, 38) and
 * (62, 38), and its laces a stroke 3.36 wide from x 30.08 to 45.92.
 */
const UNITS = 76;
const CORNER = 15;
const RADIUS = 28.149;
const HALF_CHORD = 24;
const OFFSET = Math.sqrt(RADIUS ** 2 - HALF_CHORD ** 2);
const CENTER = 38;
const LACES = { from: 30.08, to: 45.92, halfWidth: 1.68 };
/** Samples per pixel along each axis, for smooth edges. */
const SAMPLES = 4;

type Region = "outside" | "tile" | "ball";

function regionAt(x: number, y: number): Region {
  const dx = Math.max(CORNER - x, 0, x - (UNITS - CORNER));
  const dy = Math.max(CORNER - y, 0, y - (UNITS - CORNER));
  if (x < 0 || y < 0 || x > UNITS || y > UNITS) return "outside";
  if (dx ** 2 + dy ** 2 > CORNER ** 2) return "outside";
  const inBall =
    (x - CENTER) ** 2 + (y - (CENTER + OFFSET)) ** 2 <= RADIUS ** 2 &&
    (x - CENTER) ** 2 + (y - (CENTER - OFFSET)) ** 2 <= RADIUS ** 2;
  if (!inBall) return "tile";
  const along = Math.min(LACES.to, Math.max(LACES.from, x));
  const onLaces = (x - along) ** 2 + (y - CENTER) ** 2 <= LACES.halfWidth ** 2;
  return onLaces ? "tile" : "ball";
}

/** RGBA rows, each sample's color averaged into its pixel. */
function rasterize(size: number, tile: Rgb, ball: Rgb): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const scale = UNITS / size;
  const total = SAMPLES ** 2;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      let covered = 0;
      const sum = [0, 0, 0];
      for (let i = 0; i < SAMPLES; i++) {
        for (let j = 0; j < SAMPLES; j++) {
          const region = regionAt(
            (column + (j + 0.5) / SAMPLES) * scale,
            (row + (i + 0.5) / SAMPLES) * scale,
          );
          if (region === "outside") continue;
          const color = region === "ball" ? ball : tile;
          covered++;
          for (let c = 0; c < 3; c++) sum[c]! += color[c]!;
        }
      }
      const at = (row * size + column) * 4;
      if (covered === 0) continue;
      for (let c = 0; c < 3; c++) {
        pixels[at + c] = Math.round(sum[c]! / covered);
      }
      pixels[at + 3] = Math.round((covered / total) * 255);
    }
  }
  return pixels;
}

/** RGBA pixels as a PNG: 8 bits a channel, no filtering. */
function png(size: number, pixels: Uint8Array): Uint8Array {
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let row = 0; row < size; row++) {
    const start = row * (size * 4 + 1);
    rows[start] = 0;
    rows.set(pixels.subarray(row * size * 4, (row + 1) * size * 4), start + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function parseHex(hex: string): Rgb {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Not a #rrggbb color: ${hex}`);
  return [1, 2, 3].map((group) => parseInt(match[group]!, 16)) as [
    number,
    number,
    number,
  ];
}

/* OKLab, Björn Ottosson's, from and to sRGB. */

function toLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function fromLinear(value: number): number {
  const clipped = Math.min(1, Math.max(0, value));
  const encoded =
    clipped <= 0.0031308
      ? clipped * 12.92
      : 1.055 * clipped ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

function toOklab([red, green, blue]: Rgb): Rgb {
  const [r, g, b] = [red, green, blue].map(toLinear) as [
    number,
    number,
    number,
  ];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([lightness, a, b]: Rgb): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
