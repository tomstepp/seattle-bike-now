// Turns SDOT's drawbridge opening log into "how likely is an opening this hour"
// per bridge: public/data/bridges.json. SDOT publishes the log about daily, so
// the site shows typical odds, not live status.
import { mkdir, writeFile } from "node:fs/promises";
import type { BridgesFile, BridgeStats } from "../src/data-types";
import { bridgeStats, type BridgeRow } from "./bridge-stats";
import { addDays, seattleToday, soql } from "./socrata";

const DATASET = "gm8h-9449"; // SDOT Drawbridge Status
const WINDOW_DAYS = 365;

async function main() {
  const since = addDays(seattleToday(), -WINDOW_DAYS);
  const rows = await soql<BridgeRow>(DATASET, {
    $where: `entitytype = 'Bridge' AND opendatetime >= '${since}T00:00:00'`,
    $order: "opendatetime",
  });

  const byBridge = new Map<string, BridgeRow[]>();
  for (const r of rows) byBridge.set(r.entityid, [...(byBridge.get(r.entityid) ?? []), r]);

  const bridges: BridgeStats[] = [];
  for (const list of byBridge.values()) {
    const stats = bridgeStats(list);
    bridges.push(stats);
    console.log(
      `${stats.name}: ${stats.openingsPerDay}/day (${list.length} log rows), ${stats.firstLogged}..${stats.lastLogged}`,
    );
  }

  bridges.sort((a, b) => b.openingsPerDay - a.openingsPerDay);
  const out: BridgesFile = { generatedAt: new Date().toISOString(), bridges };
  await mkdir("public/data", { recursive: true });
  await writeFile("public/data/bridges.json", JSON.stringify(out));
  console.log(`wrote ${bridges.length} bridges`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
