# Circle FTP BDIX — Nuvio provider

This is a first-pass port of the supplied Cloudstream `CircleFtpProvider.kt`.

## Contents
- `manifest.json` — Nuvio repository manifest
- `providers/circleftp.js` — Nuvio stream provider

## Important limitations
- Nuvio plugins are stream providers; they do not reproduce Cloudstream's home-page/category browsing UI.
- Nuvio supplies a TMDB ID, media type, season and episode. This provider resolves the title from the public TMDB title page, then searches Circle FTP's API by title.
- Title matching is heuristic. Similar titles/remakes can match incorrectly; the provider rejects weak matches.
- Circle FTP API hosts and BDIX direct-IP routes are copied from the supplied Kotlin source. They may have changed or may only work on a compatible BDIX ISP.
- The provider has not been tested inside your Nuvio installation or on your ISP. In particular, Android/Windows runtime HTTP restrictions and the source server's current availability still need in-app verification.

## Install
1. Host this folder as a public GitHub repository.
2. In Nuvio, open Settings → Content & Discovery → Plugins → Add Repository.
3. Paste the raw manifest URL:
   `https://raw.githubusercontent.com/YOUR_GITHUB_USERNAME/YOUR_REPO/main/manifest.json`
4. Refresh, then enable **Circle FTP BDIX**.

For local testing, use Nuvio's Developer → Plugin Tester and load `providers/circleftp.js` or the local manifest URL. Plugin Tester is only available in compatible development builds.

## Network note
The original source uses plain HTTP and private BDIX IP addresses. Use only on a network where you are authorized to access Circle FTP. The provider does not bypass ISP/network restrictions.
