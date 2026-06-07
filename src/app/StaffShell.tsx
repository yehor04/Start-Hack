"use client";
import { useCallback, useEffect, useState } from "react";
import { treatmentLabel, timeLabel, euro } from "@/lib/format";

type Slot = {
  id: string;
  startsAt: string;
  treatment: string;
  practitioner: string | null;
  room: string | null;
  valueEur: number;
  status: string;
  bookedPatientName: string | null;
  recoveredBy: string | null;
  durationMin: number;
};
type Candidate = {
  name: string;
  score: number;
  likelihood: number;
  urgency: number;
  eligible: boolean;
  reason: string;
  status: string;
};
type State = {
  schedule: Slot[];
  recovery: { slot: Slot; candidates: Candidate[]; activity: { id: string; type: string; payload: string; createdAt: string }[] } | null;
  kpis: { recovered: number; revenue: number; open: number; onCall: number };
};

const initials = (n: string) => n.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();

export default function StaffShell() {
  const [persona, setPersona] = useState<"reception" | "owner">("reception");
  const [tab, setTab] = useState<"schedule" | "recovery">("schedule");
  const [s, setS] = useState<State | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      setS(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load]);

  async function cancel(id: string) {
    await fetch(`/api/slots/${id}/cancel`, { method: "POST" }).catch(() => {});
    setTab("recovery");
    load();
  }

  return (
    <div className="wrap">
      <div className="top">
        <div className="brand"><div className="mark" /><div className="wordmark">Refill</div></div>
        <div className="topright">
          <div className="seg">
            <button className={persona === "reception" ? "on" : ""} onClick={() => setPersona("reception")}>Reception</button>
            <button className={persona === "owner" ? "on" : ""} onClick={() => setPersona("owner")}>Owner</button>
          </div>
          <div className="live"><span className="dot" /> Live</div>
          <div className="avatar">AD</div>
        </div>
      </div>

      {persona === "owner" ? (
        <Owner kpis={s?.kpis} />
      ) : (
        <>
          <div className="tabsrow">
            <div className="tabs">
              <button className={tab === "schedule" ? "on" : ""} onClick={() => setTab("schedule")}>Schedule</button>
              <button className={tab === "recovery" ? "on" : ""} onClick={() => setTab("recovery")}>Recovery</button>
            </div>
            <div className="tmeta">Patient-benefit dispatcher · auto-dialling via fonio</div>
          </div>
          {tab === "schedule" ? (
            <Schedule slots={s?.schedule ?? []} onCancel={cancel} onView={() => setTab("recovery")} />
          ) : (
            <Recovery rec={s?.recovery ?? null} kpis={s?.kpis} />
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- Schedule ---------------- */
function Schedule({ slots, onCancel, onView }: { slots: Slot[]; onCancel: (id: string) => void; onView: () => void }) {
  const filling = slots.filter((x) => x.status === "filling").length;
  const recovered = slots.filter((x) => x.status === "filled" && x.recoveredBy);
  const recRevenue = recovered.reduce((a, b) => a + b.valueEur, 0);
  return (
    <>
      <div className="toolbar">
        <div className="date"><div className="nav">‹</div> Today’s schedule <div className="nav">›</div></div>
        <div className="schips">
          <span className="schip"><b>{slots.length}</b> appointments</span>
          <span className="schip i"><b>{filling}</b> filling</span>
          <span className="schip g"><b>{recovered.length}</b> recovered · {euro(recRevenue)}</span>
        </div>
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr><th>Time</th><th>Patient</th><th>Treatment</th><th>Practitioner</th><th>Value</th><th>Status</th><th className="act">Action</th></tr>
          </thead>
          <tbody>
            {slots.map((sl) => (
              <tr key={sl.id}>
                <td className="time">{timeLabel(sl.startsAt)}</td>
                <td className="who">
                  {sl.status === "filled" && sl.recoveredBy ? (<>{sl.recoveredBy} <span className="recby">· via Refill</span></>)
                    : sl.status === "filling" ? (<span className="recby">— recovering…</span>)
                    : sl.bookedPatientName ?? "—"}
                </td>
                <td className="treat">{treatmentLabel(sl.treatment)}</td>
                <td className="doc">{sl.practitioner ?? "—"}</td>
                <td className="val">{euro(sl.valueEur)}</td>
                <td>
                  {sl.status === "booked" && <span className="st st-booked">Booked</span>}
                  {sl.status === "filling" && <span className="st st-fill"><span className="pulse" /> Filling…</span>}
                  {sl.status === "filled" && <span className="st st-rec">✓ Recovered</span>}
                  {sl.status === "open" && <span className="st st-open">Open</span>}
                  {sl.status === "escalated" && <span className="st st-open">⚠ Needs human</span>}
                  {sl.status === "lost" && <span className="st st-open">⏰ Lost</span>}
                </td>
                <td className="act">
                  {sl.status === "booked" && <button className="cancel" onClick={() => onCancel(sl.id)}>Cancel</button>}
                  {(sl.status === "filling" || sl.status === "open" || sl.status === "escalated") && <a className="link" onClick={onView} style={{ cursor: "pointer" }}>View in Recovery →</a>}
                  {sl.status === "filled" && <span className="recby">filled ✓</span>}
                </td>
              </tr>
            ))}
            {!slots.length && <tr><td colSpan={7}><div className="empty">No appointments loaded. Run the seed, then refresh.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ---------------- Recovery ---------------- */
function statusPill(st: string) {
  if (st === "calling") return <span className="pill p-call">Calling now</span>;
  if (st === "yes") return <span className="pill p-yes">Booked ✓</span>;
  if (st === "queued") return <span className="pill p-queue">Queued</span>;
  if (st === "excluded") return <span className="pill p-inel">Excluded</span>;
  if (st === "no") return <span className="pill p-skip">Declined</span>;
  if (st === "no_answer") return <span className="pill p-skip">No answer</span>;
  if (st === "voicemail") return <span className="pill p-skip">Voicemail</span>;
  if (st === "callback") return <span className="pill p-skip">Callback</span>;
  if (st === "maybe") return <span className="pill p-queue">Maybe — callback</span>;
  if (st === "optout") return <span className="pill p-inel">Opted out</span>;
  if (st === "wrong_person") return <span className="pill p-skip">Wrong person</span>;
  if (st === "failed") return <span className="pill p-skip">Call failed</span>;
  if (st === "human_requested") return <span className="pill p-call">Wants human</span>;
  return <span className="pill p-queue">{st}</span>;
}
function urgencyChip(u: number) {
  const lvl = u >= 0.7 ? "high" : u >= 0.45 ? "med" : "low";
  return <span className="chip a">Urgency: {lvl}</span>;
}

function Recovery({ rec, kpis }: { rec: State["recovery"]; kpis?: State["kpis"] }) {
  if (!rec) {
    return (
      <div className="panel"><div className="empty">No active recovery. Go to <b>Schedule</b> and cancel an appointment to start the loop.</div></div>
    );
  }
  const { slot, candidates, activity } = rec;
  const calling = candidates.find((c) => c.status === "calling");
  const resolved = candidates.find((c) => ["yes", "no", "no_answer", "voicemail"].includes(c.status));
  const featured = calling ?? resolved;
  return (
    <>
      <div className="kpis">
        <Kpi lab="Open now" v={String(kpis?.open ?? 0)} d="being filled" muted />
        <Kpi lab="On call" v={String(kpis?.onCall ?? 0)} d={calling?.name ?? "—"} muted />
        <Kpi lab="Recovered today" v={`${kpis?.recovered ?? 0} · ${euro(kpis?.revenue ?? 0)}`} d="this session" />
        <Kpi lab="Slot value" v={euro(slot.valueEur)} d="at stake" muted />
      </div>

      <div className="grid">
        <div className="panel">
          <div className="ph"><h3>Active recovery</h3><div className="mt">{treatmentLabel(slot.treatment)}</div></div>
          <div className="pb">
            <div className="slot">
              <div>
                <div className="t">{timeLabel(slot.startsAt)} · {treatmentLabel(slot.treatment)}</div>
                <div className="d">{slot.practitioner ?? "—"} · {slot.room ?? "—"} · {euro(slot.valueEur)} value</div>
              </div>
              {slot.status === "filled"
                ? <div className="badge">✓ Recovered</div>
                : slot.status === "escalated"
                ? <div className="badge">⚠ Needs human</div>
                : slot.status === "lost"
                ? <div className="badge">⏰ Slot lost</div>
                : <div className="badge"><span className="pulse" /> {calling ? "Calling…" : "Filling…"}</div>}
            </div>

            {calling && (
              <div className="callrow">
                <div className="av">{initials(calling.name)}</div>
                <div>
                  <div className="nm13">{calling.name}</div>
                  <div className="calling">On call via fonio · +49 30 82687385</div>
                </div>
                <div className="wave">{[8, 15, 21, 12, 18, 9, 16, 21, 11].map((h, i) => <i key={i} style={{ height: h }} />)}</div>
              </div>
            )}

            <div className="cands">
              {candidates.map((c, i) => (
                <div key={i} className={`cand ${c.status === "calling" ? "active" : ""} ${!c.eligible ? "dim" : ""}`}>
                  <div className={`av ${!c.eligible ? "dimav" : ""}`}>{initials(c.name)}</div>
                  <div style={{ flex: 1 }}>
                    <div className="cname">{c.name}</div>
                    <div className="chips">
                      {c.eligible ? (<>{urgencyChip(c.urgency)}<span className="chip g">Likely {Math.round(c.likelihood * 100)}%</span><span className="chip g">Consent ✓</span></>)
                        : <span className="chip r">{/consent/i.test(c.reason) ? "No outbound consent" : "Not eligible"}</span>}
                    </div>
                    <div className="reason">{c.reason}</div>
                  </div>
                  <div className="score">
                    <div className="snum num">{c.eligible ? c.score.toFixed(2) : <>—<small> n/a</small></>}</div>
                    <div className="bar"><i style={{ width: `${Math.round(c.score * 100)}%` }} /></div>
                    {statusPill(c.status)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="panel">
            <div className="ph"><h3>Human control</h3><div className="mt">always in the loop</div></div>
            <div className="pb">
              <div className="controls"><div className="ctl">Skip candidate</div><div className="ctl">Pause auto-dial</div><div className="ctl">Call manually</div></div>
              <div className="controls" style={{ marginTop: 9 }}><div className="ctl stop">Stop recovery for this slot</div></div>
            </div>
          </div>
          {featured && (
            <div className="panel">
              <div className="ph"><h3>Why {featured.name}?</h3><div className="mt">dispatcher reasoning</div></div>
              <div className="pb">
                {featured.status === "calling" && (
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, color:"#5a8fcf", fontWeight:600 }}>
                    <span className="pulse" style={{ width:8, height:8, borderRadius:"50%", background:"currentColor", flexShrink:0 }} />
                    <span>On call now</span>
                  </div>
                )}
                {featured.status === "yes" && (
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, color:"#6fcf97", fontWeight:600 }}>
                    <span>✓</span><span>Accepted — slot booked</span>
                  </div>
                )}
                {featured.status === "no" && (
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, color:"#C98A6A", fontWeight:600 }}>
                    <span>✗</span><span>Declined — trying next candidate</span>
                  </div>
                )}
                {(featured.status === "no_answer" || featured.status === "voicemail") && (
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, color:"#D9B873", fontWeight:600 }}>
                    <span>↻</span>
                    <span>{featured.status === "voicemail" ? "Voicemail left" : "No answer"} — retrying</span>
                  </div>
                )}
                <div className="reason" style={{ fontSize:14, lineHeight:1.7 }}>
                  {featured.reason}
                </div>
                {featured.status === "yes" && (
                  <div style={{ marginTop:16, padding:"12px 14px", background:"rgba(111,207,151,0.08)", borderRadius:8, border:"1px solid rgba(111,207,151,0.2)" }}>
                    <div style={{ fontWeight:600, fontSize:13, marginBottom:6 }}>Booking confirmed</div>
                    <div style={{ fontSize:13, color:"var(--ink-2)", lineHeight:1.6 }}>
                      <div>{timeLabel(slot.startsAt)} · {treatmentLabel(slot.treatment)}</div>
                      <div>{slot.practitioner ?? "—"} · {slot.room ?? "—"}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="panel">
            <div className="ph"><h3>Live activity</h3><div className="mt">audit trail</div></div>
            <div className="pb">
              <div className="tl">
                {activity.map((e) => <Event key={e.id} type={e.type} payload={e.payload} at={e.createdAt} />)}
                {!activity.length && <div className="empty">No events yet.</div>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Event({ type, payload, at }: { type: string; payload: string; at: string }) {
  let p: any = {};
  try { p = JSON.parse(payload); } catch {}
  const map: Record<string, { dot: string; text: React.ReactNode }> = {
    cancellation: { dot: "g", text: <><b>Cancellation detected</b> — slot freed ({euro(p.value ?? 0)})</> },
    scored: { dot: "i", text: <><b>Ranked {p.candidates} candidates</b>{p.top ? ` — top: ${p.top}` : ""}</> },
    call_started: { dot: "i", text: <><b>Calling {p.patient}</b></> },
    outcome: { dot: p.outcome === "yes" ? "g" : "a", text: <><b>{String(p.outcome).replace(/_/g, " ")}</b> — {p.patient}</> },
    booked: { dot: "g", text: <><b>Booked ✓</b> — {p.patient} ({euro(p.value ?? 0)})</> },
    escalated: { dot: "m", text: <><b>Escalated</b> — {p.why}</> },
    optout: { dot: "m", text: <><b>Opted out</b> — {p.patient} removed from waitlist</> },
    maybe: { dot: "a", text: <><b>Maybe</b> — {p.patient} (callback if needed)</> },
    callback: { dot: "i", text: <><b>Calling back</b> {p.patient}</> },
    call_failed: { dot: "m", text: <><b>Call failed</b> — {p.patient} (manual review)</> },
    lost: { dot: "m", text: <><b>Slot lost ⏰</b> — expired ({euro(p.revenueLost ?? 0)} lost)</> },
    human_requested: {
      dot: "a",
      text: (
        <>
          <b>📞 Caller wants a human</b> — {p.patient}
          {p.summary ? <div className="reason">{p.summary}</div> : null}
        </>
      ),
    },
  };
  const m = map[type] ?? { dot: "m", text: <b>{type}</b> };
  return (
    <div className="ev">
      <div className={`tdot ${m.dot}`} />
      <div className="tx">{m.text}<div className="tm">{timeLabel(at)}</div></div>
    </div>
  );
}

function Kpi({ lab, v, d, muted }: { lab: string; v: string; d: string; muted?: boolean }) {
  return <div className="kpi"><div className="lab">{lab}</div><div className="v num">{v}</div><div className={`d ${muted ? "m" : ""}`}>{d}</div></div>;
}

/* ---------------- Owner ---------------- */
function Owner({ kpis }: { kpis?: State["kpis"] }) {
  return (
    <>
      <div className="hero">
        <div>
          <div className="eyebrow">Revenue recovered</div>
          <h1 className="num">{euro(kpis?.revenue ?? 0)}</h1>
          <div className="sub">live session · <b>{kpis?.recovered ?? 0} slots</b> saved that would have gone empty</div>
        </div>
        <div>
          <svg width="100%" height="92" viewBox="0 0 520 92" preserveAspectRatio="none">
            <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#15885A" stopOpacity="0.18" /><stop offset="1" stopColor="#15885A" stopOpacity="0" /></linearGradient></defs>
            <path d="M0,70 L74,60 L148,64 L222,44 L296,50 L370,30 L444,34 L520,14 L520,92 L0,92 Z" fill="url(#g)" />
            <path d="M0,70 L74,60 L148,64 L222,44 L296,50 L370,30 L444,34 L520,14" fill="none" stroke="#0F6B43" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="520" cy="14" r="4" fill="#0F6B43" />
          </svg>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi donut">
          <div className="ring" style={{ background: "conic-gradient(var(--green) 0 71%, #ECE7DD 71% 100%)" }}><i>71%</i></div>
          <div><div className="lab">Refill rate</div><div className="d">▲ 12 pts vs manual</div></div>
        </div>
        <Kpi lab="Slots recovered" v={String(kpis?.recovered ?? 0)} d="live" />
        <Kpi lab="Avg time-to-fill" v="1m 52s" d="▲ vs ~14 min by hand" />
        <Kpi lab="Open now" v={String(kpis?.open ?? 0)} d="being filled" muted />
      </div>

      <div className="grid">
        <div className="panel">
          <div className="ph"><h3>Recovered revenue</h3><div className="mt">daily · this week</div></div>
          <div className="pb">
            <svg width="100%" height="220" viewBox="0 0 680 220">
              <g stroke="#F2EFE8" strokeWidth="1"><line x1="0" y1="20" x2="680" y2="20" /><line x1="0" y1="70" x2="680" y2="70" /><line x1="0" y1="120" x2="680" y2="120" /><line x1="0" y1="170" x2="680" y2="170" /></g>
              <rect x="24" y="120" width="52" height="90" rx="6" fill="#CDE7D6" /><rect x="118" y="104" width="52" height="106" rx="6" fill="#CDE7D6" /><rect x="212" y="132" width="52" height="78" rx="6" fill="#CDE7D6" /><rect x="306" y="84" width="52" height="126" rx="6" fill="#9FD4B5" /><rect x="400" y="98" width="52" height="112" rx="6" fill="#CDE7D6" /><rect x="494" y="58" width="52" height="152" rx="6" fill="#0F6B43" /><rect x="588" y="74" width="52" height="136" rx="6" fill="#9FD4B5" />
              <g fontFamily="Inter Tight" fontSize="12" fill="#86827A" textAnchor="middle"><text x="50" y="216">Mon</text><text x="144" y="216">Tue</text><text x="238" y="216">Wed</text><text x="332" y="216">Thu</text><text x="426" y="216">Fri</text><text x="520" y="216">Sat</text><text x="614" y="216">Sun</text></g>
            </svg>
            <div className="legend"><span><i style={{ background: "#0F6B43" }} />Best day</span><span><i style={{ background: "#CDE7D6" }} />Daily recovered</span></div>
          </div>
        </div>
        <div className="panel">
          <div className="ph"><h3>Call outcomes</h3><div className="mt">this week</div></div>
          <div className="pb">
            <div className="out">
              <ORow nm="Booked ✓" pct={71} color="#0F6B43" />
              <ORow nm="No answer" pct={14} color="#D9B873" />
              <ORow nm="Declined" pct={9} color="#C98A6A" />
              <ORow nm="Voicemail" pct={6} color="#CBC6BA" />
            </div>
            <div className="vs">
              <div className="vt">Refill vs manual dialling — slots filled</div>
              <div className="vsrow"><div className="vnm">Refill</div><div className="track"><i style={{ width: "71%", background: "#0F6B43" }} /><span>71%</span></div></div>
              <div className="vsrow"><div className="vnm">Manual</div><div className="track"><i style={{ width: "32%", background: "#C9C3B6" }} /><span style={{ color: "#5a564c" }}>32%</span></div></div>
              <div className="note">Manual baseline modelled from 100 simulated cancellations — illustrates policy behaviour, not a production benchmark.</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ORow({ nm, pct, color }: { nm: string; pct: number; color: string }) {
  return <div className="orow"><span className="onm">{nm}</span><div className="otrack"><i style={{ width: `${pct}%`, background: color }} /></div><span className="opct">{pct}%</span></div>;
}
