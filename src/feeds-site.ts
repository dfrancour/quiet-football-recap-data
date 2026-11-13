/**
 * The site around the feeds (feeds.quiet-football.com): the page that lists
 * them, laid out as Quiet Football lays out its standings, and an OPML file
 * per division, which a reader imports to follow its four teams at once.
 * It is for finding a feed, not for explaining one (Quiet Football does
 * that), so it holds the feeds and its header and nothing else, in Quiet
 * Football's colors, mark and titles.
 */

import { escape, feedPath, fullName, SITE } from "./feeds.ts";
import type { Team } from "./matcher.ts";
import type { Conference } from "./nfl/divisions.ts";

export interface SiteOptions {
  league: string;
  /** The league's name as a reader knows it: "NFL". */
  leagueName: string;
  teams: readonly Team[];
  conferences: readonly Conference[];
  /** Where the site is served, with a final slash. */
  baseUrl: string;
}

interface Division {
  /** "NFC North". */
  name: string;
  /** In the order the standings list them. */
  teams: Team[];
}

/** Quiet Football's name, which ends every page's title as it does there. */
const SITE_NAME = "Quiet Football";

const DATA_REPO = "https://github.com/dfrancour/quiet-football-recap-data";

/** Every page and OPML file, by path: `index.html`, `nfl/nfc-north.opml`, … */
export function buildSite(options: SiteOptions): Map<string, string> {
  const site = new Map<string, string>([["index.html", feedIndex(options)]]);
  for (const division of divisions(options)) {
    site.set(opmlPath(options.league, division), opml(options, division));
  }
  return site;
}

/** `nfl/nfc-north.opml`. */
export function opmlPath(league: string, division: { name: string }): string {
  return `${league}/${division.name.toLowerCase().replaceAll(" ", "-")}.opml`;
}

/**
 * Every division, conference by conference, its teams in the order the
 * standings list them when results are hidden: alphabetically by nickname,
 * since any other order gives results away.
 */
function divisions(options: SiteOptions): Division[] {
  return options.conferences.flatMap((conference) =>
    conference.divisions.map((division) => ({
      name: `${conference.name} ${division.name}`,
      teams: division.teams
        .map((code) => {
          const team = options.teams.find(
            (entry) => entry.abbreviation === code,
          );
          if (!team) throw new Error(`No team ${code}`);
          return team;
        })
        .sort((a, b) => a.nickname.localeCompare(b.nickname)),
    })),
  );
}

/**
 * OPML 2.0: one folder, named for the division, of its teams' feeds.
 * `type="rss"` is what every reader expects of a feed outline, Atom
 * included.
 */
function opml(options: SiteOptions, division: Division): string {
  const { league, baseUrl } = options;
  const name = escape(division.name);
  const outlines = division.teams.map((team) => {
    const title = escape(`${fullName(team)} recaps`);
    return `      <outline type="rss" text="${title}" title="${title}" xmlUrl="${escape(baseUrl + feedPath(league, team))}" htmlUrl="${escape(`${SITE}/team/${team.abbreviation}`)}"/>`;
  });
  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<opml version="2.0">`,
    `  <head>`,
    `    <title>${name} recaps</title>`,
    `    <ownerName>${SITE_NAME}</ownerName>`,
    `    <docs>https://opml.org/spec2.opml</docs>`,
    `  </head>`,
    `  <body>`,
    `    <outline text="${name}" title="${name}">`,
    ...outlines,
    `    </outline>`,
    `  </body>`,
    `</opml>`,
    ``,
  ].join("\n");
}

/** ESPN's dark-variant mark, as Quiet Football shows it, at 2× its 20px. */
function logoUrl(team: Team): string {
  return `https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500-dark/${team.abbreviation.toLowerCase()}.png&h=96&w=96`;
}

/** Quiet Football's mark: the possession football (`FootballMark` there). */
const FOOTBALL = `<path d="M 2 16 A 28.149 28.149 0 0 1 50 16 A 28.149 28.149 0 0 1 2 16 Z" fill="currentColor"/><line x1="18.08" x2="33.92" y1="16" y2="16" stroke="#000" stroke-opacity="0.4" stroke-width="3.36" stroke-linecap="round"/>`;

/** Lucide's icons, as the site draws them. */
const ICONS = {
  back: `<path d="m15 18-6-6 6-6"/>`,
  copy: `<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`,
  check: `<path d="M20 6 9 17l-5-5"/>`,
  download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>`,
  rss: `<path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>`,
};

function icon(name: keyof typeof ICONS, className = "icon"): string {
  return `<svg class="${className}" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
}

/** Each icon drawn once, for every `<use>` of it on the page. */
const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true">${Object.entries(
  ICONS,
)
  .map(
    ([name, body]) =>
      `<symbol id="icon-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</symbol>`,
  )
  .join("")}</svg>`;

/** The site's GitHub mark, filled rather than stroked. */
const GITHUB = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>`;

/** Copies a feed's address; hidden until the script finds a clipboard. */
function copyButton(url: string, label: string): string {
  return `<button type="button" class="copy" data-copy="${escape(url)}" aria-label="Copy the ${escape(label)} feed's address" title="Copy feed address" hidden>${icon("copy", "icon when-idle")}${icon("check", "icon when-copied")}</button>`;
}

function feedRow(
  href: string,
  url: string,
  mark: string,
  name: string,
  label: string,
): string {
  return `            <tr>
              <th scope="row"><a href="${escape(href)}">${mark}<span>${escape(name)}</span></a></th>
              <td>${copyButton(url, label)}</td>
            </tr>`;
}

function divisionTable(options: SiteOptions, division: Division): string {
  const id = escape(opmlPath("", division).slice(1, -".opml".length));
  const rows = division.teams.map((team) => {
    const path = feedPath(options.league, team);
    const logo = `<img src="${escape(logoUrl(team))}" alt="" width="20" height="20" loading="lazy">`;
    return feedRow(
      path,
      options.baseUrl + path,
      logo,
      team.nickname,
      fullName(team),
    );
  });
  const [conference, ...rest] = division.name.split(" ");
  return `        <div class="division">
          <div class="division-head">
            <h3 id="${id}"><span class="sr-only">${escape(conference ?? "")} </span>${escape(rest.join(" "))}</h3>
            <a class="opml" href="${escape(opmlPath(options.league, division))}" download title="All four ${escape(division.name)} feeds, as OPML">${icon("download")}<span>OPML</span><span class="sr-only">: all four ${escape(division.name)} feeds</span></a>
          </div>
          <table aria-labelledby="${id}">
            <tbody>
${rows.join("\n")}
            </tbody>
          </table>
        </div>`;
}

/** The page that lists the feeds, in Quiet Football's colors and layout. */
export function feedIndex(options: SiteOptions): string {
  const { league, leagueName, baseUrl } = options;
  const allPath = `${league}/all.atom`;
  const leagueLabel = escape(leagueName);
  const byConference = new Map<string, Division[]>();
  for (const division of divisions(options)) {
    const conference = division.name.split(" ")[0] ?? "";
    byConference.set(conference, [
      ...(byConference.get(conference) ?? []),
      division,
    ]);
  }
  const columns = [...byConference].map(
    ([
      conference,
      list,
    ]) => `      <section class="conference" aria-labelledby="conference-${escape(conference)}">
        <h2 id="conference-${escape(conference)}">${escape(conference)}</h2>
        <div class="divisions">
${list.map((division) => divisionTable(options, division)).join("\n")}
        </div>
      </section>`,
  );
  const title = `Recap feeds | ${SITE_NAME}`;
  const description = `Each ${leagueName} team's game recap videos from YouTube, as Atom feeds.`;
  // Every feed, the league's first, so a reader given this page offers them all.
  const alternates = [
    { title: `${leagueName} recaps`, href: baseUrl + allPath },
    ...divisions(options).flatMap((division) =>
      division.teams.map((team) => ({
        title: `${fullName(team)} recaps`,
        href: baseUrl + feedPath(league, team),
      })),
    ),
  ].map(
    (feed) =>
      `    <link rel="alternate" type="application/atom+xml" title="${escape(feed.title)}" href="${escape(feed.href)}">`,
  );
  // As Quiet Football names itself to a search engine, this page names the
  // site it belongs to.
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    url: baseUrl,
    description,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${SITE}/` },
  }).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>${escape(title)}</title>
    <meta name="description" content="${escape(description)}">
    <link rel="canonical" href="${escape(baseUrl)}">
    <meta name="theme-color" content="#0e0c12">
    <meta name="color-scheme" content="dark">
    <link rel="icon" href="icon.svg" type="image/svg+xml">
    <link rel="apple-touch-icon" href="apple-icon.png">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${SITE_NAME}">
    <meta property="og:title" content="${escape(title)}">
    <meta property="og:description" content="${escape(description)}">
    <meta property="og:url" content="${escape(baseUrl)}">
    <meta property="og:image" content="${SITE}/og.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${SITE_NAME}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escape(title)}">
    <meta name="twitter:description" content="${escape(description)}">
    <meta name="twitter:image" content="${SITE}/og.png">
${alternates.join("\n")}
    <script type="application/ld+json">${jsonLd}</script>
    <style>${STYLE}</style>
  </head>
  <body>
    ${SPRITE}
    <main>
      <header class="bar">
        <a class="mark" href="${SITE}/" aria-label="Back to ${SITE_NAME}" title="Back to ${SITE_NAME}">${icon("back", "icon back")}<svg class="football" viewBox="0 0 52 32" aria-hidden="true">${FOOTBALL}</svg><span>${SITE_NAME}</span></a>
        <span class="slash" aria-hidden="true">/</span>
        <h1>Recap feeds</h1>
        <a class="control" href="${DATA_REPO}" aria-label="The data on GitHub" title="The data on GitHub">${GITHUB}</a>
      </header>

      <p class="lede">Each ${leagueLabel} team&rsquo;s game recap videos from YouTube, as a feed for your reader.</p>

      <table class="league" aria-label="The league">
        <tbody>
${feedRow(allPath, baseUrl + allPath, icon("rss"), `Every ${leagueName} game`, `every ${leagueName} game`)}
        </tbody>
      </table>

      <div class="conferences">
${columns.join("\n")}
      </div>
    </main>
    <script>${SCRIPT}</script>
  </body>
</html>
`;
}

/** Quiet Football's tokens (its `globals.css`), dark only, as the site is. */
const STYLE = `
      :root {
        color-scheme: dark;
        --surface: oklch(16% 0.014 300);
        --surface-raised: oklch(21% 0.017 300);
        --edge: oklch(30% 0.02 300);
        --edge-strong: oklch(40% 0.025 300);
        --ink: oklch(96% 0.004 300);
        --ink-muted: oklch(72% 0.014 300);
        --ink-faint: oklch(61% 0.016 300);
        --accent-strong: oklch(63% 0.21 305);
        --win: oklch(72% 0.15 155);
      }
      * { box-sizing: border-box; }
      html { background: var(--surface); }
      body {
        margin: 0;
        background: var(--surface);
        color: var(--ink);
        font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      a { color: inherit; text-decoration: none; }
      a, button { touch-action: manipulation; }
      :focus-visible { outline: 2px solid var(--accent-strong); outline-offset: 2px; }
      .sr-only {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
      }
      .icon { width: 1rem; height: 1rem; flex-shrink: 0; }
      main {
        max-width: 72rem;
        margin: 0 auto;
        padding: calc(1.5rem + env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) calc(1.5rem + env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
      }

      /* The site's header: its mark and name, then the page's subject. */
      .bar { display: flex; align-items: center; gap: 0.75rem; min-height: 2rem; }
      .mark {
        display: flex; align-items: center; gap: 0.5rem; flex-shrink: 0;
        margin: -0.5rem; padding: 0.5rem; border-radius: 0.375rem;
        color: var(--ink-muted); font-size: 0.875rem; font-weight: 600; letter-spacing: -0.025em;
        transition: color 200ms;
      }
      .mark:hover { color: var(--ink); }
      .mark .football { width: 1.5rem; height: 0.875rem; }
      .mark .back { margin-right: -0.25rem; }
      .slash { color: var(--ink-faint); }
      h1 { margin: 0; font-size: 0.875rem; font-weight: 600; letter-spacing: -0.025em; white-space: nowrap; }
      .control {
        margin-left: auto; display: inline-flex; align-items: center; justify-content: center;
        width: 2rem; height: 2rem; border-radius: 0.375rem; color: var(--ink-faint);
        transition: color 200ms, background-color 200ms;
      }
      .control:hover { color: var(--ink-muted); background: var(--surface-raised); }

      table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
      tr { position: relative; border-top: 1px solid var(--edge); transition: background-color 200ms; }
      tr:hover { background: var(--surface-raised); }
      th { padding: 0.5rem 0.5rem 0.5rem 0.25rem; text-align: left; font-weight: 400; }
      th a { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
      th a span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      /* The overlay makes the whole row one target and one ring. */
      th a::after { content: ""; position: absolute; inset: 0; }
      th a:focus-visible { outline: none; }
      th a:focus-visible::after { outline: 2px solid var(--accent-strong); outline-offset: -2px; }
      th img { width: 1.25rem; height: 1.25rem; flex-shrink: 0; object-fit: contain; filter: drop-shadow(0 0 1px rgba(255, 255, 255, 0.55)); }
      td { width: 2rem; padding: 0 0.25rem 0 0; text-align: right; }

      .copy {
        position: relative; z-index: 1;
        display: inline-flex; align-items: center; justify-content: center;
        width: 1.75rem; height: 1.75rem; padding: 0; border: 0; border-radius: 0.375rem;
        background: none; color: var(--ink-faint); cursor: pointer;
        transition: color 200ms, background-color 200ms;
      }
      .copy:hover { color: var(--ink); background: var(--edge); }
      .copy .icon { width: 0.875rem; height: 0.875rem; }
      .copy .when-copied, .copy[data-copied] .when-idle { display: none; }
      .copy[data-copied] .when-copied { display: block; color: var(--win); }

      .lede { margin: 1.5rem 0 0; color: var(--ink-muted); font-size: 0.875rem; line-height: 1.625; text-wrap: pretty; }
      .league { margin-top: 1.5rem; border-bottom: 1px solid var(--edge); }
      .league th a .icon { width: 1.25rem; color: var(--ink-faint); }

      /* The standings: NFC then AFC side by side, each its divisions. */
      .conferences { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 1.5rem; margin-top: 1.5rem; }
      .conference { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
      .divisions { display: grid; gap: 1rem 1.5rem; }
      /* As wide as the site, a conference's divisions sit two by two. */
      @media (min-width: 56rem) {
        .divisions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      }
      h2 { margin: 0; color: var(--ink-muted); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.14em; }
      .division-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding-bottom: 0.25rem; }
      h3 { margin: 0; color: var(--ink-faint); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; }
      .opml {
        display: inline-flex; align-items: center; gap: 0.25rem;
        margin: -0.25rem -0.25rem -0.25rem 0; padding: 0.25rem; border-radius: 0.375rem;
        color: var(--ink-faint); font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.08em;
        transition: color 200ms, background-color 200ms;
      }
      .opml:hover { color: var(--ink-muted); background: var(--surface-raised); }
      .opml .icon { width: 0.75rem; height: 0.75rem; }

      /* On a phone, as on the site, the mark also reads as the way back. */
      .mark .back { display: none; }
      @media (max-width: 40rem) {
        .mark .back { display: block; }
      }
`;

/** The copy buttons: shown where there is a clipboard, ticked once copied. */
const SCRIPT = `
      if (navigator.clipboard) {
        for (const button of document.querySelectorAll("[data-copy]")) {
          button.hidden = false;
          button.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(button.dataset.copy);
            } catch {
              return;
            }
            button.dataset.copied = "";
            clearTimeout(button.timer);
            button.timer = setTimeout(() => delete button.dataset.copied, 1500);
          });
        }
      }
`;
