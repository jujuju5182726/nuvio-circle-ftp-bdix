/*
 * Circle FTP (BDIX) provider for Nuvio
 * Ported from the supplied Cloudstream CircleFtpProvider.kt.
 *
 * Nuvio plugins return streams only. They do not provide Cloudstream-style
 * category/home-page browsing. Nuvio calls getStreams(tmdbId, mediaType,
 * season, episode); an optional title argument is also accepted for testing.
 */

var MAIN_API = "http://new.circleftp.net:5000";
var FALLBACK_API = "http://15.1.1.50:5000";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

function cleanTitle(value) {
  return String(value || "")
    .replace(/\s*\((19|20)\d{2}\)\s*$/, "")
    .replace(/\s*-\s*(19|20)\d{2}\s*$/, "")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

function titleFromTmdbPage(html) {
  var candidates = [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ];
  for (var i = 0; i < candidates.length; i++) {
    var match = String(html || "").match(candidates[i]);
    if (match && match[1]) {
      var title = decodeHtml(match[1])
        .replace(/\s*[|–-]\s*The Movie Database.*$/i, "")
        .replace(/\s*-\s*TMDB.*$/i, "")
        .replace(/\s*\(\d{4}\)\s*$/, "")
        .trim();
      if (title) return title;
    }
  }
  return "";
}

function tmdbPageUrl(tmdbId, mediaType) {
  var type = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
  return "https://www.themoviedb.org/" + type + "/" + encodeURIComponent(String(tmdbId));
}

function fetchText(url, headers) {
  return fetch(url, { method: "GET", headers: headers || { "User-Agent": USER_AGENT } })
    .then(function (response) {
      if (!response || !response.ok) {
        throw new Error("HTTP " + (response ? response.status : "unknown") + " for " + url);
      }
      return response.text();
    });
}

function fetchJson(endpoint) {
  var url = MAIN_API + endpoint;
  return fetch(url, { method: "GET", headers: { "User-Agent": USER_AGENT, "Accept": "application/json" } })
    .then(function (response) {
      if (!response || !response.ok) throw new Error("Primary Circle FTP API unavailable");
      return response.json();
    })
    .catch(function () {
      return fetch(FALLBACK_API + endpoint, {
        method: "GET",
        headers: { "User-Agent": USER_AGENT, "Accept": "application/json" }
      }).then(function (response) {
        if (!response || !response.ok) throw new Error("Circle FTP API unavailable on primary and fallback hosts");
        return response.json();
      });
    });
}

function getPostsByTitle(title) {
  var endpoint = "/api/posts?searchTerm=" + encodeURIComponent(title) + "&order=desc";
  return fetchJson(endpoint).then(function (data) {
    return data && Array.isArray(data.posts) ? data.posts : [];
  });
}

function scoreMatch(candidate, requested) {
  var a = cleanTitle(candidate).toLowerCase();
  var b = cleanTitle(requested).toLowerCase();
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.indexOf(b) === 0 || b.indexOf(a) === 0) return 80;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 60;
  var aw = a.split(" ");
  var bw = b.split(" ");
  var common = 0;
  for (var i = 0; i < bw.length; i++) if (aw.indexOf(bw[i]) >= 0) common++;
  return Math.round(50 * common / Math.max(aw.length, bw.length));
}

function choosePost(posts, title) {
  var best = null;
  var bestScore = 0;
  (posts || []).forEach(function (post) {
    if (!post || (post.type !== "singleVideo" && post.type !== "series")) return;
    var score = scoreMatch(post.title, title);
    if (score > bestScore) {
      best = post;
      bestScore = score;
    }
  });
  // Avoid returning an obviously unrelated result.
  return bestScore >= 45 ? best : null;
}

function directIp(url) {
  if (!url) return "";
  var replacements = [
    ["index.circleftp.net", "15.1.4.2"],
    ["index2.circleftp.net", "15.1.4.5"],
    ["index1.circleftp.net", "15.1.4.9"],
    ["ftp3.circleftp.net", "15.1.4.7"],
    ["ftp4.circleftp.net", "15.1.1.5"],
    ["ftp5.circleftp.net", "15.1.1.15"],
    ["ftp6.circleftp.net", "15.1.2.3"],
    ["ftp7.circleftp.net", "15.1.4.8"],
    ["ftp8.circleftp.net", "15.1.2.2"],
    ["ftp9.circleftp.net", "15.1.2.12"],
    ["ftp10.circleftp.net", "15.1.4.3"],
    ["ftp11.circleftp.net", "15.1.2.6"],
    ["ftp12.circleftp.net", "15.1.2.1"],
    ["ftp13.circleftp.net", "15.1.1.18"],
    ["ftp15.circleftp.net", "15.1.4.12"],
    ["ftp17.circleftp.net", "15.1.3.8"]
  ];
  for (var i = 0; i < replacements.length; i++) {
    if (url.indexOf(replacements[i][0]) >= 0) {
      return url.replace(replacements[i][0], replacements[i][1]);
    }
  }
  return url;
}

function qualityFromTitle(title) {
  var value = String(title || "").toLowerCase();
  if (value.indexOf("2160") >= 0 || value.indexOf("4k") >= 0) return "4K";
  if (value.indexOf("1080") >= 0 || value.indexOf("bluray") >= 0 || value.indexOf("web-dl") >= 0) return "1080p";
  if (value.indexOf("720") >= 0 || value.indexOf("hd") >= 0 || value.indexOf("hdtv") >= 0) return "720p";
  if (value.indexOf("cam") >= 0) return "CAM";
  return "Unknown";
}

function makeStream(url, label, index) {
  if (!url || typeof url !== "string") return null;
  var headers = {
    "User-Agent": USER_AGENT,
    "Connection": "close",
    "Accept-Encoding": "identity"
  };
  return {
    name: "Circle FTP (BDIX)",
    title: label + (index ? " [Direct IP]" : " [Domain]"),
    url: url,
    quality: qualityFromTitle(label),
    headers: headers
  };
}

function selectEpisode(seriesData, seasonNumber, episodeNumber) {
  var seasons = seriesData && Array.isArray(seriesData.content) ? seriesData.content : [];
  var seasonIndex = Math.max(0, Number(seasonNumber || 1) - 1);
  var episodeIndex = Math.max(0, Number(episodeNumber || 1) - 1);
  var season = seasons[seasonIndex];
  if (!season || !Array.isArray(season.episodes)) return null;
  return season.episodes[episodeIndex] || null;
}

function loadPost(post, mediaType, season, episode) {
  return fetchJson("/api/posts/" + encodeURIComponent(String(post.id))).then(function (data) {
    if (!data || !data.type) return [];
    var links = [];
    if (data.type === "singleVideo") {
      var movieUrl = typeof data.content === "string" ? data.content : "";
      if (movieUrl) links.push(movieUrl);
    } else if (data.type === "series") {
      var selected = selectEpisode(data, season, episode);
      if (selected && selected.link) links.push(selected.link);
    }

    var streams = [];
    links.forEach(function (url) {
      var domain = makeStream(url, post.title || data.title || "Circle FTP", 0);
      if (domain) streams.push(domain);
      var ip = directIp(url);
      if (ip && ip !== url) {
        var direct = makeStream(ip, post.title || data.title || "Circle FTP", 1);
        if (direct) streams.push(direct);
      }
    });
    return streams;
  });
}

function getStreams(tmdbId, mediaType, season, episode, title) {
  var requestedTitle = title && typeof title === "string" ? title : "";
  var titlePromise;
  if (requestedTitle) {
    titlePromise = Promise.resolve(requestedTitle);
  } else {
    titlePromise = fetchText(tmdbPageUrl(tmdbId, mediaType))
      .then(titleFromTmdbPage);
  }

  return titlePromise.then(function (resolvedTitle) {
    if (!resolvedTitle) {
      console.warn("[Circle FTP] Could not resolve TMDB title for ID " + tmdbId);
      return [];
    }
    return getPostsByTitle(resolvedTitle).then(function (posts) {
      var post = choosePost(posts, resolvedTitle);
      if (!post) {
        console.log("[Circle FTP] No confident Circle FTP match for: " + resolvedTitle);
        return [];
      }
      return loadPost(post, mediaType, season, episode);
    });
  }).catch(function (error) {
    console.error("[Circle FTP] " + (error && error.message ? error.message : String(error)));
    return [];
  });
}

if (typeof module !== "undefined") {
  module.exports = { getStreams: getStreams };
}
