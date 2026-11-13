/**
 * The league's conferences and divisions as they stand today (the alignment
 * since 2002), in the order Quiet Football's standings lay them out: NFC
 * then AFC, each North, East, South, West. Only the feeds' index and OPML
 * files use it; a game's record never depends on it.
 */

export interface Conference {
  name: string;
  divisions: readonly { name: string; teams: readonly string[] }[];
}

export const NFL_CONFERENCES: readonly Conference[] = [
  {
    name: "NFC",
    divisions: [
      { name: "North", teams: ["CHI", "DET", "GB", "MIN"] },
      { name: "East", teams: ["DAL", "NYG", "PHI", "WSH"] },
      { name: "South", teams: ["ATL", "CAR", "NO", "TB"] },
      { name: "West", teams: ["ARI", "LAR", "SF", "SEA"] },
    ],
  },
  {
    name: "AFC",
    divisions: [
      { name: "North", teams: ["BAL", "CIN", "CLE", "PIT"] },
      { name: "East", teams: ["BUF", "MIA", "NE", "NYJ"] },
      { name: "South", teams: ["HOU", "IND", "JAX", "TEN"] },
      { name: "West", teams: ["DEN", "KC", "LV", "LAC"] },
    ],
  },
];
