# Circle FTP BDIX for Nuvio

Version 1.0.4. This is a Nuvio stream provider, not a catalog addon.

This version incorporates the supplied StreamBDIX reference logic:
- Strictly selects Circle FTP `singleVideo` posts for movies and `series` posts for TV.
- Matches post names using `name || title` and normalized title comparison.
- Reads movie URLs from the detail response's string `content` field.
- Reads TV episode URLs from the selected season's `episodes[].link` field.
- Recognizes episode labels such as `S:01E:02`, `S01E02`, `Season 1 Episode 2`, `Episode 2`, and `Ep 2`, with positional fallback.
- Tries the primary Circle FTP API and the fallback IP API.
- Returns the hostname URL and, where a known mapping exists, a direct-IP alternative.

Nuvio calls `getStreams(tmdbId, mediaType, season, episode)`. The provider maps Nuvio `tv` to Circle FTP `series` internally.

Install by hosting this folder at the root of a public repository and adding the raw URL to `manifest.json`. Keep `providers/circleftp.js` at the exact relative path in the manifest.

Not live-tested against the Circle FTP API or Nuvio playback. If TV still returns no streams, capture Nuvio plugin logs: they now report whether title resolution, post matching, season selection, or episode selection failed.
