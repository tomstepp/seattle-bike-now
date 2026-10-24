// The one-line "should I ride?" answer at the top of the sidebar. Looks at the
// next few hours of weather plus light and bridges. Pure, so it can be tested.
import { shortHour } from "./seattle-time";
import type { Alert, Hour } from "./weather";

const WINDOW_HOURS = 3; // a commute, give or take
const RAIN_LIKELY = 60; // %
const RAIN_MAYBE = 40;
const WINDY_MPH = 15;
const TOO_WINDY_MPH = 25;
const FREEZING_F = 32;
const NEAR_FREEZING_F = 36;
const BRIDGE_LIKELY = 0.4;
// Alerts that make riding risky rather than just unpleasant.
const SEVERE = /wind|winter|ice|snow|storm|flood|freez|smoke|air quality/i;

export type Tone = "good" | "fair" | "poor";

export interface VerdictInput {
  now: Date;
  hours: Hour[];
  alerts: Alert[];
  sunrise: Date; // today's
  sunset: Date;
  bridges: { name: string; chance: number }[]; // this hour, live-logged bridges only
}

export interface Verdict {
  tone: Tone;
  headline: string; // "Good to ride"
  short: string; // "Good to ride · 53°" for the phone badge
  details: string[]; // "dry, 53°", "sunset 6:05p", …
}

const worse = (a: Tone, b: Tone): Tone => (a === "poor" || b === "poor" ? "poor" : a === "fair" || b === "fair" ? "fair" : "good");

export function verdict(input: VerdictInput): Verdict | null {
  const t = input.now.getTime();
  const next = input.hours.filter((h) => h.start.getTime() + 3_600_000 > t).slice(0, WINDOW_HOURS);
  if (!next.length) return null;

  let tone: Tone = "good";
  let headline = "Good to ride";
  const details: string[] = [];
  // The first problem found names the headline; later ones only add detail.
  const flag = (level: Tone, title: string, detail: string) => {
    if (tone === "good") headline = title;
    tone = worse(tone, level);
    details.push(detail);
  };

  const severe = input.alerts.find((a) => SEVERE.test(a.event));
  if (severe) flag("poor", severe.event, "check the alert under Weather");
  else if (input.alerts.length) details.push(input.alerts[0].event.toLowerCase());

  const temp = next[0].tempF;
  const coldest = Math.min(...next.map((h) => h.tempF));
  const wettest = next.reduce((a, b) => (b.rainChance > a.rainChance ? b : a));
  const windiest = Math.max(...next.map((h) => h.windMph));
  const firstRain = next.find((h) => h.rainChance >= RAIN_LIKELY);

  if (coldest <= FREEZING_F) flag("poor", "Icy spots likely", `${coldest}°, watch for ice`);
  else if (coldest <= NEAR_FREEZING_F) flag("fair", "Near freezing", `${coldest}°, watch for slick spots`);

  if (firstRain) {
    const when = firstRain === next[0] ? "now" : `from ${shortHour(firstRain.start)}`;
    flag("fair", "Rain likely", `rain ${when} (${firstRain.rainChance}%)`);
  } else if (wettest.rainChance >= RAIN_MAYBE) {
    details.push(`${wettest.rainChance}% chance of rain`);
  }

  if (windiest >= TOO_WINDY_MPH) flag("poor", "Very windy", `wind to ${windiest} mph`);
  else if (windiest >= WINDY_MPH) flag("fair", "Windy", `wind to ${windiest} mph`);

  // Lead with the plain conditions when nothing's wrong.
  if (tone === "good") details.unshift(`${wettest.rainChance < RAIN_MAYBE ? "dry" : "showers possible"}, ${temp}°`);

  // Light: say when it gets dark (or light) within the ride window.
  const soon = t + WINDOW_HOURS * 3_600_000;
  if (t < input.sunrise.getTime()) details.push(`dark until ${shortHour(input.sunrise)}`);
  else if (t >= input.sunset.getTime()) details.push(`dark, lights on`);
  else if (input.sunset.getTime() <= soon) details.push(`dark by ${shortHour(input.sunset)}`);

  const opening = input.bridges.filter((b) => b.chance >= BRIDGE_LIKELY).map((b) => b.name);
  if (opening.length) details.push(`${opening.slice(0, 2).join(" & ")} ${opening.length === 1 ? "bridge" : "bridges"} may open`);

  return { tone, headline, short: `${headline} · ${temp}°`, details };
}
