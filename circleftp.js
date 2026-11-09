/*
 * Circle FTP BDIX provider for Nuvio
 * Based on the supplied Cloudstream Kotlin provider and the user's
 * StreamBDIX/Corpse reference implementation.
 * Nuvio mediaType: "movie" or "tv". Circle FTP post.type: "singleVideo" or "series".
 */

var MAIN_API = "http://new.circleftp.net:5000";
var FALLBACK_API = "http://15.1.1.50:5000";
var USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

function cleanTitle(value) {
  return decodeHtml(String(value || ""))
    .replace(/\s*\((?:TV Series|TV Mini Series|TV Show|Miniseries)[^)]*\)\s*/ig, " ")
    .replace(/\s*\((?:19|20)\d{2}(?:\s*[–-]\s*(?:19|20)\d{2})?\)\s*$/, "")
    .replace(/\s*[-–]\s*(?:19|20)\d{2}(?:\s*[–-]\s*(?:19|20)\d{2})?\s*$/, "")
    .replace(/[._]+/g, " ")
    .replace(/[’']/g, "")
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\u0980-\u09FF ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value) {
  return cleanTitle(value).toLowerCase().replace(/[^a-z0-9\u0980-\u09FF]/g, "");
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
        .replace(/\s*[|–-]\s*TMDB.*$/i, "")
        .replace(/\s*\((?:TV Series|TV Mini Series|TV Show)[^)]*\)\s*/i, " ")
        .replace(/\s*\((?:19|20)\d{2}(?:\s*[–-]\s*(?:19|20)\d{2})?\)\s*$/, "")
        .trim();
      if (title) return cleanTitle(title);
    }
  }
  return "";
}

function tmdbPageUrl(tmdbId, mediaType) {
  var type = mediaType === "tv" || mediaType === "series" ? "tv" : "movie";
  return "https://www.themoviedb.org/" + type + "/" + encodeURIComponent(String(tmdbId));
}

function fetchText(url) {
  return fetch(url, {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, "Accept": "text/html,*/*" }
  }).then(function (response) {
    if (!response || !response.ok) throw new Error("HTTP " + (response ? response.status : "unknown"));
    return response.text();
  });
}

function fetchJson(endpoint) {
  var headers = { "User-Agent": USER_AGENT, "Accept": "application/json", "Connection": "close", "Accept-Encoding": "identity" };
  return fetch(MAIN_API + endpoint, { method: "GET", headers: headers })
    .then(function (response) {
      if (!response || !response.ok) throw new Error("Primary API HTTP " + (response ? response.status : "unknown"));
      return response.json();
    })
    .catch(function (primaryError) {
      return fetch(FALLBACK_API + endpoint, { method: "GET", headers: headers })
        .then(function (response) {
          if (!response || !response.ok) throw new Error("Fallback API HTTP " + (response ? response.status : "unknown"));
          return response.json();
        })
        .catch(function (fallbackError) {
          console.error("[Circle FTP] API failed on both hosts:", String(primaryError), String(fallbackError));
          throw fallbackError;
        });
    });
}

function searchPosts(title) {
  var endpoint = "/api/posts?searchTerm=" + encodeURIComponent(title) + "&order=desc";
  return fetchJson(endpoint).then(function (data) {
    // API normally returns { posts: [...] }; tolerate a direct array too.
    if (Array.isArray(data)) return data;
    return data && Array.isArray(data.posts) ? data.posts : [];
  });
}

function getPostDetails(id) {
  return fetchJson("/api/posts/" + encodeURIComponent(String(id)));
}

function expectedPostType(mediaType) {
  return mediaType === "tv" || mediaType === "series" ? "series" : "singleVideo";
}

function titleScore(candidate, requested) {
  var a = normalize(candidate);
  var b = normalize(requested);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.indexOf(b) === 0 || b.indexOf(a) === 0) return 90;
  if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 75;
  var aw = cleanTitle(candidate).toLowerCase().split(/\s+/);
  var bw = cleanTitle(requested).toLowerCase().split(/\s+/);
  var common = 0;
  for (var i = 0; i < bw.length; i++) {
    if (bw[i] && aw.indexOf(bw[i]) >= 0) common++;
  }
  return Math.round(60 * common / Math.max(aw.length, bw.length));
}

function choosePost(posts, requestedTitle, mediaType) {
  var wantedType = expectedPostType(mediaType);
  var best = null;
  var bestScore = 0;
  (posts || []).forEach(function (post) {
    if (!post || post.type !== wantedType) return;
    var candidateName = post.name || post.title || "";
    var score = titleScore(candidateName, requestedTitle);
    if (score > bestScore) {
      best = post;
      bestScore = score;
    }
  });
  console.log("[Circle FTP] Best", wantedType, "match score:", bestScore, best && (best.name || best.title));
  return bestScore >= 40 ? best : null;
}

function directIp(url) {
  if (!url) return "";
  var replacements = [
    ["index.circleftp.net", "15.1.4.2"], ["index2.circleftp.net", "15.1.4.5"],
    ["index1.circleftp.net", "15.1.4.9"], ["ftp3.circleftp.net", "15.1.4.7"],
    ["ftp4.circleftp.net", "15.1.1.5"], ["ftp5.circleftp.net", "15.1.1.15"],
    ["ftp6.circleftp.net", "15.1.2.3"], ["ftp7.circleftp.net", "15.1.4.8"],
    ["ftp8.circleftp.net", "15.1.2.2"], ["ftp9.circleftp.net", "15.1.2.12"],
    ["ftp10.circleftp.net", "15.1.4.3"], ["ftp11.circleftp.net", "15.1.2.6"],
    ["ftp12.circleftp.net", "15.1.2.1"], ["ftp13.circleftp.net", "15.1.1.18"],
    ["ftp15.circleftp.net", "15.1.4.12"], ["ftp17.circleftp.net", "15.1.3.8"]
  ];
  for (var i = 0; i < replacements.length; i++) {
    if (url.indexOf(replacements[i][0]) >= 0) return url.replace(replacements[i][0], replacements[i][1]);
  }
  return url;
}

function extractQuality(text) {
  var value = String(text || "").toLowerCase();
  if (value.indexOf("2160p") >= 0 || value.indexOf("4k") >= 0) return "4K";
  if (value.indexOf("1080p") >= 0) return "1080p";
  if (value.indexOf("720p") >= 0) return "720p";
  if (value.indexOf("480p") >= 0) return "480p";
  if (value.indexOf("bluray") >= 0 || value.indexOf("blu-ray") >= 0 || value.indexOf("web-dl") >= 0) return "1080p";
  if (value.indexOf("hdtv") >= 0 || value.indexOf("hdrip") >= 0) return "720p";
  return "Unknown";
}

function makeStream(url, label, isDirectIp) {
  if (!url || typeof url !== "string") return null;
  return {
    name: "Circle FTP (BDIX)",
    title: extractQuality(label) + (isDirectIp ? " [Direct IP]" : " [Domain]"),
    url: url,
    quality: extractQuality(label),
    headers: {
      "User-Agent": USER_AGENT,
      "Connection": "close",
      "Accept-Encoding": "identity"
    }
  };
}

function parseSeasonNumber(seasonName) {
    if (!seasonName) return null;

    const text = String(seasonName).trim();

    const match =
        text.match(/\bseason\s*[:#-]?\s*(\d+)\b/i) ||
        text.match(/\bs(\d+)\b/i);

    return match ? parseInt(match[1], 10) : null;
}

function parseEpisodeNumbers(title) {
    if (!title) return null;

    const text = String(title).trim();

    // S03E01, S3E1, S03.E01, S03-E01
    let match = text.match(/\bS(\d{1,2})\s*[._ -]*E\s*(\d{1,3})\b/i);

    if (match) {
        return {
            season: parseInt(match[1], 10),
            episode: parseInt(match[2], 10)
        };
    }

    // Season 3 Episode 1
    match = text.match(
        /\bSeason\s*(\d+)\s*[,.:_-]?\s*Episode\s*(\d+)\b/i
    );

    if (match) {
        return {
            season: parseInt(match[1], 10),
            episode: parseInt(match[2], 10)
        };
    }

    // Episode 1, Episode 01, Ep 1
    match = text.match(/\b(?:Episode|Ep)\s*[:#.-]?\s*(\d+)\b/i);

    if (match) {
        return {
            season: null,
            episode: parseInt(match[1], 10)
        };
    }

    return null;
}

function selectEpisode(detail, seasonNumber, episodeNumber) {
    if (!detail || !Array.isArray(detail.content)) {
        console.warn("[Circle FTP] Invalid series content");
        return null;
    }

    const wantedSeason = Number(seasonNumber);
    const wantedEpisode = Number(episodeNumber);

    // Match by the actual season name, ignoring empty placeholders.
    const season = detail.content.find(s => {
        if (!s || !Array.isArray(s.episodes) || s.episodes.length === 0) {
            return false;
        }

        return parseSeasonNumber(s.seasonName) === wantedSeason;
    });

    if (!season) {
        console.warn(
            `[Circle FTP] Season ${wantedSeason} not found`
        );
        return null;
    }

    const episodes = season.episodes;

    // First try matching the episode title.
    let selectedEpisode = episodes.find(ep => {
        if (!ep || !ep.title || !ep.link) return false;

        const parsed = parseEpisodeNumbers(ep.title);

        if (!parsed || parsed.episode !== wantedEpisode) {
            return false;
        }

        return parsed.season === null ||
            parsed.season === wantedSeason;
    });

    // Last resort: use the episode's position within the matched season.
    if (!selectedEpisode) {
        selectedEpisode = episodes[wantedEpisode - 1];
    }

    if (!selectedEpisode || !selectedEpisode.link) {
        console.warn(
            `[Circle FTP] Episode S${wantedSeason}E${wantedEpisode} not found`
        );
        return null;
    }

    console.log(
        `[Circle FTP] Selected: ${selectedEpisode.title}`
    );

    return selectedEpisode;
}

  var wantedSeason = Math.max(1, parseInt(seasonNumber, 10) || 1);
  var wantedEpisode = Math.max(1, parseInt(episodeNumber, 10) || 1);
  var season = null;

  // First use the source's explicit seasonName (e.g. "Season 1", "S:01").
  for (var i = 0; i < seasons.length; i++) {
    if (parseSeasonNumber(seasons[i] && seasons[i].seasonName) === wantedSeason) {
      season = seasons[i];
      break;
    }
  }
  // Some Circle FTP records have no numeric seasonName; retain source-order fallback.
  if (!season && seasons[wantedSeason - 1]) season = seasons[wantedSeason - 1];
  if (!season || !Array.isArray(season.episodes)) {
    console.warn("[Circle FTP] Requested season missing:", wantedSeason);
    return null;
  }

  var episodes = season.episodes;
  // Prefer explicit episode numbering in titles, including S:01E:02 and Episode 2.
  for (var j = 0; j < episodes.length; j++) {
    var parsed = parseEpisodeNumbers(episodes[j] && episodes[j].title);
    if (parsed && parsed.episode === wantedEpisode && (parsed.season === null || parsed.season === wantedSeason) && episodes[j].link) {
      return episodes[j];
    }
  }
  // The reference implementation's positional fallback handles titles without episode labels.
  var positional = episodes[wantedEpisode - 1];
  if (positional && positional.link) return positional;

  console.warn("[Circle FTP] Episode missing:", "S" + wantedSeason + "E" + wantedEpisode, "episode count:", episodes.length);
  return null;
}

function loadPost(post, mediaType, season, episode) {
  var id = post.id || post._id;
  if (id === undefined || id === null) return Promise.resolve([]);
  return getPostDetails(id).then(function (rawDetail) {
    var detail = rawDetail && rawDetail.post ? rawDetail.post : rawDetail;
    if (!detail) return [];
    var links = [];
    if (expectedPostType(mediaType) === "singleVideo" && detail.type === "singleVideo") {
      if (typeof detail.content === "string" && detail.content) links.push(detail.content);
    } else if (expectedPostType(mediaType) === "series" && detail.type === "series") {
      var selected = selectEpisode(detail, season, episode);
      if (selected && selected.link) links.push(selected.link);
    }

    var streams = [];
    var seen = {};
    links.forEach(function (url) {
      if (seen[url]) return;
      seen[url] = true;
      var primary = makeStream(url, post.quality || post.name || post.title || detail.title || url, false);
      if (primary) streams.push(primary);
      var ipUrl = directIp(url);
      if (ipUrl && ipUrl !== url && !seen[ipUrl]) {
        seen[ipUrl] = true;
        var alternate = makeStream(ipUrl, post.quality || post.name || post.title || detail.title || url, true);
        if (alternate) streams.push(alternate);
      }
    });
    return streams;
  });
}

function getStreams(tmdbId, mediaType, season, episode, optionalTitle) {
  var isTv = mediaType === "tv" || mediaType === "series";
  var resolvedTitlePromise = optionalTitle && typeof optionalTitle === "string"
    ? Promise.resolve(cleanTitle(optionalTitle))
    : fetchText(tmdbPageUrl(tmdbId, isTv ? "tv" : "movie")).then(titleFromTmdbPage);

  return resolvedTitlePromise.then(function (requestedTitle) {
    if (!requestedTitle) {
      console.warn("[Circle FTP] Could not resolve title from TMDB ID", tmdbId);
      return [];
    }
    console.log("[Circle FTP] Searching", isTv ? "series" : "movie", "title:", requestedTitle);
    return searchPosts(requestedTitle).then(function (posts) {
      console.log("[Circle FTP] Search returned", posts.length, "posts for", requestedTitle);
      var selectedPost = choosePost(posts, requestedTitle, isTv ? "tv" : "movie");
      if (!selectedPost) {
        console.warn("[Circle FTP] No matching", isTv ? "series" : "movie", "post for", requestedTitle);
        return [];
      }
      console.log("[Circle FTP] Selected source post:", selectedPost.name || selectedPost.title, selectedPost.type);
      return loadPost(selectedPost, isTv ? "tv" : "movie", season, episode);
    });
  }).catch(function (error) {
    console.error("[Circle FTP] getStreams failed:", error && error.message ? error.message : String(error));
    return [];
  });
}

if (typeof module !== "undefined") {
  module.exports = { getStreams: getStreams };
}
