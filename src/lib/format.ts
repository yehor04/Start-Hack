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

export function ago(d: Date | string): string {
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}
