// Facility types, colors and traffic levels shared by the map layers and the legend.
// Separated facilities use cool colors; shared ones are neutral greys so the
// traffic colors laid over them read clearly.

export type Facility =
  | "trail"
  | "protected"
  | "greenway"
  | "buffered"
  | "painted"
  | "climbing"
  | "sharrow";

export interface FacilityStyle {
  label: string;
  color: string;
  dash?: [number, number];
}

export const SEPARATED: Partial<Record<Facility, FacilityStyle>> = {
  trail: { label: "Trail", color: "#38bdf8" },
  protected: { label: "Protected lane", color: "#818cf8" },
  greenway: { label: "Neighborhood greenway", color: "#c4b5fd", dash: [2, 1.5] },
};

export const SHARED: Partial<Record<Facility, FacilityStyle>> = {
  buffered: { label: "Buffered lane", color: "#e7e5e4" },
  painted: { label: "Painted lane", color: "#a8a29e" },
  climbing: { label: "Climbing lane", color: "#a8a29e", dash: [3, 1] },
  sharrow: { label: "Sharrow", color: "#78716c", dash: [1, 1.5] },
};

// TomTom relative flow: traffic_level = current speed / free-flow speed (0–1).
export const TRAFFIC = [
  { label: "Moving freely", min: 0.75, color: "#22c55e" },
  { label: "Slowing", min: 0.4, color: "#f59e0b" },
  { label: "Backed up", min: 0, color: "#ef4444" },
] as const;

export const trafficFor = (level: number) => TRAFFIC.find((t) => level >= t.min) ?? TRAFFIC[2];
