// Offline tests: global.fetch is mocked and every request the provider makes goes through it.
const assert = require("assert");
const { getStreams, titleFromTmdbPage } = require("../providers/circleftp.js");

const HOST = "http://ftp4.circleftp.net/FILE/English%20%26%20Foreign%20TV%20Series/Game%20of%20Thrones%20%28TV%20Series%202011-2019%29";
const pad = n => String(n).padStart(2, "0");
const season = (name, s, count, base, prefix) => ({
  seasonName: name,
  episodes: Array.from({ length: count }, (_, i) => ({
    title: `${prefix} S${s}E${i + 1}`,
    link: `${base}/Season%20${s}%201080p/${prefix.toLowerCase().replace(/ /g, ".")}.s${pad(s)}e${pad(i + 1)}.1080p.bluray.x264-rovers.mkv`
  }))
});
const PLACEHOLDER = { episodes: [], seasonName: "" };

const DB = {
  search: {
    "game of thrones": [
      { id: 97657, name: "Game of Thrones (TV Series 2011-2019)", type: "series" },
      { id: 96981, name: "Game of Thrones (TV Series 2011-2019) [Dual Audio]", type: "series" },
      { id: 11, name: "Game of Thrones: Conquest & Rebellion (Movie)", type: "singleVideo" }
    ],
    "dexter": [
      { id: 500, name: "Dexter: New Blood (TV Series 2021-2022)", type: "series" },
      { id: 501, name: "Dexter (TV Series 2006-2013)", type: "series" }
    ],
    "inception": [{ id: 700, name: "Inception (2010)", type: "singleVideo" }, { id: 701, name: "Inception (TV Series 2020)", type: "series" }],
    "mystery show": [{ id: 800, name: "Mystery Show (TV Series 2019)", type: "series" }],
    "split show": [
      { id: 900, name: "Split Show (TV Series 2015)", type: "series" },
      { id: 901, name: "Split Show (TV Series 2015) [Dual Audio]", type: "series" }
    ]
  },
  posts: {
    // placeholder FIRST and in the middle, to prove it cannot shift numbering
    97657: { id: 97657, type: "series", content: [PLACEHOLDER, season("Season 1", 1, 10, HOST, "Game of Thrones"), season("Season 2", 2, 10, HOST, "Game of Thrones"), season("Season 3", 3, 10, HOST, "Game of Thrones"), PLACEHOLDER, season("Season 4", 4, 10, HOST, "Game of Thrones")] },
    96981: { id: 96981, type: "series", content: [season("Season 1", 1, 3, HOST + "DA", "Game of Thrones DA")] },
    500: { id: 500, type: "series", content: [season("Season 1", 1, 3, "http://ftp9.circleftp.net/Dexter%20New%20Blood", "Dexter New Blood")] },
    501: { id: 501, type: "series", content: [season("Season 1", 1, 12, "http://ftp9.circleftp.net/Dexter", "Dexter"), season("Season 2", 2, 12, "http://ftp9.circleftp.net/Dexter", "Dexter")] },
    700: { id: 700, type: "singleVideo", content: "http://ftp3.circleftp.net/FILE/Movies/Inception.2010.1080p.BluRay.mkv" },
    800: { id: 800, type: "series", content: [{ seasonName: "Season 1", episodes: [
      { title: "Pilot", link: "http://ftp5.circleftp.net/m/pilot.mkv" },
      { title: "The Second One", link: "http://ftp5.circleftp.net/m/second.mkv" },
      { title: "Finale", link: "http://ftp5.circleftp.net/m/finale.mkv" } ] }] },
    900: { id: 900, type: "series", content: [season("Season 1", 1, 2, "http://ftp6.circleftp.net/split", "Split Show")] },
    901: { id: 901, type: "series", content: [season("Season 1", 1, 6, "http://ftp6.circleftp.net/splitDA", "Split Show DA")] }
  },
  tmdbTv: { 1399: { name: "Game of Thrones", first_air_date: "2011-04-17" }, 1405: { name: "Dexter", first_air_date: "2006-10-01" }, 7: { name: "Mystery Show" }, 8: { name: "Split Show" } },
  tmdbMovie: { 27205: { title: "Inception", release_date: "2010-07-15" } }
};

let calls;
function mockFetch(opts = {}) {
  global.fetch = async (url) => {
    url = String(url); calls.push(url);
    const json = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    let m;
    if ((m = url.match(/^http:\/\/(?:new\.circleftp\.net|15\.1\.1\.50):5000\/api\/posts\?searchTerm=([^&]*)/))) {
      if (opts.primaryDown && url.includes("new.circleftp.net")) throw new Error("ECONNREFUSED");
      return json({ posts: DB.search[decodeURIComponent(m[1]).toLowerCase()] || [] });
    }
    if ((m = url.match(/^http:\/\/(?:new\.circleftp\.net|15\.1\.1\.50):5000\/api\/posts\/(\d+)$/))) {
      if (opts.primaryDown && url.includes("new.circleftp.net")) throw new Error("ECONNREFUSED");
      return DB.posts[m[1]] ? json(DB.posts[m[1]]) : { ok: false, status: 404 };
    }
    if ((m = url.match(/api\.themoviedb\.org\/3\/(tv|movie)\/(\d+)/))) {
      if (opts.tmdbApiDown) return { ok: false, status: 500 };
      const r = (m[1] === "tv" ? DB.tmdbTv : DB.tmdbMovie)[m[2]];
      return r ? json(r) : { ok: false, status: 404 };
    }
    if ((m = url.match(/www\.themoviedb\.org\/(tv|movie)\/(\d+)/))) {
      return { ok: true, status: 200, text: async () => `<html><head><meta property="og:title" content="Game of Thrones (TV Series 2011-2019) — The Movie Database (TMDB)"></head></html>` };
    }
    throw new Error("UNMOCKED URL " + url);
  };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("GoT S03E01 via TMDB id only (Nuvio passes no title) - full request sequence", async () => {
  const s = await getStreams("1399", "tv", 3, 1);
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].url, HOST + "/Season%203%201080p/game.of.thrones.s03e01.1080p.bluray.x264-rovers.mkv");
  assert.strictEqual(s[0].quality, "1080p");
  assert.ok(s[1].url.startsWith("http://15.1.1.5/FILE/"), "private-IP alternate");
  const order = calls.map(u => u.replace(/^https?:\/\/[^/]+/, "").split("?")[0]);
  assert.ok(calls[0].includes("api.themoviedb.org/3/tv/1399"));
  assert.ok(calls.some(u => u.includes("searchTerm=Game%20of%20Thrones")));
  assert.ok(order.includes("/api/posts/97657"));
  assert.ok(!order.includes("/api/posts/96981"), "no need to open second post");
});
test("GoT S03E02", async () => {
  const s = await getStreams("1399", "tv", 3, 2, "Game of Thrones");
  assert.ok(s[0].url.endsWith("game.of.thrones.s03e02.1080p.bluray.x264-rovers.mkv"));
});
test("GoT S04E01 despite empty placeholder seasons", async () => {
  const s = await getStreams("1399", "tv", 4, 1, "Game of Thrones");
  assert.ok(s[0].url.includes("Season%204") && s[0].url.endsWith("s04e01.1080p.bluray.x264-rovers.mkv"));
});
test("GoT S01E01 (placeholder before season 1)", async () => {
  const s = await getStreams("1399", "tv", 1, 1, "Game of Thrones");
  assert.ok(s[0].url.includes("Season%201") && s[0].url.endsWith("s01e01.1080p.bluray.x264-rovers.mkv"));
});
test("Dexter picks Dexter, not Dexter: New Blood", async () => {
  const s = await getStreams("1405", "tv", 2, 5);
  assert.ok(s[0].url.includes("/Dexter/") && s[0].url.endsWith("s02e05.1080p.bluray.x264-rovers.mkv"));
  assert.ok(!calls.some(u => u.endsWith("/api/posts/500")));
});
test("Movie", async () => {
  const s = await getStreams("27205", "movie");
  assert.strictEqual(s[0].url, "http://ftp3.circleftp.net/FILE/Movies/Inception.2010.1080p.BluRay.mkv");
  assert.ok(s[1].url.startsWith("http://15.1.4.7/"));
  assert.ok(!calls.some(u => u.endsWith("/api/posts/701")), "TV post must not be opened for a movie");
});
test("Missing episode returns [] (and does not return a wrong episode)", async () => {
  assert.deepStrictEqual(await getStreams("1399", "tv", 3, 99, "Game of Thrones"), []);
  assert.deepStrictEqual(await getStreams("1399", "tv", 9, 1, "Game of Thrones"), []);
});
test("Episode titles without season/episode numbers use position", async () => {
  const s = await getStreams("7", "tv", 1, 2);
  assert.strictEqual(s[0].url, "http://ftp5.circleftp.net/m/second.mkv");
});
test("First post lacks the episode, second post has it", async () => {
  const s = await getStreams("8", "tv", 1, 5);
  assert.ok(s[0].url.includes("splitDA") && s[0].url.endsWith("s01e05.1080p.bluray.x264-rovers.mkv"));
  const opened = calls.filter(u => /\/api\/posts\/\d+$/.test(u)).map(u => u.split("/").pop());
  assert.deepStrictEqual(opened, ["900", "901"]);
});
test("TMDB API down -> falls back to TMDB HTML page with em-dash og:title", async () => {
  mockFetch({ tmdbApiDown: true });
  const s = await getStreams("1399", "tv", 3, 1);
  assert.ok(s[0].url.endsWith("s03e01.1080p.bluray.x264-rovers.mkv"));
});
test("titleFromTmdbPage strips the em-dash suffix (likely original bug)", () => {
  assert.strictEqual(titleFromTmdbPage('<meta property="og:title" content="Game of Thrones (TV Series 2011-2019) — The Movie Database (TMDB)">'), "Game of Thrones");
  assert.strictEqual(titleFromTmdbPage('<meta property="og:title" content="Inception (2010) — The Movie Database (TMDB)">'), "Inception");
});
test("Primary API down -> fallback host used", async () => {
  mockFetch({ primaryDown: true });
  const s = await getStreams("1399", "tv", 3, 1, "Game of Thrones");
  assert.ok(s.length === 2 && calls.some(u => u.startsWith("http://15.1.1.50:5000")));
});
test("Unknown show returns []", async () => {
  assert.deepStrictEqual(await getStreams("1399", "tv", 1, 1, "Nonexistent Show Zzz"), []);
});

(async () => {
  const log = console.log; let fail = 0;
  for (const [name, fn] of tests) {
    calls = []; mockFetch();
    console.log = console.warn = console.error = () => {};
    try { await fn(); console.log = log; log("PASS", name); }
    catch (e) { console.log = log; fail++; log("FAIL", name, "\n   ", e.message); }
  }
  log(`\n${tests.length - fail}/${tests.length} passed (offline, mocked API)`);
  process.exit(fail ? 1 : 0);
})();
