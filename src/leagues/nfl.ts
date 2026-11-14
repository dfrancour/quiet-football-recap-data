/**
 * The NFL: everything the code knows that is the league's own. A season's
 * week numbering is ESPN's NFL numbering, which src/sources/espn.ts reads.
 */

import type { Conference, League, Team } from "../model.ts";

/**
 * One per franchise for every season. `formerNames` are what older titles
 * call a team on their own ("Redskins vs. Cowboys"); a renamed or relocated
 * team adds its old name there. `colors` are ESPN's color and alternate
 * color for the team (its teams endpoint's `color` and `alternateColor`).
 */
// prettier-ignore
const TEAMS: readonly Team[] = [
  { abbreviation: "ARI", espnId: "22", location: "Arizona", nickname: "Cardinals", colors: ["#a40227", "#ffffff"], formerNames: [] },
  { abbreviation: "ATL", espnId: "1", location: "Atlanta", nickname: "Falcons", colors: ["#a71930", "#000000"], formerNames: [] },
  { abbreviation: "BAL", espnId: "33", location: "Baltimore", nickname: "Ravens", colors: ["#29126f", "#000000"], formerNames: [] },
  { abbreviation: "BUF", espnId: "2", location: "Buffalo", nickname: "Bills", colors: ["#00338d", "#d50a0a"], formerNames: [] },
  { abbreviation: "CAR", espnId: "29", location: "Carolina", nickname: "Panthers", colors: ["#0085ca", "#000000"], formerNames: [] },
  { abbreviation: "CHI", espnId: "3", location: "Chicago", nickname: "Bears", colors: ["#0b1c3a", "#e64100"], formerNames: [] },
  { abbreviation: "CIN", espnId: "4", location: "Cincinnati", nickname: "Bengals", colors: ["#fb4f14", "#000000"], formerNames: [] },
  { abbreviation: "CLE", espnId: "5", location: "Cleveland", nickname: "Browns", colors: ["#472a08", "#ff3c00"], formerNames: [] },
  { abbreviation: "DAL", espnId: "6", location: "Dallas", nickname: "Cowboys", colors: ["#002a5c", "#b0b7bc"], formerNames: [] },
  { abbreviation: "DEN", espnId: "7", location: "Denver", nickname: "Broncos", colors: ["#0a2343", "#fc4c02"], formerNames: [] },
  { abbreviation: "DET", espnId: "8", location: "Detroit", nickname: "Lions", colors: ["#0076b6", "#bbbbbb"], formerNames: [] },
  { abbreviation: "GB", espnId: "9", location: "Green Bay", nickname: "Packers", colors: ["#204e32", "#ffb612"], formerNames: [] },
  { abbreviation: "HOU", espnId: "34", location: "Houston", nickname: "Texans", colors: ["#021018", "#eb0028"], formerNames: [] },
  { abbreviation: "IND", espnId: "11", location: "Indianapolis", nickname: "Colts", colors: ["#003b75", "#ffffff"], formerNames: [] },
  { abbreviation: "JAX", espnId: "30", location: "Jacksonville", nickname: "Jaguars", colors: ["#007487", "#d7a22a"], formerNames: [] },
  { abbreviation: "KC", espnId: "12", location: "Kansas City", nickname: "Chiefs", colors: ["#e31837", "#ffb612"], formerNames: [] },
  { abbreviation: "LAC", espnId: "24", location: "Los Angeles", nickname: "Chargers", colors: ["#0080c6", "#ffc20e"], formerNames: ["San Diego"] },
  { abbreviation: "LAR", espnId: "14", location: "Los Angeles", nickname: "Rams", colors: ["#003594", "#ffd100"], formerNames: ["St. Louis"] },
  { abbreviation: "LV", espnId: "13", location: "Las Vegas", nickname: "Raiders", colors: ["#000000", "#a5acaf"], formerNames: ["Oakland"] },
  { abbreviation: "MIA", espnId: "15", location: "Miami", nickname: "Dolphins", colors: ["#008e97", "#fc4c02"], formerNames: [] },
  { abbreviation: "MIN", espnId: "16", location: "Minnesota", nickname: "Vikings", colors: ["#4f2683", "#ffc62f"], formerNames: [] },
  { abbreviation: "NE", espnId: "17", location: "New England", nickname: "Patriots", colors: ["#002a5c", "#c60c30"], formerNames: [] },
  { abbreviation: "NO", espnId: "18", location: "New Orleans", nickname: "Saints", colors: ["#d3bc8d", "#000000"], formerNames: [] },
  { abbreviation: "NYG", espnId: "19", location: "New York", nickname: "Giants", colors: ["#003c7f", "#c9243f"], formerNames: [] },
  { abbreviation: "NYJ", espnId: "20", location: "New York", nickname: "Jets", colors: ["#115740", "#ffffff"], formerNames: [] },
  { abbreviation: "PHI", espnId: "21", location: "Philadelphia", nickname: "Eagles", colors: ["#06424d", "#000000"], formerNames: [] },
  { abbreviation: "PIT", espnId: "23", location: "Pittsburgh", nickname: "Steelers", colors: ["#000000", "#ffb612"], formerNames: [] },
  { abbreviation: "SEA", espnId: "26", location: "Seattle", nickname: "Seahawks", colors: ["#002a5c", "#69be28"], formerNames: [] },
  { abbreviation: "SF", espnId: "25", location: "San Francisco", nickname: "49ers", colors: ["#aa0000", "#b3995d"], formerNames: [] },
  { abbreviation: "TB", espnId: "27", location: "Tampa Bay", nickname: "Buccaneers", colors: ["#bd1c36", "#3e3a35"], formerNames: [] },
  { abbreviation: "TEN", espnId: "10", location: "Tennessee", nickname: "Titans", colors: ["#4495d2", "#001532"], formerNames: [] },
  { abbreviation: "WSH", espnId: "28", location: "Washington", nickname: "Commanders", colors: ["#5a1414", "#ffb612"], formerNames: ["Redskins"] },
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
