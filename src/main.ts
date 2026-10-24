// Entry point: the sidebar (weather, bridges, riders) and the phone menu.
// The map module loads in parallel, so these panels can show before MapLibre does.
import "./style.css";
import { fetchClosures, type Closure } from "./closures";
import { onCrashWindow } from "./crashes";
import { renderBridges, renderClosures, renderCrashes, renderRiders, renderUnavailable, renderWeather } from "./conditions";
import type { BikeNetwork, BridgesFile, CollisionsFile, CountersFile } from "./data-types";
import { seattleDate } from "./seattle-time";
import { fetchAlerts, fetchHourly } from "./weather";

const WEATHER_REFRESH_MS = 15 * 60_000;
// Bridge odds change on the hour; re-check often enough to roll over promptly.
const BRIDGE_REFRESH_MS = 5 * 60_000;

// Sections start collapsed; each viewer's own open/closed choice is remembered.
function initSections() {
  for (const el of document.querySelectorAll<HTMLDetailsElement>(".sections details")) {
    const key = `section-open:${el.id}`;
    try {
      el.open = localStorage.getItem(key) === "1";
    } catch {}
    el.addEventListener("toggle", () => {
      try {
        localStorage.setItem(key, el.open ? "1" : "0");
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
const bridges = getJson<BridgesFile>("/data/bridges.json")
  .then((f) => {
    renderBridges(f);
    setInterval(() => renderBridges(f), BRIDGE_REFRESH_MS);
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

// Closures are live from SDOT; "today" is Seattle's date.
const closures: Promise<Closure[] | null> = fetchClosures(seattleDate())
  .then((list) => {
    renderClosures(list, seattleDate());
    return list;
  })
  .catch((err) => {
    console.warn("closures unavailable", err);
    renderUnavailable("closures", "street closures");
    return null;
  });

async function loadWeather() {
  try {
    const [hours, alerts] = await Promise.all([fetchHourly(), fetchAlerts().catch(() => [])]);
    renderWeather(hours, alerts);
  } catch (err) {
    console.warn("weather unavailable", err);
    renderUnavailable("weather", "the forecast");
  }
}
loadWeather();
setInterval(loadWeather, WEATHER_REFRESH_MS);

// Tapping the map closes the phone menu, so popups aren't hidden behind it.
import("./map").then(({ startMap }) => startMap({ network, bridges, counters, collisions, closures, onMapClick: closeMenu }));
