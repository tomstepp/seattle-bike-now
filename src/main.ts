// Entry point: the sidebar (weather, bridges, riders) and the phone menu.
// The map module loads in parallel, so these panels can show before MapLibre does.
import "./style.css";
import { fetchClosures, type Closure } from "./closures";
import { fetchConstruction, onBikeLanes, type Construction } from "./construction";
import { SegmentIndex } from "./match";
import { onCrashWindow } from "./crashes";
import {
  bridgeChance,
  isStale,
  renderBridges,
  renderClosures,
  renderCrashes,
  renderRiders,
  renderUnavailable,
  renderVerdict,
  renderWeather,
} from "./conditions";
import type { BikeNetwork, BridgesFile, CollisionsFile, CountersFile } from "./data-types";
import { seattleDate, sunTimes } from "./seattle-time";
import { verdict } from "./verdict";
import { fetchAlerts, fetchHourly, type Alert, type Hour } from "./weather";

const WEATHER_REFRESH_MS = 15 * 60_000;
// Bridge odds change on the hour; re-check often enough to roll over promptly.
const BRIDGE_REFRESH_MS = 5 * 60_000;

// Sections start collapsed and open one at a time; the open one is remembered.
const OPEN_KEY = "section-open";
function initSections() {
  const sections = [...document.querySelectorAll<HTMLDetailsElement>(".sections details")];
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(OPEN_KEY);
  } catch {}
  for (const el of sections) {
    el.open = el.id === saved;
    el.addEventListener("toggle", () => {
      if (el.open) for (const other of sections) if (other !== el) other.open = false;
      // Closing the open section leaves none open.
      if (!el.open && sections.some((s) => s.open)) return;
      try {
        localStorage.setItem(OPEN_KEY, el.open ? el.id : "");
      } catch {}
    });
  }
}

// Phones: the sidebar hides behind a menu button so the map gets the screen.
function initMenu() {
  const button = document.getElementById("menu-toggle")!;
  const setOpen = (open: boolean) => {
    document.body.classList.toggle("menu-open", open);
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  };
  button.addEventListener("click", () => setOpen(!document.body.classList.contains("menu-open")));
  document.addEventListener("keydown", (e) => e.key === "Escape" && setOpen(false));
  return () => setOpen(false);
}
const closeMenu = initMenu();
initSections();

const getJson = <T,>(url: string): Promise<T> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json() as Promise<T>;
  });

const network = getJson<BikeNetwork>("/data/bike-network.geojson");
// What the one-line answer is built from; it re-renders as each piece arrives.
const latest: { hours: Hour[]; alerts: Alert[]; bridges: BridgesFile | null } = { hours: [], alerts: [], bridges: null };
function updateVerdict() {
  const now = new Date();
  const { sunrise, sunset } = sunTimes(47.62, -122.35, now);
  const live = latest.bridges?.bridges.filter((b) => !isStale(b, latest.bridges!)) ?? [];
  renderVerdict(
    verdict({ now, hours: latest.hours, alerts: latest.alerts, sunrise, sunset, bridges: live.map((b) => ({ name: b.name, chance: bridgeChance(b, now) })) }),
  );
}
setInterval(updateVerdict, BRIDGE_REFRESH_MS);

const bridges = getJson<BridgesFile>("/data/bridges.json")
  .then((f) => {
    renderBridges(f);
    setInterval(() => renderBridges(f), BRIDGE_REFRESH_MS);
    latest.bridges = f;
    updateVerdict();
    return f;
  })
  .catch((err) => {
    console.warn("bridges unavailable", err);
    renderUnavailable("bridges", "bridge data");
    return null;
  });
const counters = getJson<CountersFile>("/data/counters.json")
  .then((f) => {
    renderRiders(f);
    return f;
  })
  .catch((err) => {
    console.warn("counters unavailable", err);
    renderUnavailable("riders", "rider counts");
    return null;
  });

const collisions = getJson<CollisionsFile>("/data/collisions.json")
  .then((f) => {
    renderCrashes(f);
    onCrashWindow(() => renderCrashes(f));
    return f;
  })
  .catch((err) => {
    console.warn("collisions unavailable", err);
    renderUnavailable("crashes", "crash data");
    return null;
  });

// Closures and construction are live from SDOT; "today" is Seattle's date.
const today = seattleDate();
const closures: Promise<Closure[] | null> = fetchClosures(today).catch((err) => {
  console.warn("closures unavailable", err);
  return null;
});
// Construction permits flag bike-lane impact even where there's no lane; keep the ones on a mapped lane.
const construction: Promise<Construction[] | null> = Promise.all([fetchConstruction(today), network])
  .then(([permits, net]) => {
    const index = new SegmentIndex(net.features.map((f) => ({ id: f.properties.id, coords: f.geometry.coordinates })));
    return onBikeLanes(permits, index, new Map(net.features.map((f) => [f.properties.id, f.properties.street])));
  })
  .catch((err) => {
    console.warn("construction unavailable", err);
    return null;
  });
Promise.all([closures, construction]).then(([c, w]) => renderClosures(c, w, today));

async function loadWeather() {
  try {
    const [hours, alerts] = await Promise.all([fetchHourly(), fetchAlerts().catch(() => [])]);
    renderWeather(hours, alerts);
    Object.assign(latest, { hours, alerts });
    updateVerdict();
  } catch (err) {
    console.warn("weather unavailable", err);
    renderUnavailable("weather", "the forecast");
  }
}
loadWeather();
setInterval(loadWeather, WEATHER_REFRESH_MS);

// Tapping the map closes the phone menu, so popups aren't hidden behind it.
import("./map").then(({ startMap }) => startMap({ network, bridges, counters, collisions, closures, construction, onMapClick: closeMenu }));
