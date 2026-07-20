#!/usr/bin/env node
/**
 * Scrape the seed channels' most-viewed videos with Apify and rebuild
 * data/videos.json with exact, live numbers.
 *
 * Requires:
 *   - APIFY_TOKEN env var (get one at https://console.apify.com/account/integrations)
 *   - Network access to api.apify.com (blocked in some sandboxed environments;
 *     run locally if the calls below fail with connection errors)
 *
 * Usage:
 *   APIFY_TOKEN=apify_api_xxx node scraper/apify_scrape.mjs
 *
 * Zero dependencies — talks to the Apify REST API v2 with Node's built-in fetch.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACTOR = "streamers~youtube-scraper"; // https://apify.com/streamers/youtube-scraper
const MIN_VIEWS = 1_000_000;
const VIDEOS_PER_CHANNEL = 30;

const token = process.env.APIFY_TOKEN;
if (!token) {
  console.error("APIFY_TOKEN is not set. Get a token at https://console.apify.com/account/integrations");
  process.exit(1);
}

const { channels } = JSON.parse(await readFile(path.join(ROOT, "data", "channels.json"), "utf8"));

const input = {
  startUrls: channels.map((c) => ({ url: `https://www.youtube.com/${c.handle}/videos` })),
  sortVideosBy: "POPULAR",
  maxResults: VIDEOS_PER_CHANNEL,
  maxResultsShorts: 0, // long-form only; Shorts titles follow different rules
  maxResultStreams: 0,
};

console.log(`Starting actor ${ACTOR} for ${channels.length} channels...`);
const startRes = await fetch(
  `https://api.apify.com/v2/acts/${ACTOR}/runs?token=${token}`,
  { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
);
if (!startRes.ok) throw new Error(`Failed to start run: ${startRes.status} ${await startRes.text()}`);
const run = (await startRes.json()).data;
console.log(`Run ${run.id} started, waiting for it to finish...`);

let status = run.status;
while (status === "RUNNING" || status === "READY") {
  await new Promise((r) => setTimeout(r, 10_000));
  const res = await fetch(`https://api.apify.com/v2/actor-runs/${run.id}?token=${token}`);
  status = (await res.json()).data.status;
  process.stdout.write(".");
}
console.log(`\nRun finished with status: ${status}`);
if (status !== "SUCCEEDED") process.exit(1);

const itemsRes = await fetch(
  `https://api.apify.com/v2/actor-runs/${run.id}/dataset/items?token=${token}&format=json&clean=true`
);
const items = await itemsRes.json();
console.log(`Fetched ${items.length} scraped items.`);

// Map channel names/handles from the seed list so category joins keep working.
const byHandle = new Map(channels.map((c) => [c.handle.toLowerCase(), c.name]));

const videos = items
  .filter((it) => (it.viewCount ?? 0) >= MIN_VIEWS && it.title)
  .map((it) => ({
    channel:
      byHandle.get(`@${(it.channelUsername || "").toLowerCase()}`) ||
      it.channelName ||
      it.channelUsername,
    title: it.title,
    views: it.viewCount,
    year: it.date ? new Date(it.date).getFullYear() : null,
    url: it.url,
  }))
  .sort((a, b) => a.channel.localeCompare(b.channel) || b.views - a.views);

const out = {
  collection: {
    collectedAt: new Date().toISOString().slice(0, 10),
    method: `apify:${ACTOR}`,
    note: `Exact view counts scraped live via Apify (${VIDEOS_PER_CHANNEL} most-viewed long-form videos per channel, filtered to >= ${MIN_VIEWS.toLocaleString()} views).`,
    runId: run.id,
  },
  videos,
};

await writeFile(path.join(ROOT, "data", "videos.json"), JSON.stringify(out, null, 2));
console.log(`Wrote ${videos.length} videos (>=1M views) to data/videos.json`);
console.log("Now run: node analysis/analyze.mjs && node dashboard/build.mjs");
