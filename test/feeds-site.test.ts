import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSite } from "../src/feeds-site.ts";
import { NFL_CONFERENCES } from "../src/nfl/divisions.ts";
import { NFL_TEAMS } from "../src/nfl/teams.ts";

const site = buildSite({
  league: "nfl",
  leagueName: "NFL",
  teams: NFL_TEAMS,
  conferences: NFL_CONFERENCES,
  baseUrl: "https://example.test/feeds/",
});
const page = site.get("index.html")!;

function feedUrls(opml: string): string[] {
  return [...opml.matchAll(/xmlUrl="([^"]+)"/g)].map((m) => m[1]!);
}

describe("the league's alignment", () => {
  it("places every team in one division of four", () => {
    const placed = NFL_CONFERENCES.flatMap((conference) =>
      conference.divisions.flatMap((division) => {
        assert.equal(division.teams.length, 4);
        return division.teams;
      }),
    );
    assert.deepEqual(
      [...placed].sort(),
      NFL_TEAMS.map((team) => team.abbreviation).sort(),
    );
  });
});

describe("OPML", () => {
  const opmls = [...site.keys()].filter((path) => path.endsWith(".opml"));

  it("writes one file per division, NFC then AFC, North to West", () => {
    assert.deepEqual(opmls, [
      "nfl/nfc-north.opml",
      "nfl/nfc-east.opml",
      "nfl/nfc-south.opml",
      "nfl/nfc-west.opml",
      "nfl/afc-north.opml",
      "nfl/afc-east.opml",
      "nfl/afc-south.opml",
      "nfl/afc-west.opml",
    ]);
  });

  it("lists a division's four feeds in one folder, as the standings order them", () => {
    const north = site.get("nfl/nfc-north.opml")!;
    assert.match(north, /<opml version="2\.0">/);
    assert.match(north, /<title>NFC North recaps<\/title>/);
    assert.match(
      north,
      /<body>\s*<outline text="NFC North" title="NFC North">/,
    );
    // Alphabetical by nickname: Bears, Lions, Packers, Vikings.
    assert.deepEqual(feedUrls(north), [
      "https://example.test/feeds/nfl/chi.atom",
      "https://example.test/feeds/nfl/det.atom",
      "https://example.test/feeds/nfl/gb.atom",
      "https://example.test/feeds/nfl/min.atom",
    ]);
    assert.match(
      north,
      /type="rss" text="Chicago Bears recaps" title="Chicago Bears recaps"[^>]*htmlUrl="https:\/\/quiet-football\.com\/team\/CHI"/,
    );
  });

  it("covers every team once", () => {
    const all = opmls.flatMap((path) => feedUrls(site.get(path)!));
    assert.equal(all.length, NFL_TEAMS.length);
    assert.equal(new Set(all).size, NFL_TEAMS.length);
  });
});

describe("the index", () => {
  it("links every team's feed, NFC before AFC", () => {
    for (const team of NFL_TEAMS) {
      assert.ok(
        page.includes(`href="nfl/${team.abbreviation.toLowerCase()}.atom"`),
      );
    }
    assert.ok(
      page.indexOf('id="conference-NFC"') < page.indexOf('id="conference-AFC"'),
    );
    for (const path of [...site.keys()].filter((p) => p.endsWith(".opml"))) {
      assert.ok(page.includes(`href="${path}" download`));
    }
  });

  it("advertises the league's feed and wears the site's icon", () => {
    assert.match(
      page,
      /rel="alternate" type="application\/atom\+xml"[^>]*href="https:\/\/example\.test\/feeds\/nfl\/all\.atom"/,
    );
    assert.match(page, /<link rel="icon" href="icon\.svg"/);
    assert.match(page, /<link rel="apple-touch-icon" href="apple-icon\.png"/);
  });

  it("is titled as Quiet Football titles its pages", () => {
    assert.match(page, /<title>Recap feeds \| Quiet Football<\/title>/);
  });

  it("leads back to Quiet Football from its header, and nowhere else", () => {
    const links = [
      ...page.matchAll(/href="(https:\/\/quiet-football\.com[^"]*)"/g),
    ];
    assert.equal(links.length, 1);
    assert.ok(page.indexOf(links[0]![0]) < page.indexOf("</header>"));
  });

  it("links the source data from its footer", () => {
    const footer = page.slice(
      page.indexOf("<footer>"),
      page.indexOf("</footer>"),
    );
    assert.match(
      footer,
      /href="https:\/\/github\.com\/dfrancour\/quiet-football-recap-data">.*Source data on GitHub/,
    );
  });

  it("offers the feed of every game beside its sentence", () => {
    assert.match(
      page,
      /<div class="all-games">\s*<a href="nfl\/all\.atom">.*Every NFL game.*data-copy="https:\/\/example\.test\/feeds\/nfl\/all\.atom"/,
    );
  });

  it("describes itself as Quiet Football's pages do", () => {
    assert.match(
      page,
      /<link rel="canonical" href="https:\/\/example\.test\/feeds\/">/,
    );
    assert.match(
      page,
      /<meta property="og:title" content="Recap feeds \| Quiet Football">/,
    );
    assert.match(
      page,
      /<meta property="og:image" content="https:\/\/quiet-football\.com\/og\.png">/,
    );
    assert.match(
      page,
      /<meta name="twitter:card" content="summary_large_image">/,
    );
    const jsonLd =
      /<script type="application\/ld\+json">([^<]+)<\/script>/.exec(page)?.[1];
    assert.deepEqual(JSON.parse(jsonLd!).isPartOf, {
      "@type": "WebSite",
      name: "Quiet Football",
      url: "https://quiet-football.com/",
    });
  });

  it("offers every feed to a reader given the page, the league's first", () => {
    const feeds = [
      ...page.matchAll(
        /<link rel="alternate" type="application\/atom\+xml" title="([^"]+)" href="([^"]+)">/g,
      ),
    ];
    assert.equal(feeds.length, NFL_TEAMS.length + 1);
    assert.equal(feeds[0]![1], "NFL recaps");
    assert.ok(
      feeds.some(
        (m) =>
          m[1] === "Kansas City Chiefs recaps" &&
          m[2] === "https://example.test/feeds/nfl/kc.atom",
      ),
    );
  });

  it("copies a feed's full address", () => {
    assert.ok(
      page.includes('data-copy="https://example.test/feeds/nfl/kc.atom"'),
    );
  });
});
