// Measures the worker's CPU per refresh, using the same code path as the cron.
// Fetches the TomTom tiles once (network wait isn't billed as CPU on Workers),
// then times index build + decode + match. Usage: npm run bench (needs .dev.vars).
import { readFile } from "node:fs/promises";
import { SegmentIndex } from "../src/match";
import { buildSnapshot, fetchTiles, type SharedSegments } from "../src/traffic";

const RUNS = 20;

const vars = await readFile(".dev.vars", "utf8");
const key = vars.match(/^TOMTOM_KEY=(.+)$/m)?.[1];
if (!key) throw new Error("TOMTOM_KEY missing from .dev.vars");

const raw = await readFile("worker/data/shared-segments.json", "utf8");
const parseStart = process.cpuUsage();
const data = JSON.parse(raw) as SharedSegments;
const parseMs = process.cpuUsage(parseStart).user / 1000;

const fetchStart = performance.now();
const { buffers, failed } = await fetchTiles(key, data);
const fetchMs = performance.now() - fetchStart;
const bytes = buffers.reduce((n, b) => n + b.buf.byteLength, 0);

const times: number[] = [];
let snapshot;
for (let i = 0; i < RUNS; i++) {
  const start = process.cpuUsage();
  snapshot = buildSnapshot(new SegmentIndex(data.segments), data.zoom, buffers, failed);
  const used = process.cpuUsage(start);
  times.push((used.user + used.system) / 1000);
}
times.sort((a, b) => a - b);

console.log({
  tiles: `${buffers.length} ok, ${failed} failed, ${(bytes / 1024).toFixed(0)} KB`,
  fetchWallMs: Math.round(fetchMs),
  segmentsMatched: `${Object.keys(snapshot!.segments).length} of ${data.segments.length}`,
  cpuMsFirstRun: +times.at(-1)!.toFixed(1),
  cpuMsMedian: +times[RUNS >> 1].toFixed(1),
  cpuMsFastest: +times[0].toFixed(1),
  jsonParseMs: +parseMs.toFixed(1),
  freePlanLimitMs: 10,
});
