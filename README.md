# Circle FTP BDIX for Nuvio (v1.1.0)

A Nuvio **stream provider** (not a catalog). Movies -> Circle FTP `singleVideo`, TV -> `series`.

## Install
1. Push this folder to the root of a public Git repo (`manifest.json` and `providers/circleftp.js` at those exact paths).
2. In Nuvio, add the repo's raw URL for `manifest.json` as a plugin repository.
3. Enable "Circle FTP BDIX". Streams only play on BDIX-capable networks.

## What changed in 1.1.0 (Game of Thrones fix)
- **Title resolution (the reproduced failure):** the old code scraped the TMDB HTML page; the `og:title` ends in an *em dash* ("— The Movie Database (TMDB)"), which the suffix-stripping regex did not handle. The search term became `Game of Thrones The Movie Database TMDB` -> 0 results -> no streams. Now the TMDB JSON API is used first, the HTML page is a fallback, and the em dash is handled.
- Empty placeholder seasons (`seasonName: ""`, `episodes: []`) are ignored and can never shift season numbering or trigger positional fallback.
- Episode matching: `S3E1`, `S:01E:02`, `Season 3 Episode 1`, `3x01`, `Episode 1`, `Ep 1`, plus the season/episode in the file name. Positional fallback is used **only** when no episode title/file name carries a number, so a missing episode returns nothing instead of a wrong one.
- All exact-title posts are tried in order (e.g. normal then `[Dual Audio]`) until one has the episode. Partial matches like "Dexter: New Blood" are not used when an exact match exists.
- Original FTP URL is always returned first; the private-IP URL is an extra alternative.

## Tests
`npm test` (Node 18+). 13 **offline** tests with a mocked `fetch` covering the full request sequence (TMDB -> search -> post details -> season/episode -> streams): GoT S03E01/S03E02/S04E01, Dexter, a movie, a missing episode, unnumbered episode titles, multi-post fallback, TMDB/API fallbacks.

## Not verified
- Not tested against the live Circle FTP API (it is BDIX-only) or the live TMDB API/page.
- Not tested inside a real Nuvio install. The `getStreams(tmdbId, mediaType, season, episode)` signature, the stream object fields (`name,title,url,quality,headers`) and the manifest schema follow the earlier version of this plugin and common Nuvio providers, but were not checked against your Nuvio version's source.
- If TV still fails in Nuvio, copy the `[Circle FTP]` log lines: they print the resolved titles, candidate posts, and which step failed.
