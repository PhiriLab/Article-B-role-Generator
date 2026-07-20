#!/usr/bin/env node
/**
 * Title-pattern analysis over data/videos.json.
 * Detects recurring title constructions, then measures each pattern's
 * prevalence and view performance (median/mean) across the dataset.
 *
 * Usage: node analysis/analyze.mjs   -> writes data/analysis.json
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { videos, collection } = JSON.parse(await readFile(path.join(ROOT, "data", "videos.json"), "utf8"));
const { channels } = JSON.parse(await readFile(path.join(ROOT, "data", "channels.json"), "utf8"));

const PATTERNS = [
  { id: "dollar", label: "Dollar amount ($)", test: (t) => /\$\s?\d/.test(t), example: "$456,000 Squid Game In Real Life!" },
  { id: "number", label: "Contains a number", test: (t) => /\d/.test(t) },
  { id: "bigNumber", label: "Huge number (100k+ / million / billion)", test: (t) => /\d{1,3},?\d{3},?\d{3}|million|billion|,000/i.test(t) },
  { id: "time", label: "Time limit (hours / days)", test: (t) => /\b\d+\s?(hour|day|minute|week|month)s?\b|\bovernight\b|\b24\/7\b/i.test(t) },
  { id: "superlative", label: "Superlative (world's / most / largest…)", test: (t) => /\bworld'?s\b|\bmost\b|\bbiggest\b|\blargest\b|\bbest\b|\bworst\b|\bfastest\b|\bcraziest\b|\blongest\b|\bexpensive\b|\bsimplest\b|\bdangerous\b/i.test(t) },
  { id: "firstPerson", label: "First person (I / my / we)", test: (t) => /(^|\s)(I|I'?ll|I'?m|my|we|our)\b/i.test(t) && /\b(I|my|we|our)\b/.test(t) },
  { id: "secondPerson", label: "Addresses viewer (you / your)", test: (t) => /\byou\b|\byour\b/i.test(t) },
  { id: "versus", label: "X vs Y framing", test: (t) => /\bvs\.?\b|\bversus\b/i.test(t) },
  { id: "question", label: "Question", test: (t) => /\?/.test(t) || /^(why|how|what|which|is|are|could|can|do|does|would)\b/i.test(t) },
  { id: "whyHowWhat", label: "Why / How / What opener", test: (t) => /^(why|how|what)\b/i.test(t) },
  { id: "negation", label: "Negation / impossibility (no one / never / can't)", test: (t) => /\bno one\b|\bnever\b|\bnot?\b|\bcan'?t\b|\bwon'?t\b|\bimpossible\b|\bwithout\b/i.test(t) },
  { id: "challenge", label: "Challenge / survival framing", test: (t) => /\bchallenge\b|\bsurviv/i.test(t) || /\blast to\b|\bstranded\b|\bburied\b/i.test(t) },
  { id: "exclaim", label: "Exclamation mark", test: (t) => /!/.test(t) },
  { id: "allCaps", label: "ALL-CAPS word", test: (t) => /\b[A-Z]{3,}\b/.test(t.replace(/\b(NFL|NASA|FPS|DIY|USA|UK)\b/g, "")) },
  { id: "series", label: "Series / sequel marker (2, 3, Day N, 2.0)", test: (t) => /\b\d\.\d\b|\b[2-9]\s*$|\bday \d+\b|\bpart \d\b/i.test(t) },
  { id: "thisThese", label: "Deictic hook (this / these)", test: (t) => /\bthis\b|\bthese\b/i.test(t) },
];

const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

const allViews = videos.map((v) => v.views);
const overallMedian = median(allViews);

// --- Pattern stats ---
const patterns = PATTERNS.map((p) => {
  const hits = videos.filter((v) => p.test(v.title));
  const views = hits.map((v) => v.views);
  const topExamples = [...hits].sort((a, b) => b.views - a.views).slice(0, 3)
    .map((v) => ({ title: v.title, channel: v.channel, views: v.views }));
  return {
    id: p.id,
    label: p.label,
    count: hits.length,
    share: hits.length / videos.length,
    medianViews: median(views),
    meanViews: Math.round(mean(views)),
    liftVsOverall: overallMedian ? median(views) / overallMedian : 0,
    topExamples,
  };
}).sort((a, b) => b.medianViews - a.medianViews);

// --- Title length ---
const lengthBuckets = [
  { id: "2-4", min: 2, max: 4 },
  { id: "5-6", min: 5, max: 6 },
  { id: "7-8", min: 7, max: 8 },
  { id: "9+", min: 9, max: Infinity },
].map((b) => {
  const hits = videos.filter((v) => {
    const w = v.title.split(/\s+/).length;
    return w >= b.min && w <= b.max;
  });
  return { bucket: `${b.id} words`, count: hits.length, medianViews: median(hits.map((v) => v.views)) };
});

// --- Word frequency (top words, stopwords removed) ---
const STOP = new Set("the a an in on of to for and or vs with i my we our you your this these is are at it its from into ever if by".split(" "));
const wordCounts = new Map();
for (const v of videos) {
  const words = v.title.toLowerCase().replace(/[^a-z0-9$' ]/g, " ").split(/\s+/).filter(Boolean);
  for (const w of new Set(words)) {
    if (STOP.has(w) || w.length < 3) continue;
    if (!wordCounts.has(w)) wordCounts.set(w, { count: 0, views: [] });
    const e = wordCounts.get(w);
    e.count += 1;
    e.views.push(v.views);
  }
}
const topWords = [...wordCounts.entries()]
  .filter(([, e]) => e.count >= 3)
  .map(([word, e]) => ({ word, count: e.count, medianViews: median(e.views) }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 30);

// --- Per-channel stats ---
const channelMeta = new Map(channels.map((c) => [c.name, c]));
const byChannel = [...new Set(videos.map((v) => v.channel))].map((name) => {
  const vids = videos.filter((v) => v.channel === name);
  const meta = channelMeta.get(name) || {};
  const patternShares = Object.fromEntries(
    PATTERNS.map((p) => [p.id, vids.filter((v) => p.test(v.title)).length / vids.length])
  );
  return {
    name,
    category: meta.category || "Other",
    subscribersM: meta.subscribersM || null,
    videosSampled: vids.length,
    medianViews: median(vids.map((v) => v.views)),
    totalViews: vids.reduce((a, v) => a + v.views, 0),
    avgTitleWords: +mean(vids.map((v) => v.title.split(/\s+/).length)).toFixed(1),
    patternShares,
  };
}).sort((a, b) => b.medianViews - a.medianViews);

// --- Per-category stats ---
const byCategory = [...new Set(byChannel.map((c) => c.category))].map((cat) => {
  const chans = byChannel.filter((c) => c.category === cat);
  const vids = videos.filter((v) => chans.some((c) => c.name === v.channel));
  return {
    category: cat,
    channels: chans.map((c) => c.name),
    videos: vids.length,
    medianViews: median(vids.map((v) => v.views)),
    avgTitleWords: +mean(vids.map((v) => v.title.split(/\s+/).length)).toFixed(1),
  };
}).sort((a, b) => b.medianViews - a.medianViews);

// Attach per-video pattern flags for the dashboard's explorer table.
const videosOut = videos.map((v) => ({
  ...v,
  words: v.title.split(/\s+/).length,
  patterns: PATTERNS.filter((p) => p.test(v.title)).map((p) => p.id),
}));

const analysis = {
  generatedAt: new Date().toISOString(),
  collection,
  totals: {
    videos: videos.length,
    channels: byChannel.length,
    totalViews: allViews.reduce((a, b) => a + b, 0),
    medianViews: overallMedian,
    avgTitleWords: +mean(videos.map((v) => v.title.split(/\s+/).length)).toFixed(1),
  },
  patterns,
  lengthBuckets,
  topWords,
  byChannel,
  byCategory,
  videos: videosOut,
};

await writeFile(path.join(ROOT, "data", "analysis.json"), JSON.stringify(analysis, null, 2));
console.log(`Analyzed ${videos.length} videos / ${byChannel.length} channels.`);
console.log(`Top patterns by median views:`);
for (const p of patterns.slice(0, 6)) {
  console.log(`  ${p.label}: ${p.count} videos (${Math.round(p.share * 100)}%), median ${(p.medianViews / 1e6).toFixed(0)}M views`);
}
