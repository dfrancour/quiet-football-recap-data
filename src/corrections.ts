/**
 * Matches decided by a person, which the matcher never overrides: a recap
 * whose title follows no rule, or a match the rules got wrong. Each names its
 * game and the video, or `null` for a game with no recap.
 */

import { z } from "zod";
import type { ScheduledGame } from "./espn.ts";

const correctionSchema = z.object({
  season: z.number().int(),
  season_type: z.enum(["preseason", "regular", "postseason"]),
  week: z.number().int(),
  away: z.string(),
  home: z.string(),
  youtube_id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{11}$/)
    .nullable(),
  /** Why, in a few words: "retitled into Top 20 Games of 2015". */
  reason: z.string().min(1),
});

export const correctionsSchema = z.array(correctionSchema);

export type Correction = z.infer<typeof correctionSchema>;

/** The correction for a game, if a person has decided it. */
export function correctionFor(
  corrections: readonly Correction[],
  season: number,
  game: ScheduledGame,
): Correction | undefined {
  return corrections.find(
    (entry) =>
      entry.season === season &&
      entry.season_type === game.seasonType &&
      entry.week === game.week &&
      entry.away === game.away.abbreviation &&
      entry.home === game.home.abbreviation,
  );
}
