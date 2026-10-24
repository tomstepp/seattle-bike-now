// Hourly forecast and active alerts from the National Weather Service.
// Free, no key, CORS-enabled, so the browser fetches it directly.

// Forecast grid cell covering central Seattle (from api.weather.gov/points/47.62,-122.35).
const HOURLY_URL = "https://api.weather.gov/gridpoints/SEW/124,69/forecast/hourly";
const ALERTS_URL = "https://api.weather.gov/alerts/active?point=47.62,-122.35";

export interface Hour {
  start: Date;
  tempF: number;
  rainChance: number; // 0–100
  windMph: number; // top of the forecast range
  windDir: string; // "SSW"
  sky: string; // "Mostly Cloudy"
}

export interface Alert {
  event: string; // "Wind Advisory"
  headline: string;
}

interface NwsPeriod {
  startTime: string;
  temperature: number;
  probabilityOfPrecipitation: { value: number | null };
  windSpeed: string; // "5 mph" or "5 to 10 mph"
  windDirection: string;
  shortForecast: string;
}

export async function fetchHourly(): Promise<Hour[]> {
  const res = await fetch(HOURLY_URL, { headers: { accept: "application/geo+json" } });
  if (!res.ok) throw new Error(`NWS forecast: HTTP ${res.status}`);
  const periods = ((await res.json()) as { properties: { periods: NwsPeriod[] } }).properties.periods;
  return periods.map((p) => ({
    start: new Date(p.startTime),
    tempF: p.temperature,
    rainChance: p.probabilityOfPrecipitation.value ?? 0,
    windMph: Math.max(...(p.windSpeed.match(/\d+/g) ?? ["0"]).map(Number)),
    windDir: p.windDirection,
    sky: p.shortForecast,
  }));
}

export async function fetchAlerts(): Promise<Alert[]> {
  const res = await fetch(ALERTS_URL, { headers: { accept: "application/geo+json" } });
  if (!res.ok) throw new Error(`NWS alerts: HTTP ${res.status}`);
  const features = ((await res.json()) as { features: { properties: Alert }[] }).features;
  return features.map((f) => ({ event: f.properties.event, headline: f.properties.headline }));
}

// Thresholds a rider cares about.
export const RAIN_LIKELY = 40; // %
export const WINDY_MPH = 15;
