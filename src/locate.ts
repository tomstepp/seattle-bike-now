// "You are here": asks for location on load, and if the viewer is near Seattle,
// shows a blue dot and centers the map on them once. Anyone farther away gets
// no dot and no jump. A button under the zoom controls re-centers (or asks again).
import * as maplibregl from "maplibre-gl";

const CENTER = { lat: 47.6062, lng: -122.3321 }; // downtown Seattle
const NEAR_KM = 40; // about 25 miles
const ZOOM = 14;

function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
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
    if (distanceKm(p, CENTER) > NEAR_KM) {
      // Not near Seattle: no dot, no jump.
      here = null;
      dot.remove();
      setState("far", "Your location is outside the Seattle area");
      return;
    }
    here = [p.lng, p.lat];
    dot.setLngLat(here).addTo(map);
    setState("on");
    if (!centered) {
      centered = true;
      map.flyTo({ center: here, zoom: Math.max(map.getZoom(), ZOOM) });
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
    if (here) map.flyTo({ center: here, zoom: Math.max(map.getZoom(), ZOOM) });
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
