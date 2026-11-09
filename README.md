# Circle FTP BDIX for Nuvio

Version 1.0.3. This is a Nuvio stream provider, not a catalog addon. It resolves a TMDB title, searches Circle FTP, and returns movie or selected TV episode links.

For TV, Nuvio must call `getStreams(tmdbId, "tv", season, episode)` with a 1-based season and episode. The provider selects the corresponding Circle FTP episode from the series detail response.

Install the repository using the raw URL of `manifest.json`. Keep `providers/circleftp.js` at the relative path declared in the manifest.

The provider has not been live-tested against the Circle FTP API or your ISP's BDIX routing.
