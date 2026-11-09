/*
 * Circle FTP BDIX provider for Nuvio (v1.1.0)
 * Nuvio mediaType: "movie" | "tv".  Circle FTP post.type: "singleVideo" | "series".
 */
var MAIN_API = "http://new.circleftp.net:5000";
var FALLBACK_API = "http://15.1.1.50:5000";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
// Public TMDB key commonly used by Nuvio providers. If it fails, the TMDB HTML page is scraped instead.
var TMDB_API_KEY = "68e094699525b18a70bab2f86b1fa706";
var MAX_POSTS_TRIED = 4;

function decodeHtml(v) {
  return String(v || "").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

function cleanTitle(v) {
  return decodeHtml(v)
    .replace(/\s*\((?:TV Series|TV Mini Series|TV Show|Miniseries)[^)]*\)\s*/ig, " ")
    .replace(/\s*\((?:19|20)\d{2}(?:\s*[–—-]\s*(?:19|20)\d{2})?\)\s*$/, "")
    .replace(/[._]+/g, " ")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\u0980-\u09FF ]/g, " ")
    .replace(/\s+/g, " ").trim();
}
function normalize(v) { return cleanTitle(v).toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]/g, ""); }

// og:title looks like "Game of Thrones (TV Series 2011-2019) — The Movie Database (TMDB)" (EM dash!)
function titleFromTmdbPage(html) {
  var pats = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ];
  for (var i = 0; i < pats.length; i++) {
    var m = String(html || "").match(pats[i]);
    if (m && m[1]) {
      var t = decodeHtml(m[1]).replace(/\s*[|–—-]\s*(?:The Movie Database|TMDB).*$/i, "");
      t = cleanTitle(t);
      if (t) return t;
    }
  }
  return "";
}

function isTvType(t) { return t === "tv" || t === "series" || t === "show"; }

function plainJson(url) {
  return fetch(url, { method: "GET", headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } })
    .then(function (r) { if (!r || !r.ok) throw new Error("HTTP " + (r ? r.status : "?")); return r.json(); });
}
function plainText(url) {
  return fetch(url, { method: "GET", headers: { "User-Agent": USER_AGENT, "Accept": "text/html,*/*" } })
    .then(function (r) { if (!r || !r.ok) throw new Error("HTTP " + (r ? r.status : "?")); return r.text(); });
}

function fetchApi(endpoint) {
  var headers = { "User-Agent": USER_AGENT, "Accept": "application/json", "Connection": "close", "Accept-Encoding": "identity" };
  function go(base) {
    return fetch(base + endpoint, { method: "GET", headers: headers })
      .then(function (r) { if (!r || !r.ok) throw new Error(base + " HTTP " + (r ? r.status : "?")); return r.json(); });
  }
  return go(MAIN_API).catch(function (e1) {
    return go(FALLBACK_API).catch(function (e2) {
      console.error("[Circle FTP] API failed on both hosts:", String(e1), String(e2));
      throw e2;
    });
  });
}

// Returns { titles: [...], year: "2011" | "" }
function resolveTitles(tmdbId, isTv, optionalTitle) {
  var out = { titles: [], year: "" }, seen = {};
  function add(t) {
    var c = cleanTitle(t), k = normalize(c);
    if (c && !seen[k]) { seen[k] = true; out.titles.push(c); }
  }
  if (optionalTitle && typeof optionalTitle === "string") {
    add(optionalTitle);
    return Promise.resolve(out);
  }
  var type = isTv ? "tv" : "movie";
  var api = "https://api.themoviedb.org/3/" + type + "/" + encodeURIComponent(String(tmdbId)) + "?api_key=" + TMDB_API_KEY;
  return plainJson(api).then(function (d) {
    add(d.name || d.title); add(d.original_name || d.original_title);
    out.year = String((d.first_air_date || d.release_date || "")).slice(0, 4);
  }).catch(function (e) {
    console.warn("[Circle FTP] TMDB API failed:", String(e));
  }).then(function () {
    if (out.titles.length) return out;
    return plainText("https://www.themoviedb.org/" + type + "/" + encodeURIComponent(String(tmdbId)))
      .then(function (html) { add(titleFromTmdbPage(html)); return out; })
      .catch(function (e) { console.warn("[Circle FTP] TMDB page failed:", String(e)); return out; });
  });
}

function searchPosts(title) {
  return fetchApi("/api/posts?searchTerm=" + encodeURIComponent(title) + "&order=desc").then(function (d) {
    return Array.isArray(d) ? d : (d && Array.isArray(d.posts) ? d.posts : []);
  });
}

function expectedPostType(isTv) { return isTv ? "series" : "singleVideo"; }

function titleScore(candidate, requested) {
  // drop "[Dual Audio]" style tags before comparing
  var a = normalize(String(candidate || "").replace(/\[[^\]]*\]/g, ""));
  var b = normalize(requested);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.indexOf(b) === 0 || b.indexOf(a) === 0) return 70;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 55;
  var aw = cleanTitle(candidate).toLowerCase().split(/\s+/), bw = cleanTitle(requested).toLowerCase().split(/\s+/), c = 0;
  for (var i = 0; i < bw.length; i++) if (bw[i] && aw.indexOf(bw[i]) >= 0) c++;
  return Math.round(50 * c / Math.max(aw.length, bw.length));
}

// Returns ordered list of candidate posts (all exact matches, else the single best partial match).
function rankPosts(posts, titles, isTv, year) {
  var wanted = expectedPostType(isTv), seen = {}, scored = [];
  (posts || []).forEach(function (p) {
    if (!p || p.type !== wanted) return;
    var id = p.id !== undefined ? p.id : p._id;
    if (id === undefined || id === null || seen[id]) return;
    seen[id] = true;
    var name = p.name || p.title || "", best = 0;
    titles.forEach(function (t) { best = Math.max(best, titleScore(name, t)); });
    if (year && best >= 95 && String(name).indexOf(year) >= 0) best += 1;
    scored.push({ post: p, score: best });
  });
  scored.sort(function (x, y) { return y.score - x.score; });
  if (!scored.length) return [];
  if (scored[0].score >= 95) return scored.filter(function (s) { return s.score >= 95; }).map(function (s) { return s.post; });
  return scored[0].score >= 40 ? [scored[0].post] : [];
}

var IP_MAP = [
  ["index.circleftp.net", "15.1.4.2"], ["index2.circleftp.net", "15.1.4.5"], ["index1.circleftp.net", "15.1.4.9"],
  ["ftp3.circleftp.net", "15.1.4.7"], ["ftp4.circleftp.net", "15.1.1.5"], ["ftp5.circleftp.net", "15.1.1.15"],
  ["ftp6.circleftp.net", "15.1.2.3"], ["ftp7.circleftp.net", "15.1.4.8"], ["ftp8.circleftp.net", "15.1.2.2"],
  ["ftp9.circleftp.net", "15.1.2.12"], ["ftp10.circleftp.net", "15.1.4.3"], ["ftp11.circleftp.net", "15.1.2.6"],
  ["ftp12.circleftp.net", "15.1.2.1"], ["ftp13.circleftp.net", "15.1.1.18"], ["ftp15.circleftp.net", "15.1.4.12"],
  ["ftp17.circleftp.net", "15.1.3.8"]
];
function directIp(url) {
  for (var i = 0; i < IP_MAP.length; i++) if (url.indexOf("//" + IP_MAP[i][0]) >= 0) return url.replace(IP_MAP[i][0], IP_MAP[i][1]);
  return url;
}

function extractQuality(text) {
  var v = String(text || "").toLowerCase();
  if (v.indexOf("2160p") >= 0 || v.indexOf("4k") >= 0) return "4K";
  if (v.indexOf("1080p") >= 0) return "1080p";
  if (v.indexOf("720p") >= 0) return "720p";
  if (v.indexOf("480p") >= 0) return "480p";
  if (v.indexOf("bluray") >= 0 || v.indexOf("blu-ray") >= 0 || v.indexOf("web-dl") >= 0) return "1080p";
  if (v.indexOf("hdtv") >= 0 || v.indexOf("hdrip") >= 0) return "720p";
  return "Unknown";
}

function makeStream(url, label, qualityText, isIp) {
  var q = extractQuality(qualityText);
  return {
    name: "Circle FTP (BDIX)",
    title: (label ? label + " - " : "") + q + (isIp ? " [Direct IP]" : ""),
    url: url,
    quality: q,
    headers: { "User-Agent": USER_AGENT, "Connection": "close", "Accept-Encoding": "identity" }
  };
}

/* ---------- season / episode parsing ---------- */
function parseSeasonNumber(name) {
  var t = String(name || "").trim();
  var m = t.match(/\bseason\s*[:#._-]?\s*(\d+)/i) || t.match(/^s\s*[:#._-]?\s*(\d+)\b/i) || t.match(/^(\d+)$/);
  return m ? parseInt(m[1], 10) : null;
}
// Works on episode titles and on file names / URLs. Returns {season|null, episode} or null.
function parseEpisodeNumbers(text) {
  var t = decodeURIComponentSafe(String(text || ""));
  var m = t.match(/(?:^|[^a-z0-9])s\s*:?\s*(\d{1,2})\s*[.\s:_-]*e\s*:?\s*(\d{1,3})(?!\d)/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = t.match(/season\s*(\d+)\s*[,.: _-]*\s*episode\s*(\d+)/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = t.match(/(?:^|[^0-9a-z])(\d{1,2})x(\d{1,3})(?![0-9])/i);
  if (m) return { season: +m[1], episode: +m[2] };
  m = t.match(/episode\s*[:#._-]?\s*(\d+)/i) || t.match(/(?:^|[^a-z])ep\.?\s*[:#._-]?\s*(\d+)/i) || t.match(/(?:^|[^a-z0-9])e\s*:?\s*(\d{1,3})(?![0-9])/i);
  if (m) return { season: null, episode: +m[1] };
  return null;
}
function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
function fileName(url) { var p = String(url || "").split("?")[0].split("/"); return p[p.length - 1] || ""; }
function episodeInfo(ep) {
  return parseEpisodeNumbers(ep && ep.title) || parseEpisodeNumbers(fileName(ep && ep.link));
}

// Ignores empty placeholder seasons so they can never shift numbering.
function selectEpisode(detail, seasonNumber, episodeNumber) {
  var all = detail && Array.isArray(detail.content) ? detail.content : [];
  var real = all.filter(function (s) { return s && Array.isArray(s.episodes) && s.episodes.length; });
  if (!real.length) { console.warn("[Circle FTP] No seasons with episodes"); return null; }
  var wantS = parseInt(seasonNumber, 10) || 1, wantE = parseInt(episodeNumber, 10) || 1;

  var labelled = real.map(function (s) {
    var n = parseSeasonNumber(s.seasonName);
    if (n === null) {
      for (var i = 0; i < s.episodes.length; i++) {
        var info = episodeInfo(s.episodes[i]);
        if (info && info.season !== null) { n = info.season; break; }
      }
    }
    return { season: s, num: n };
  });
  var target = null;
  labelled.forEach(function (l) { if (!target && l.num === wantS) target = l.season; });
  if (!target) {
    var anyNumbered = labelled.some(function (l) { return l.num !== null; });
    if (!anyNumbered && real[wantS - 1]) target = real[wantS - 1]; // fully unlabelled: order fallback
  }
  if (!target) { console.warn("[Circle FTP] Season", wantS, "not found"); return null; }

  var eps = target.episodes, anyNumberedEp = false;
  for (var j = 0; j < eps.length; j++) {
    var info = episodeInfo(eps[j]);
    if (info) {
      anyNumberedEp = true;
      if (info.episode === wantE && (info.season === null || info.season === wantS) && eps[j].link) return eps[j];
    }
  }
  if (!anyNumberedEp && eps[wantE - 1] && eps[wantE - 1].link) return eps[wantE - 1]; // titles carry no numbers
  console.warn("[Circle FTP] Episode S" + wantS + "E" + wantE + " not found");
  return null;
}

function loadPost(post, isTv, season, episode, requestedTitle) {
  var id = post.id !== undefined ? post.id : post._id;
  return fetchApi("/api/posts/" + encodeURIComponent(String(id))).then(function (raw) {
    var detail = raw && raw.post ? raw.post : raw;
    if (!detail) return [];
    var found = null, label = requestedTitle;
    if (!isTv && detail.type === "singleVideo" && typeof detail.content === "string" && detail.content) {
      found = detail.content;
    } else if (isTv && detail.type === "series") {
      var ep = selectEpisode(detail, season, episode);
      if (ep) {
        found = ep.link;
        label = requestedTitle + " S" + ("0" + season).slice(-2) + "E" + ("0" + episode).slice(-2);
      }
    }
    if (!found) return [];
    var q = found + " " + (post.name || post.title || "");
    var streams = [makeStream(found, label, q, false)];
    var ip = directIp(found);
    if (ip !== found) streams.push(makeStream(ip, label, q, true));
    return streams;
  });
}

function getStreams(tmdbId, mediaType, season, episode, optionalTitle) {
  var isTv = isTvType(mediaType);
  return resolveTitles(tmdbId, isTv, optionalTitle).then(function (info) {
    if (!info.titles.length) { console.warn("[Circle FTP] Could not resolve title for", tmdbId); return []; }
    console.log("[Circle FTP] Titles:", info.titles.join(" | "), "type:", isTv ? "series" : "movie");
    var all = [], idx = 0;
    function searchNext() {
      if (idx >= info.titles.length) return Promise.resolve(all);
      return searchPosts(info.titles[idx++]).then(function (p) { all = all.concat(p); return searchNext(); },
        function (e) { console.warn("[Circle FTP] search failed:", String(e)); return searchNext(); });
    }
    return searchNext().then(function (posts) {
      var candidates = rankPosts(posts, info.titles, isTv, info.year).slice(0, MAX_POSTS_TRIED);
      console.log("[Circle FTP] Candidate posts:", candidates.map(function (p) { return p.id + ":" + (p.name || p.title); }).join(" ; "));
      var i = 0;
      function tryNext() {
        if (i >= candidates.length) return Promise.resolve([]);
        var post = candidates[i++];
        return loadPost(post, isTv, season, episode, info.titles[0]).then(function (s) {
          return s.length ? s : tryNext();
        }, function (e) { console.warn("[Circle FTP] post failed:", String(e)); return tryNext(); });
      }
      return tryNext();
    });
  }).catch(function (e) {
    console.error("[Circle FTP] getStreams failed:", e && e.message ? e.message : String(e));
    return [];
  });
}

if (typeof module !== "undefined") {
  module.exports = { getStreams: getStreams, selectEpisode: selectEpisode, titleFromTmdbPage: titleFromTmdbPage, parseEpisodeNumbers: parseEpisodeNumbers };
}
if (typeof global !== "undefined") { global.getStreams = getStreams; }
