// The sidebar sections: weather, drawbridges and rider counts. Each section's
// <summary> carries a one-line status, so it's useful even when collapsed.
import { daysThisWeek, hoursOn, type Closure } from "./closures";
import { CRASH_WINDOWS, crashesFor, crashWindow, setCrashWindow, type CrashWindow } from "./crashes";
import type { BridgeStats, BridgesFile, CollisionsFile, CounterStats, CountersFile } from "./data-types";
import { esc, fmtInt, streetCase } from "./format";
import type { Verdict } from "./verdict";
import { formatDay, formatDayYear, formatTime, hourLabel, seattleHour, seattleIsWeekend, shortHour, sunTimes } from "./seattle-time";
import { RAIN_LIKELY, WINDY_MPH, type Alert, type Hour } from "./weather";

const SEATTLE = { lat: 47.62, lng: -122.35 };
const HOURS_SHOWN = 12;
// Bridge odds bands, used for the panel and the map markers.
export const BRIDGE_LIKELY = 0.4;
export const BRIDGE_POSSIBLE = 0.15;
// Bridges whose log stopped this long ago get flagged as stale.
const STALE_DAYS = 14;


function setSection(id: string, summary: string, body: string) {
  const el = document.getElementById(id)!;
  el.querySelector(".status")!.innerHTML = summary;
  el.querySelector(".body")!.innerHTML = body;
}

export function renderUnavailable(id: string, what: string) {
  setSection(id, "unavailable", `<p class="note">Couldn't load ${what} right now.</p>`);
}

// ---------- Weather ----------

export function renderWeather(hours: Hour[], alerts: Alert[]) {
  const now = Date.now();
  const upcoming = hours.filter((h) => h.start.getTime() + 3_600_000 > now).slice(0, HOURS_SHOWN);
  if (!upcoming.length) return renderUnavailable("weather", "the forecast");
  const first = upcoming[0];

  const rainAt = upcoming.find((h) => h.rainChance >= RAIN_LIKELY);
  const rainLine = !rainAt
    ? `Dry for the next ${upcoming.length} hours`
    : rainAt === first
      ? `Rain likely now (${first.rainChance}%)`
      : `Rain likely from ${shortHour(rainAt.start)} (${rainAt.rainChance}%)`;
  const windiest = upcoming.reduce((a, b) => (b.windMph > a.windMph ? b : a));
  const windLine = windiest.windMph >= WINDY_MPH ? ` · wind to ${windiest.windMph} mph` : "";

  // Commuters care about the next change in light.
  const { sunrise, sunset } = sunTimes(SEATTLE.lat, SEATTLE.lng);
  const sunLine =
    now < sunrise.getTime()
      ? `Sunrise ${formatTime(sunrise)}`
      : now < sunset.getTime()
        ? `Sunset ${formatTime(sunset)}`
        : `Sunrise ${formatTime(sunTimes(SEATTLE.lat, SEATTLE.lng, new Date(now + 86_400_000)).sunrise)}`;

  const cols = upcoming
    .map((h) => {
      const wet = h.rainChance >= RAIN_LIKELY;
      return `<div class="hour${wet ? " wet" : ""}" title="${esc(h.sky)}, wind ${h.windDir} ${h.windMph} mph">
        <span class="t">${shortHour(h.start)}</span>
        <span class="temp">${h.tempF}°</span>
        <span class="rain-bar"><span style="height:${h.rainChance}%"></span></span>
        <span class="rain">${h.rainChance}%</span>
        <span class="wind${h.windMph >= WINDY_MPH ? " windy" : ""}">${h.windMph}</span>
      </div>`;
    })
    .join("");

  const alertHtml = alerts
    .map((a) => `<p class="alert"><strong>${esc(a.event)}</strong> ${esc(a.headline.replace(a.event, "").replace(/^\s*(issued\s+)?/i, ""))}</p>`)
    .join("");

  setSection(
    "weather",
    `${first.tempF}° · ${alerts.length ? esc(alerts[0].event) : rainAt ? (rainAt === first ? "rain now" : `rain ${shortHour(rainAt.start)}`) : "dry"}`,
    `${alertHtml}
     <p class="line">${rainLine}${windLine}. ${sunLine}.</p>
     <div class="hours" aria-label="Hourly forecast: temperature, rain chance, wind mph">${cols}</div>
     <p class="note">Rows: temp, chance of rain, wind mph. Source: National Weather Service.</p>`,
  );
}

// ---------- Bridges ----------

export const bridgeChance = (b: BridgeStats, d = new Date()) =>
  (seattleIsWeekend(d) ? b.weekend : b.weekday)[seattleHour(d)];

export const isStale = (b: BridgeStats, file: BridgesFile) =>
  (Date.parse(file.generatedAt) - Date.parse(`${b.lastLogged}T23:59:00Z`)) / 86_400_000 > STALE_DAYS;

export function chanceClass(p: number) {
  return p >= BRIDGE_LIKELY ? "likely" : p >= BRIDGE_POSSIBLE ? "possible" : "unlikely";
}

/** 24 bars for today's day type, current hour outlined. */
export function bridgeChart(b: BridgeStats, d = new Date()): string {
  const shares = seattleIsWeekend(d) ? b.weekend : b.weekday;
  const now = seattleHour(d);
  const W = 6;
  const H = 22;
  const bars = shares
    .map((p, h) => {
      const bh = Math.max(1, Math.round(p * H));
      return `<rect x="${h * W}" y="${H - bh}" width="${W - 1.5}" height="${bh}" rx="1" class="${chanceClass(p)}${h === now ? " now" : ""}"><title>${hourLabel(h)}: ${Math.round(p * 100)}%</title></rect>`;
    })
    .join("");
  return `<svg class="chart" viewBox="0 0 ${24 * W} ${H + 9}" width="${24 * W}" height="${H + 9}" role="img" aria-label="Chance of an opening by hour">
    ${bars}
    ${[0, 6, 12, 18].map((h) => `<text x="${h * W}" y="${H + 8}">${hourLabel(h)}</text>`).join("")}
  </svg>`;
}

export function renderBridges(file: BridgesFile) {
  const live = file.bridges.filter((b) => !isStale(b, file));
  const top = [...live].sort((a, b) => bridgeChance(b) - bridgeChance(a))[0];
  const topChance = top ? bridgeChance(top) : 0;
  const summary =
    top && topChance >= BRIDGE_POSSIBLE
      ? `${esc(top.name)} ${Math.round(topChance * 100)}% this hour`
      : "openings unlikely this hour";

  const rows = file.bridges
    .map((b) => {
      const p = bridgeChance(b);
      const stale = isStale(b, file);
      return `<li${stale ? ' class="stale"' : ""}>
        <div class="row-head">
          <span><span class="name">${esc(b.name)}</span> <span class="sub">${stale ? `log stops ${formatDay(b.lastLogged)}` : `${b.openingsPerDay}/day, ~${b.medianMinutes} min`}</span></span>
          <span class="chance ${chanceClass(p)}">${Math.round(p * 100)}%</span>
        </div>
        ${bridgeChart(b)}
      </li>`;
    })
    .join("");

  setSection(
    "bridges",
    summary,
    `<p class="line">Chance of an opening this hour, from a year of SDOT logs. Bars show ${seattleIsWeekend() ? "weekends" : "weekdays"}; weekday rush hours are protected.</p>
     <ul class="list">${rows}</ul>
     <p class="note">SDOT doesn't publish live status, so these are typical odds, not a live feed.</p>`,
  );
}

// ---------- Riders ----------

export function sparkline(weekly: (number | null)[]): string {
  const W = 104;
  const H = 22;
  const max = Math.max(...weekly.map((v) => v ?? 0), 1);
  const step = W / (weekly.length - 1);
  // Break the line where the counter was offline rather than drawing a dip.
  const runs: string[][] = [[]];
  weekly.forEach((v, i) => {
    if (v === null) {
      if (runs.at(-1)!.length) runs.push([]);
      return;
    }
    runs.at(-1)!.push(`${(i * step).toFixed(1)},${(H - (v / max) * (H - 2) - 1).toFixed(1)}`);
  });
  const lines = runs.filter((r) => r.length > 1).map((r) => `<polyline points="${r.join(" ")}"/>`);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Weekly riders, last 52 weeks">${lines.join("")}</svg>`;
}

export const changeText = (c: CounterStats) =>
  c.changeVsLastYear === null
    ? ""
    : `<span class="change ${c.changeVsLastYear >= 0 ? "up" : "down"}">${c.changeVsLastYear >= 0 ? "+" : "−"}${Math.abs(Math.round(c.changeVsLastYear * 100))}%</span>`;

export function renderRiders(file: CountersFile) {
  const lead = file.counters[0];
  const through = file.counters.map((c) => c.lastDay).sort().at(-1)!;
  const rows = file.counters
    .map(
      (c) => `<li>
        <div class="row-head">
          <span class="name">${esc(c.name)}</span>
          <span class="count">${fmtInt(c.avgPerDay30)}<small>/day</small> ${changeText(c)}</span>
        </div>
        <div class="row-foot">
          ${sparkline(c.weekly)}
          <span class="sub">record ${fmtInt(c.record.count)}, ${formatDay(c.record.day)}${c.lastDay < through ? ` · through ${formatDay(c.lastDay)}` : ""}</span>
        </div>
      </li>`,
    )
    .join("");
  setSection(
    "riders",
    `${esc(lead.name)} ${fmtInt(lead.avgPerDay30)}/day`,
    `<p class="line">Average riders per day over the 30 days through ${formatDay(through)}, vs. the same weeks last year. Lines: the past year, by week.</p>
     <ul class="list">${rows}</ul>
     <p class="note">Bikes and scooters. SDOT counters, published monthly.</p>`,
  );
}

// ---------- Closures ----------

const weekdayName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
// "2:30PM-6PM" -> "2:30–6p"; "6AM-4PM" -> "6a–4p"
const hoursText = (h: string) =>
  h === "all day"
    ? h
    : h
        .replace(/\s+/g, "")
        .replace(/(AM|PM)/gi, (m) => m[0].toLowerCase())
        .replace(/-/, "–");

export function renderClosures(closures: Closure[], today: string) {
  // One permit can close several blocks; list it once.
  const permits = new Map<string, Closure>();
  for (const c of closures) if (!permits.has(c.permit)) permits.set(c.permit, c);

  const row = (c: Closure, when: string) =>
    `<li class="row-head"><span class="name">${esc(streetCase(c.street))}</span><span class="when">${when}</span></li>`;
  const todayRows: string[] = [];
  const laterRows: string[] = [];
  for (const c of permits.values()) {
    const days = daysThisWeek(c, today);
    if (!days.length) continue;
    if (days[0] === today) todayRows.push(row(c, hoursText(hoursOn(c, today)!)));
    else laterRows.push(row(c, days.map(weekdayName).join(", ")));
  }

  setSection(
    "closures",
    todayRows.length ? `${todayRows.length} today` : `none today · ${laterRows.length} this week`,
    `${todayRows.length ? `<p class="line">Today</p><ul class="list closure-list">${todayRows.join("")}</ul>` : ""}
     ${laterRows.length ? `<p class="line later">Later this week</p><ul class="list closure-list">${laterRows.join("")}</ul>` : ""}
     <p class="note">Block parties, play streets and markets. Tap one on the map for details. Construction isn't included.</p>`,
  );
}

// ---------- Crashes ----------

const SPOTS_LISTED = 6;

export const severityText = (s: { injuries: number; serious: number; fatal: number }) =>
  [s.fatal && `${s.fatal} fatal`, s.serious && `${s.serious} serious`, s.injuries && `${s.injuries} injured`].filter(Boolean).join(", ") ||
  "no injuries";

const monthYear = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

export function renderCrashes(file: CollisionsFile) {
  const key = crashWindow();
  const { window: w, since, spots } = crashesFor(file, key);
  const total = spots.reduce((n, s) => n + s.crashes, 0);
  const rows = spots
    .slice(0, SPOTS_LISTED)
    .map(
      (s) => `<li><button type="button" class="spot" data-lng="${s.lng}" data-lat="${s.lat}">
        <div class="row-head"><span class="name">${esc(streetCase(s.location))}</span><span class="count">${s.crashes}</span></div>
        <div class="sub">${severityText(s)} · ${formatDayYear(s.last)}</div>
      </button></li>`,
    )
    .join("");
  const buttons = CRASH_WINDOWS.map(
    (x) => `<button type="button" data-window="${x.key}" aria-pressed="${x.key === key}">${x.label}</button>`,
  ).join("");
  setSection(
    "crashes",
    `${fmtInt(total)} in ${w.label}`,
    `<div class="segmented" role="group" aria-label="Time span">${buttons}</div>
     <p class="line">${fmtInt(total)} crashes involving someone on a bike, ${monthYear(since)} to ${monthYear(file.through)}.${spots.length ? " Most at:" : ""}</p>
     <ul class="list">${rows}</ul>
     <p class="note">Tap a location to see it on the map. SDOT's records run a few months behind.</p>`,
  );
  document.querySelectorAll<HTMLButtonElement>("#crashes [data-window]").forEach((b) =>
    b.addEventListener("click", () => setCrashWindow(b.dataset.window as CrashWindow)),
  );
  // The map module listens for this and flies there.
  document.querySelectorAll<HTMLButtonElement>("#crashes .spot").forEach((b) =>
    b.addEventListener("click", () =>
      window.dispatchEvent(new CustomEvent("focus-map", { detail: { lng: Number(b.dataset.lng), lat: Number(b.dataset.lat) } })),
    ),
  );
}

// ---------- Should I ride? ----------

export function renderVerdict(v: Verdict | null) {
  const line = document.getElementById("verdict")!;
  const badge = document.getElementById("verdict-badge")!;
  if (!v) {
    line.textContent = "";
    badge.hidden = true;
    return;
  }
  line.dataset.tone = badge.dataset.tone = v.tone;
  line.innerHTML = `<strong>${esc(v.headline)}</strong>${v.details.length ? ` · ${esc(v.details.join(" · "))}` : ""}`;
  badge.textContent = v.short;
  badge.hidden = false;
}
