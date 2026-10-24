// Everything on the site is in Seattle time, whatever the viewer's time zone.
const TZ = "America/Los_Angeles";

const parts = (d: Date) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23", weekday: "short" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );

/** Seattle's calendar date, YYYY-MM-DD. */
export const seattleDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
export const seattleHour = (d = new Date()) => Number(parts(d).hour);
export const seattleIsWeekend = (d = new Date()) => ["Sat", "Sun"].includes(parts(d).weekday);

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric" });
/** "6:04 PM" */
export const formatTime = (d: Date) => timeFmt.format(d);
/** "6 PM" -> "6p" for tight charts. */
export const shortHour = (d: Date) => hourFmt.format(d).replace(/ ?([AP])M/, (_, ap: string) => ap.toLowerCase());
/** Hour 0–23 -> "6a" / "12p". */
export const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;

/** "2026-09-30" -> "Sep 30" */
export const formatDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** "2024-12-13" -> "Dec 13, 2024" */
export const formatDayYear = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// Sunrise/sunset from NOAA's solar position equations; good to a few minutes.
export function sunTimes(lat: number, lng: number, d = new Date()): { sunrise: Date; sunset: Date } {
  const rad = Math.PI / 180;
  // Seattle's calendar date, so evening in Seattle (already tomorrow in UTC) stays today.
  const day = Date.parse(`${new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d)}T12:00:00Z`);
  const n0 = Math.round((day - Date.UTC(2000, 0, 1, 12)) / 86_400_000 + 0.0008);
  const jStar = n0 - lng / 360;
  const m = (357.5291 + 0.98560028 * jStar) % 360;
  const c = 1.9148 * Math.sin(m * rad) + 0.02 * Math.sin(2 * m * rad) + 0.0003 * Math.sin(3 * m * rad);
  const lambda = (m + c + 180 + 102.9372) % 360;
  const transit = 2451545 + jStar +0.0053 * Math.sin(m * rad) - 0.0069 * Math.sin(2 * lambda * rad);
  const decl = Math.asin(Math.sin(lambda * rad) * Math.sin(23.44 * rad));
  const cosW = (Math.sin(-0.833 * rad) - Math.sin(lat * rad) * Math.sin(decl)) / (Math.cos(lat * rad) * Math.cos(decl));
  const w = Math.acos(cosW) / rad / 360;
  const toDate = (jd: number) => new Date((jd - 2440587.5) * 86_400_000);
  return { sunrise: toDate(transit - w), sunset: toDate(transit + w) };
}
