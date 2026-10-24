// "You are here": asks for location on load, and if the viewer is within
// 10 miles of Seattle, shows a blue dot and centers the map on them once,
// keeping the current zoom.
// Anyone farther away gets no dot and no jump. A button under the zoom
// controls re-centers (or asks again).
import * as maplibregl from "maplibre-gl";

// Seattle city limits as a box (SDOT's Seattle_City_Limits layer, with the
// west edge at Alki). The box is a little generous at the corners, which a
// 10-mile buffer swamps.
const CITY = { west: -122.42, south: 47.494, east: -122.236, north: 47.736 };
const NEAR_KM = 16.1; // 10 miles

// The city box grown by NEAR_KM; also the map's pan limits, so any dot we show is reachable.
const KM_PER_DEG_LAT = 111.32;
const KM_PER_DEG_LNG = KM_PER_DEG_LAT * Math.cos((47.6 * Math.PI) / 180);
export const NEAR_BOUNDS: [[number, number], [number, number]] = [
  [CITY.west - NEAR_KM / KM_PER_DEG_LNG, CITY.south - NEAR_KM / KM_PER_DEG_LAT],
  [CITY.east + NEAR_KM / KM_PER_DEG_LNG, CITY.north + NEAR_KM / KM_PER_DEG_LAT],
];

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Distance to the city box; 0 inside it. */
function kmFromCity(p: { lat: number; lng: number }): number {
  const nearest = {
    lat: Math.min(Math.max(p.lat, CITY.south), CITY.north),
    lng: Math.min(Math.max(p.lng, CITY.west), CITY.east),
  };
  return distanceKm(p, nearest);
}

export function initLocate(map: maplibregl.Map) {
  if (!("geolocation" in navigator)) return;

  const el = document.createElement("div");
  el.className = "you-are-here";
  const dot = new maplibregl.Marker({ element: el });
  let here: [number, number] | null = null;
  let centered = false;
  let watchId: number | null = null;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "locate-button";
  button.title = "Show my location";
  button.setAttribute("aria-label", "Show my location");
  button.innerHTML = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="4"/><path d="M10 1v4M10 15v4M1 10h4M15 10h4"/></svg>`;

  const setState = (state: "idle" | "on" | "far" | "denied", note = "") => {
    button.dataset.state = state;
    button.title = note || "Show my location";
  };

  const onPosition = (pos: GeolocationPosition) => {
    const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    if (kmFromCity(p) > NEAR_KM) {
      // Not near Seattle: no dot, no jump.
      here = null;
      dot.remove();
      setState("far", "You're more than 10 miles from Seattle");
      return;
    }
    here = [p.lng, p.lat];
    dot.setLngLat(here).addTo(map);
    setState("on");
    if (!centered) {
      centered = true;
      map.easeTo({ center: here });
    }
  };

  const onError = (err: GeolocationPositionError) => {
    if (err.code === err.PERMISSION_DENIED) {
      setState("denied", "Location is blocked for this site");
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  };

  // Keep following the viewer after the first fix, but only center once.
  const start = () => {
    if (watchId === null) {
      watchId = navigator.geolocation.watchPosition(onPosition, onError, { enableHighAccuracy: true, maximumAge: 30_000 });
    }
  };

  button.addEventListener("click", () => {
    if (here) map.easeTo({ center: here });
    else {
      centered = false;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
      start();
    }
  });

  map.addControl(
    {
      onAdd: () => {
        const group = document.createElement("div");
        group.className = "maplibregl-ctrl maplibregl-ctrl-group";
        group.append(button);
        return group;
      },
      onRemove: () => {},
    },
    "top-right",
  );

  setState("idle");
  start();
}
