export function treatmentLabel(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function timeLabel(d: Date | string): string {
  const x = new Date(d);
  return x.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function weekdayLabel(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", { weekday: "short" });
}

export function euro(n: number): string {
  return "€" + n.toLocaleString("en-GB");
}
