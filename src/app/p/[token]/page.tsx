import { getDemoAppointment, getPatientByName } from "@/lib/queries";
import { treatmentLabel, timeLabel } from "@/lib/format";
import CancelButton from "./CancelButton";
import RescheduleButton from "./RescheduleButton";
import SeenSoonerToggle from "./SeenSoonerToggle";

export const dynamic = "force-dynamic";

export default async function PatientPage() {
  const appt = await getDemoAppointment();
  const patient = await getPatientByName(appt?.bookedPatientName);

  return (
    <div className="patient-app">
      <div className="phone">
        <div className="clinic">
          <div className="pbadge">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" />
            </svg>
          </div>
          <div>
            <div className="cnm">Vienna Smile Dental</div>
            <div className="csub">Appointment management</div>
          </div>
        </div>

        {appt && appt.status === "booked" ? (
          <Booked appt={appt} patient={patient} />
        ) : (
          <div>
            <p className="hi">Thanks{appt?.recoveredBy ? "" : ""},</p>
            <h1 className="lead">Your slot has been released.</h1>
            <div className="done">
              <h2>All done</h2>
              <p>
                We’ve released your appointment and we’re offering it to another patient who’s been
                waiting. You’ll get a confirmation shortly. Need a new time? Just contact the clinic.
              </p>
            </div>
            <div className="foot">
              <a href="#">Contact clinic</a>
              <div className="powered">Powered by <b>Refill</b></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Booked({ appt, patient }: { appt: any; patient: any }) {
  const d = new Date(appt.startsAt);
  const month = d.toLocaleDateString("en-GB", { month: "short" }).toUpperCase();
  const day = d.getDate();
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  const end = new Date(d.getTime() + (appt.durationMin || 30) * 60000);
  return (
    <>
      <p className="hi">Hello {appt.bookedPatientName?.split(" ")[0] ?? "there"},</p>
      <h1 className="lead">Here’s your upcoming appointment.</h1>

      <div className="pcard">
        <div className="cardtop">
          <div className="cal">
            <div className="m">{month}</div>
            <div className="d">{day}</div>
          </div>
          <div style={{ flex: 1 }}>
            <span className="ppill">Confirmed</span>
            <div className="ptreat">{treatmentLabel(appt.treatment)}</div>
            <div className="when">
              {weekday} · {timeLabel(d)} – {timeLabel(end)}
            </div>
          </div>
        </div>
        <div className="rows">
          <div className="prow">
            <span className="ic">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></svg>
            </span>
            <div>
              <div className="k">Practitioner</div>
              <div className="v">{appt.practitioner ?? "—"}</div>
            </div>
          </div>
          <div className="prow">
            <span className="ic">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s-7-4.5-7-10a7 7 0 0 1 14 0c0 5.5-7 10-7 10z" /><circle cx="12" cy="11" r="2.5" /></svg>
            </span>
            <div>
              <div className="k">Location</div>
              <div className="v">{appt.room ?? "Clinic"} · Mariahilfer Str. 12, Wien</div>
            </div>
          </div>
        </div>
      </div>

      <div className="actions">
        <RescheduleButton slotId={appt.id} />
        <CancelButton slotId={appt.id} />
      </div>

      <div className="nudge">
        <div>
          <div className="nt">Want to be seen sooner?</div>
          <div className="nd">If an earlier slot opens up, we’ll call you to offer it. You can opt out any time.</div>
        </div>
        {patient ? (
          <SeenSoonerToggle name={patient.name} initial={patient.consentOutbound} />
        ) : (
          <div className="switch" />
        )}
      </div>

      <div className="foot">
        <a href="#">Add to calendar</a>
        <a href="#">Contact clinic</a>
        <div className="powered">Powered by <b>Refill</b></div>
      </div>
    </>
  );
}
