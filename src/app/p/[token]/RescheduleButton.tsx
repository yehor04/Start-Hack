"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; startsAt: string; treatment: string; practitioner: string | null; durationMin: number };

function fmt(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} · ${time}`;
}

export default function RescheduleButton({ slotId }: { slotId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [options, setOptions] = useState<Option[] | null>(null);
  const router = useRouter();

  async function openPicker() {
    setOpen(true);
    setLoading(true);
    try {
      const r = await fetch(`/api/slots/${slotId}/reschedule`, { cache: "no-store" });
      const data = await r.json();
      setOptions(data.options ?? []);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }

  async function pick(newSlotId: string) {
    setBusyId(newSlotId);
    try {
      await fetch(`/api/slots/${slotId}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newSlotId }),
      });
      setTimeout(() => router.refresh(), 500);
    } catch {
      setBusyId(null);
    }
  }

  if (!open) {
    return (
      <button className="btn primary" onClick={openPicker}>
        Reschedule appointment
      </button>
    );
  }

  return (
    <div className="resched">
      <div className="resched-head">
        <span>Choose a new time</span>
        <button className="resched-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
      </div>
      {loading && <div className="resched-empty">Loading available times…</div>}
      {!loading && options && options.length === 0 && (
        <div className="resched-empty">No other times are available right now. Please contact the clinic.</div>
      )}
      {!loading &&
        options?.map((o) => (
          <button key={o.id} className="resched-opt" onClick={() => pick(o.id)} disabled={!!busyId}>
            <span className="ro-when">{fmt(o.startsAt)}</span>
            <span className="ro-doc">{o.practitioner ?? "Clinic"}</span>
            <span className="ro-go">{busyId === o.id ? "Booking…" : "Select →"}</span>
          </button>
        ))}
    </div>
  );
}
