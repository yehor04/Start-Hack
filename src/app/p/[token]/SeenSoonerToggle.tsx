"use client";
import { useState } from "react";

export default function SeenSoonerToggle({ name, initial }: { name: string; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !on;
    setOn(next); // optimistic
    setBusy(true);
    try {
      const r = await fetch("/api/patient/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, enabled: next }),
      });
      if (!r.ok) setOn(!next); // revert on failure
    } catch {
      setOn(!next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`switch${on ? "" : " off"}`}
      onClick={toggle}
      disabled={busy}
      role="switch"
      aria-checked={on}
      aria-label="Call me if an earlier slot opens up"
    />
  );
}
