// Small text helpers shared by the sidebar and map popups.

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
export const fmtInt = (n: number) => n.toLocaleString("en-US");

// City data is in capitals ("FREMONT AVE N AND N 34TH ST"). Keep directions
// (N, NE, SW…) capitalized and lowercase ordinals ("34th").
const DIRECTIONS = new Set(["N", "S", "E", "W", "NE", "NW", "SE", "SW"]);
export const streetCase = (s: string) =>
  s
    .toLowerCase()
    .split(/(\s+)/)
    .map((w) => (DIRECTIONS.has(w.toUpperCase()) ? w.toUpperCase() : /^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join("")
    .replace(/\bAnd\b/g, "&")
    .replace(/\bBetween\b/g, "between");
