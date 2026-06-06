"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CancelButton({ slotId }: { slotId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function cancel() {
    setBusy(true);
    await fetch(`/api/slots/${slotId}/cancel`, { method: "POST" }).catch(() => {});
    // small pause so the loop starts, then refresh to the "released" state
    setTimeout(() => router.refresh(), 600);
  }

  return (
    <button className="btn danger" onClick={cancel} disabled={busy}>
      {busy ? "Releasing…" : "Cancel appointment"}
    </button>
  );
}
