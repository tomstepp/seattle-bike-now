// The Route section: pick a start and end (search, current location, or tap the
// map), get up to three bike routes from OpenRouteService, judge each with this
// site's data, and take the chosen one to a navigation app.
import * as maplibregl from "maplibre-gl";
import { esc, streetCase } from "./format";
import { fetchRoutes, routingAvailable, searchPlaces, type Route } from "./ors";
import { avoidAreas, googleMapsUrl, toGpx } from "./route-export";
import { labelRoutes, scoreRoute, type RouteScore, type ScoreContext } from "./route-score";

type LngLat = [number, number];

interface End {
  label: string;
  at: LngLat;
}

interface Scored extends Route {
  score: RouteScore;
  label: string;
}

/** Score context plus the shapes of today's closures and construction, for routing around them. */
export interface RouteContext extends ScoreContext {
  closedLines: { construction: LngLat[][][]; closures: LngLat[][][] }; // by item index, like the score items
}

const STORAGE_KEY = "route-ends";
const COLORS = { selected: "#f8fafc", other: "#64748b", casing: "#0c0c0e", start: "#22c55e", end: "#ef4444" };
const MI = 1609.34;
const FT = 3.281;
// "Closed" and "rerouted" lanes are worth routing around; "closed at times" and "narrowed" usually aren't.
const AVOID_IMPACTS = new Set(["closed", "rerouted"]);
const SEARCH_DELAY_MS = 300;
const IMPACT_ORDER = ["closed", "rerouted", "closed at times", "narrowed"];

const miles = (m: number) => `${(m / MI).toFixed(m < 16 * MI ? 1 : 0)} mi`;
const minutes = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);
const feet = (m: number) => `${Math.round((m * FT) / 10) * 10} ft`;
const pct = (part: number, whole: number) => Math.round((100 * part) / Math.max(whole, 1));

export function initRoutes(map: maplibregl.Map, context: () => RouteContext | null, openPanel: () => void): { picking: () => boolean } {
  const section = document.getElementById("route") as HTMLDetailsElement;
  const body = section.querySelector(".body")!;
  const status = section.querySelector(".status")!;

  if (!routingAvailable()) {
    status.textContent = "unavailable";
    body.innerHTML = `<p class="note">${
      import.meta.env.DEV ? "Routing needs an OpenRouteService key: add VITE_ORS_KEY to .env." : "Routing isn't available right now."
    }</p>`;
    return { picking: () => false };
  }

  body.innerHTML = `
    <div class="route-form">
      <div class="place" data-end="from">
        <span class="pin start"></span>
        <input type="search" placeholder="Start: search or tap the map" aria-label="Start" autocomplete="off" />
        <button type="button" class="icon here" title="Start from my location" aria-label="Start from my location">◎</button>
        <ul class="suggest" hidden></ul>
      </div>
      <div class="place" data-end="to">
        <span class="pin end"></span>
        <input type="search" placeholder="End: search or tap the map" aria-label="End" autocomplete="off" />
        <button type="button" class="icon swap" title="Swap start and end" aria-label="Swap start and end">⇅</button>
        <ul class="suggest" hidden></ul>
      </div>
    </div>
    <div id="route-results"></div>`;
  const results = body.querySelector<HTMLElement>("#route-results")!;
  const inputs = {
    from: body.querySelector<HTMLInputElement>('[data-end="from"] input')!,
    to: body.querySelector<HTMLInputElement>('[data-end="to"] input')!,
  };

  const ends: { from: End | null; to: End | null } = { from: null, to: null };
  const markers = {
    from: new maplibregl.Marker({ color: COLORS.start, draggable: true }),
    to: new maplibregl.Marker({ color: COLORS.end, draggable: true }),
  };
  let routes: Scored[] = [];
  let selected = 0;
  let showSteps = false;
  let request = 0;

  // ---------- Map layers ----------

  map.addSource("routes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  for (const [id, color, width] of [
    ["route-casing", COLORS.casing, ["interpolate", ["linear"], ["zoom"], 11, 6, 16, 12]],
    ["route-line", ["case", ["get", "selected"], COLORS.selected, COLORS.other], ["interpolate", ["linear"], ["zoom"], 11, 3, 16, 7]],
  ] as const) {
    map.addLayer({
      id,
      type: "line",
      source: "routes",
      layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["case", ["get", "selected"], 1, 0] },
      paint: {
        "line-color": color as maplibregl.ExpressionSpecification | string,
        "line-width": width as unknown as maplibregl.ExpressionSpecification,
        "line-opacity": id === "route-line" ? ["case", ["get", "selected"], 1, 0.85] : ["case", ["get", "selected"], 0.9, 0.6],
      },
    });
  }
  // Markers sit above the route.
  for (const id of ["crashes", "racks", "bridges", "counters", "repair"]) if (map.getLayer(id)) map.moveLayer(id);

  function drawRoutes() {
    (map.getSource("routes") as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features: routes.map((r, i) => ({
        type: "Feature",
        geometry: { type: "LineString", coordinates: r.coords },
        properties: { i, selected: i === selected },
      })),
    });
  }

  map.on("click", "route-line", (e) => {
    const i = e.features?.[0]?.properties?.i;
    if (typeof i === "number" && i !== selected) select(i);
  });
  map.on("mouseenter", "route-line", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "route-line", () => (map.getCanvas().style.cursor = ""));

  // ---------- Ends ----------

  function setEnd(which: "from" | "to", end: End | null, { route = true } = {}) {
    ends[which] = end;
    inputs[which].value = end?.label ?? "";
    if (end) markers[which].setLngLat(end.at).addTo(map);
    else markers[which].remove();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ends));
    } catch {}
    if (route) void findRoutes();
  }

  for (const which of ["from", "to"] as const) {
    markers[which].on("dragend", () => {
      const { lng, lat } = markers[which].getLngLat();
      setEnd(which, { label: "Dropped pin", at: [lng, lat] });
    });
  }

  // Tapping the map fills the first empty end while the Route section is open.
  // Other clicks (popups) carry on as usual.
  map.on("click", (e) => {
    if (!section.open || (ends.from && ends.to)) return;
    if (map.queryRenderedFeatures(e.point, { layers: ["route-line"].filter((l) => map.getLayer(l)) }).length) return;
    const which = ends.from ? "to" : "from";
    setEnd(which, { label: "Dropped pin", at: [e.lngLat.lng, e.lngLat.lat] });
  });

  body.querySelector(".here")!.addEventListener("click", () => {
    inputs.from.value = "Finding you…";
    navigator.geolocation.getCurrentPosition(
      (pos) => setEnd("from", { label: "My location", at: [pos.coords.longitude, pos.coords.latitude] }),
      () => (inputs.from.value = ends.from?.label ?? ""),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  });

  body.querySelector(".swap")!.addEventListener("click", () => {
    const { from, to } = ends;
    setEnd("from", to, { route: false });
    setEnd("to", from);
  });

  // Search-as-you-type suggestions.
  for (const which of ["from", "to"] as const) {
    const input = inputs[which];
    const list = input.parentElement!.querySelector<HTMLUListElement>(".suggest")!;
    let timer = 0;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      if (!input.value.trim()) {
        list.hidden = true;
        if (ends[which]) setEnd(which, null, { route: false });
        clearRoutes();
        return;
      }
      timer = window.setTimeout(async () => {
        const c = map.getCenter();
        const places = await searchPlaces(input.value, [c.lng, c.lat]).catch(() => []);
        list.innerHTML = places.map((p, i) => `<li><button type="button" data-i="${i}">${esc(p.label)}</button></li>`).join("");
        list.hidden = !places.length;
        list.querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
          b.addEventListener("click", () => {
            list.hidden = true;
            setEnd(which, places[Number(b.dataset.i)]);
          }),
        );
      }, SEARCH_DELAY_MS);
    });
    input.addEventListener("blur", () => setTimeout(() => (list.hidden = true), 200));
  }

  // ---------- Routing ----------

  function clearRoutes() {
    routes = [];
    drawRoutes();
    results.innerHTML = "";
    status.textContent = "plan a ride";
  }

  async function findRoutes() {
    const { from, to } = ends;
    if (!from || !to) {
      clearRoutes();
      return;
    }
    const mine = ++request;
    results.innerHTML = `<p class="note">Finding routes…</p>`;
    status.textContent = "finding routes…";
    try {
      const ctx = context();
      const score = (r: Route) => (ctx ? scoreRoute(r.coords, ctx) : emptyScore(r.distance));
      let found = (await fetchRoutes(from.at, to.at)).map((r) => ({ ...r, score: score(r), label: "" }));

      // If every route runs into a closed or rerouted lane, ask once more for one that steers around them.
      const blocked = (r: Scored) => r.score.construction.some((c) => AVOID_IMPACTS.has(c.impact)) || r.score.closures.length > 0;
      if (ctx && found.length && found.every(blocked)) {
        const lines = found.flatMap((r) => [
          ...r.score.constructionIndexes.flatMap((i) => (AVOID_IMPACTS.has(ctx.construction.items[i].impact) ? ctx.closedLines.construction[i] : [])),
          ...r.score.closureIndexes.flatMap((i) => ctx.closedLines.closures[i]),
        ]);
        const around = await fetchRoutes(from.at, to.at, avoidAreas(lines)).catch(() => []);
        if (around[0]) {
          const r = { ...around[0], score: score(around[0]), label: "" };
          if (!blocked(r)) found.push({ ...r, label: "Avoids closures" });
        }
      }
      if (mine !== request) return; // a newer request replaced this one

      const labels = labelRoutes(found);
      // At most two labels per card, so the header stays on one line.
      routes = found.map((r, i) => ({ ...r, label: [r.label, ...labels[i].split(" · ")].filter(Boolean).slice(0, 2).join(" · ") }));
      selected = 0;
      showSteps = false;
      drawRoutes();
      renderResults();
      fitRoutes();
      openPanel();
    } catch (err) {
      if (mine !== request) return;
      console.warn("routing failed", err);
      results.innerHTML = `<p class="note">Couldn't find a route${
        /HTTP 4\d\d/.test(String(err)) ? " between those points" : " right now"
      }. Try moving a pin.</p>`;
      status.textContent = "no route";
    }
  }

  function fitRoutes() {
    const b = new maplibregl.LngLatBounds();
    for (const r of routes) for (const c of r.coords) b.extend(c);
    if (!b.isEmpty()) map.fitBounds(b, { padding: { top: 60, bottom: 40, left: window.innerWidth >= 700 ? 340 : 40, right: 60 }, maxZoom: 15 });
  }

  function select(i: number) {
    selected = i;
    showSteps = false;
    drawRoutes();
    renderResults();
  }

  // ---------- Results ----------

  function issues(s: RouteScore): string[] {
    const out: string[] = [];
    // Several permits often cover one street; one line per street, with its worst impact.
    const byLane = new Map<string, string[]>();
    for (const c of s.construction) byLane.set(c.lane, [...(byLane.get(c.lane) ?? []), c.impact]);
    for (const [lane, impacts] of byLane) {
      const worst = IMPACT_ORDER.find((i) => impacts.includes(i)) ?? impacts[0];
      out.push(
        `<li class="${AVOID_IMPACTS.has(worst) ? "bad" : "warn"}">Construction on ${esc(streetCase(lane))}: lane ${esc(worst)}${
          impacts.length > 1 ? ` (${impacts.length} permits)` : ""
        }</li>`,
      );
    }
    for (const c of s.closures) out.push(`<li class="bad">${esc(streetCase(c.street))} closed ${esc(c.hours)}</li>`);
    for (const b of s.bridges) {
      out.push(`<li class="${b.chance >= 0.4 ? "warn" : ""}">${esc(b.name)} Bridge: ${Math.round(b.chance * 100)}% chance it opens this hour</li>`);
    }
    if (s.steep.length) {
      const worst = s.steep[0];
      out.push(
        `<li class="warn">${s.steep.length} steep ${s.steep.length === 1 ? "block" : "blocks"}, up to ${worst.slope}% (${esc(streetCase(worst.street))})</li>`,
      );
    }
    if (s.slowTrafficMeters >= 200) out.push(`<li class="warn">Slow car traffic on ${miles(s.slowTrafficMeters)} of shared lane</li>`);
    if (s.crashes) out.push(`<li>${s.crashes} bike ${s.crashes === 1 ? "crash" : "crashes"} along it in the past year</li>`);
    return out;
  }

  function renderResults() {
    status.textContent = routes.length ? `${miles(routes[selected].distance)} · ${minutes(routes[selected].duration)}` : "plan a ride";
    results.innerHTML = routes
      .map((r, i) => {
        const s = r.score;
        const prot = pct(s.protectedMeters, s.meters);
        const shared = pct(s.sharedMeters, s.meters);
        const list = issues(s);
        const open = i === selected;
        return `<div class="route-card${open ? " selected" : ""}" data-i="${i}">
          <button type="button" class="route-head" data-select="${i}" aria-pressed="${open}">
            <span class="row-head"><span class="name">Route ${"ABCD"[i]}${r.label ? ` · ${esc(r.label)}` : ""}</span><span class="when">${minutes(r.duration)}</span></span>
            <span class="sub">${miles(r.distance)} · ↑ ${feet(r.ascent)} · ${prot}% protected, ${shared}% shared lane</span>
            <span class="lane-bar" aria-hidden="true"><span class="p" style="width:${prot}%"></span><span class="s" style="width:${shared}%"></span></span>
          </button>
          ${list.length ? `<ul class="issues">${list.join("")}</ul>` : `<p class="sub ok">Nothing in the way that we know of.</p>`}
          ${
            open
              ? `<div class="route-actions">
                  <button type="button" data-steps>${showSteps ? "Hide directions" : "Directions"}</button>
                  <button type="button" data-gpx>GPX</button>
                  <a href="${esc(googleMapsUrl(r.coords))}" target="_blank" rel="noopener">Google Maps</a>
                </div>
                ${showSteps ? stepsHtml(r) : ""}`
              : ""
          }
        </div>`;
      })
      .join("") +
      `<p class="note">Routes from OpenRouteService (© OpenStreetMap). Google Maps may adjust the route between a few points; GPX keeps it exact in Ride with GPS, Komoot, Garmin or Wahoo.</p>`;

    results.querySelectorAll<HTMLButtonElement>("[data-select]").forEach((b) =>
      b.addEventListener("click", () => select(Number(b.dataset.select))),
    );
    results.querySelector("[data-steps]")?.addEventListener("click", () => {
      showSteps = !showSteps;
      renderResults();
    });
    results.querySelector("[data-gpx]")?.addEventListener("click", () => downloadGpx(routes[selected]));
    results.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((b) =>
      b.addEventListener("click", () => {
        const step = routes[selected].steps[Number(b.dataset.step)];
        map.flyTo({ center: step.at, zoom: Math.max(map.getZoom(), 16) });
      }),
    );
  }

  function stepsHtml(r: Scored): string {
    return `<ol class="steps">${r.steps
      .map(
        (s, i) =>
          `<li><button type="button" data-step="${i}"><span>${esc(s.instruction)}</span>${
            s.distance ? `<span class="sub">${s.distance < 300 ? `${Math.round(s.distance * FT / 10) * 10} ft` : miles(s.distance)}</span>` : ""
          }</button></li>`,
      )
      .join("")}</ol>`;
  }

  function downloadGpx(r: Scored) {
    const name = `${ends.from?.label ?? "Start"} to ${ends.to?.label ?? "End"}`;
    const url = URL.createObjectURL(new Blob([toGpx(r.coords, name)], { type: "application/gpx+xml" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "seattle-bike-route.gpx" });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Start-up ----------

  status.textContent = "plan a ride";
  // Bring back the last start and end; route once the section is opened, to save the daily quota.
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as typeof ends | null;
    if (saved?.from) setEnd("from", saved.from, { route: false });
    if (saved?.to) setEnd("to", saved.to, { route: false });
  } catch {}
  const routeIfReady = () => section.open && ends.from && ends.to && !routes.length && void findRoutes();
  section.addEventListener("toggle", routeIfReady);
  routeIfReady();

  return { picking: () => section.open && !(ends.from && ends.to) };
}

function emptyScore(meters: number): RouteScore {
  return {
    meters,
    protectedMeters: 0,
    sharedMeters: 0,
    steep: [],
    slowTrafficMeters: 0,
    construction: [],
    closures: [],
    constructionIndexes: [],
    closureIndexes: [],
    crashes: 0,
    bridges: [],
  };
}
