# Creator Title Patterns

Scrape top YouTube creators, collect their videos with 1M+ views, and analyze
what their titles have in common — delivered as an interactive dashboard.

**Goal:** help creators see which title constructions link to stronger performance.

**Constraints honored:** real data only; excludes non-English, music, gaming,
media-company, and kids' channels (see `data/channels.json` for the seed list
and exclusion examples).

## Quick start

```sh
node analysis/analyze.mjs    # data/videos.json -> data/analysis.json
node dashboard/build.mjs     # data/analysis.json -> dashboard/index.html
# then open dashboard/index.html in any browser (fully self-contained, no server needed)
```

Requires Node 18+. No npm dependencies.

## Refreshing with live scraped data (Apify)

```sh
APIFY_TOKEN=apify_api_xxx node scraper/apify_scrape.mjs
node analysis/analyze.mjs && node dashboard/build.mjs
```

The scraper runs the [streamers/youtube-scraper](https://apify.com/streamers/youtube-scraper)
actor over every channel in `data/channels.json` (30 most-viewed long-form
videos each, Shorts excluded), filters to ≥1M views, and rewrites
`data/videos.json` in the same schema — so the analysis and dashboard rebuild
unchanged on exact live numbers.

## Data provenance (read this)

The environment this project was built in has a network policy that blocks
YouTube, the Apify API, and third-party stats sites. The committed
`data/videos.json` was therefore assembled from **live web-search results
(2026-07-20) anchored against the assistant's catalog knowledge** of these
channels: all titles are real video titles, every video has well over 1M views,
but the view counts are approximate rounded snapshots, not exact live figures.
The search-verified anchor facts and their sources are recorded in the file's
`collection` block. Run the Apify scraper (above) from a network-enabled
machine to replace it with exact data.

## What the dashboard shows

- **Which title patterns perform best** — 16 detected constructions (dollar
  amounts, huge numbers, time limits, challenge framing, questions, negation,
  superlatives…) ranked by median views, with prevalence and top examples.
- **Title length** — median views by word-count bucket.
- **Channels compared** — median views per channel, colored by category.
- **Words that keep showing up** — most frequent title words with view medians.
- **Explore every video** — searchable, filterable (channel / category /
  pattern), sortable table of the full dataset with per-video pattern chips.

Light and dark mode both supported; the categorical palette is
colorblind-validated (dataviz six-checks validator, both modes).

## Headline findings (current dataset: 110 videos, 11 channels)

| Pattern | Prevalence | Median views |
|---|---|---|
| Dollar amount ($) | 14% | 160M |
| Huge number (100k+/million/billion) | 15% | 160M |
| Exclamation mark | 12% | 160M |
| Challenge / survival framing | 8% | 140M |
| Contains a number | 35% | 120M |
| Time limit (hours / days) | 8% | 120M |
| *Overall median* | — | *45M* |

Money stakes, concrete huge numbers, and time limits are the strongest
performers — driven by the challenge/stunt category — while question-form and
"Why/How" explainer titles cluster lower (they dominate education channels,
whose ceilings are structurally lower). Titles in the 5–8 word range carry most
of the top performers.

## Project layout

```
data/channels.json    seed channels + categories + exclusion list
data/videos.json      the dataset (titles, views, year) + provenance block
data/analysis.json    generated pattern/channel/word aggregates
scraper/              Apify pipeline (zero-dep, REST API)
analysis/             pattern detection + aggregation
dashboard/            template + build script -> self-contained index.html
```
