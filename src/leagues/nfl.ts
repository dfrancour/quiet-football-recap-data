/**
 * The NFL: everything the code knows that is the league's own. A season's
 * week numbering is ESPN's NFL numbering, which src/sources/espn.ts reads.
 */

import type { Conference, League, Team } from "../model.ts";

/**
 * One per franchise for every season. `formerNames` are what older titles
 * call a team on their own ("Redskins vs. Cowboys"); a renamed or relocated
 * team adds its old name there.
 */
// prettier-ignore
const TEAMS: readonly Team[] = [
  { abbreviation: "ARI", espnId: "22", location: "Arizona", nickname: "Cardinals", formerNames: [] },
  { abbreviation: "ATL", espnId: "1", location: "Atlanta", nickname: "Falcons", formerNames: [] },
  { abbreviation: "BAL", espnId: "33", location: "Baltimore", nickname: "Ravens", formerNames: [] },
  { abbreviation: "BUF", espnId: "2", location: "Buffalo", nickname: "Bills", formerNames: [] },
  { abbreviation: "CAR", espnId: "29", location: "Carolina", nickname: "Panthers", formerNames: [] },
  { abbreviation: "CHI", espnId: "3", location: "Chicago", nickname: "Bears", formerNames: [] },
  { abbreviation: "CIN", espnId: "4", location: "Cincinnati", nickname: "Bengals", formerNames: [] },
  { abbreviation: "CLE", espnId: "5", location: "Cleveland", nickname: "Browns", formerNames: [] },
  { abbreviation: "DAL", espnId: "6", location: "Dallas", nickname: "Cowboys", formerNames: [] },
  { abbreviation: "DEN", espnId: "7", location: "Denver", nickname: "Broncos", formerNames: [] },
  { abbreviation: "DET", espnId: "8", location: "Detroit", nickname: "Lions", formerNames: [] },
  { abbreviation: "GB", espnId: "9", location: "Green Bay", nickname: "Packers", formerNames: [] },
  { abbreviation: "HOU", espnId: "34", location: "Houston", nickname: "Texans", formerNames: [] },
  { abbreviation: "IND", espnId: "11", location: "Indianapolis", nickname: "Colts", formerNames: [] },
  { abbreviation: "JAX", espnId: "30", location: "Jacksonville", nickname: "Jaguars", formerNames: [] },
  { abbreviation: "KC", espnId: "12", location: "Kansas City", nickname: "Chiefs", formerNames: [] },
  { abbreviation: "LAC", espnId: "24", location: "Los Angeles", nickname: "Chargers", formerNames: ["San Diego"] },
  { abbreviation: "LAR", espnId: "14", location: "Los Angeles", nickname: "Rams", formerNames: ["St. Louis"] },
  { abbreviation: "LV", espnId: "13", location: "Las Vegas", nickname: "Raiders", formerNames: ["Oakland"] },
  { abbreviation: "MIA", espnId: "15", location: "Miami", nickname: "Dolphins", formerNames: [] },
  { abbreviation: "MIN", espnId: "16", location: "Minnesota", nickname: "Vikings", formerNames: [] },
  { abbreviation: "NE", espnId: "17", location: "New England", nickname: "Patriots", formerNames: [] },
  { abbreviation: "NO", espnId: "18", location: "New Orleans", nickname: "Saints", formerNames: [] },
  { abbreviation: "NYG", espnId: "19", location: "New York", nickname: "Giants", formerNames: [] },
  { abbreviation: "NYJ", espnId: "20", location: "New York", nickname: "Jets", formerNames: [] },
  { abbreviation: "PHI", espnId: "21", location: "Philadelphia", nickname: "Eagles", formerNames: [] },
  { abbreviation: "PIT", espnId: "23", location: "Pittsburgh", nickname: "Steelers", formerNames: [] },
  { abbreviation: "SEA", espnId: "26", location: "Seattle", nickname: "Seahawks", formerNames: [] },
  { abbreviation: "SF", espnId: "25", location: "San Francisco", nickname: "49ers", formerNames: [] },
  { abbreviation: "TB", espnId: "27", location: "Tampa Bay", nickname: "Buccaneers", formerNames: [] },
  { abbreviation: "TEN", espnId: "10", location: "Tennessee", nickname: "Titans", formerNames: [] },
  { abbreviation: "WSH", espnId: "28", location: "Washington", nickname: "Commanders", formerNames: ["Redskins"] },
];

/**
 * The conferences and divisions as they stand today (the alignment since
 * 2002), in the order Quiet Football's standings lay them out: NFC then AFC,
 * each North, East, South, West.
 */
const CONFERENCES: readonly Conference[] = [
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

export const NFL: League = {
  id: "nfl",
  name: "NFL",
  teams: TEAMS,
  conferences: CONFERENCES,
  // The NFL's own YouTube channel.
  channelId: "UCDVYQ4Zhbm3S2dlz7P1GBDg",
  espn: {
    scoreboard:
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
    logos: "/i/teamlogos/nfl/500-dark",
  },
};

export function nflTeam(abbreviation: string): Team {
  const team = TEAMS.find((entry) => entry.abbreviation === abbreviation);
  if (!team) throw new Error(`No NFL team ${abbreviation}`);
  return team;
}
