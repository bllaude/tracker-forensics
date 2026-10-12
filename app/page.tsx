"use client";

import { useState } from "react";
import { CHECKLIST, MODELS, type Check, type Platform, type SmsState, type Tri, type VerifyResult } from "@/lib/verify";

function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { v: T; t: string }[]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>
          {o.t}
        </button>
      ))}
    </div>
  );
}

const SMS_OPTS = [
  { v: "reply" as SmsState, t: "Got a reply" },
  { v: "none" as SmsState, t: "No reply" },
  { v: "unsure" as SmsState, t: "Not tested" },
];
const TRI_OPTS = [
  { v: "yes" as Tri, t: "Yes" },
  { v: "no" as Tri, t: "No" },
  { v: "unsure" as Tri, t: "Not sure" },
];

const VERDICT_COPY = {
  "likely-genuine": { t: "Likely genuine", c: "pass", s: "Evidence is consistent with original SinoTrack hardware and firmware." },
  inconclusive: { t: "Inconclusive", c: "warn", s: "Not enough evidence either way. Run the remaining tests below." },
  "likely-counterfeit": { t: "Likely counterfeit / clone", c: "fail", s: "One or more strong indicators point to a copy or a fabricated identity." },
} as const;

function Gauge({ score, cls }: { score: number; cls: string }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  return (
    <svg className="gauge" viewBox="0 0 92 92" role="img" aria-label={`Authenticity confidence ${score} out of 100`}>
      <circle cx="46" cy="46" r={r} fill="none" stroke="var(--line)" strokeWidth="8" />
      <circle
        cx="46" cy="46" r={r} fill="none" strokeWidth="8" strokeLinecap="round"
        stroke={`var(--${cls})`} strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 46 46)"
      />
      <text x="46" y="52" textAnchor="middle" fontSize="22" fontWeight="700" fill="var(--text)">{score}</text>
    </svg>
  );
}

export default function Home() {
  const [model, setModel] = useState<string>(MODELS[0]);
  const [imei, setImei] = useState("");
  const [deviceId, setDeviceId] = useState("");
  const [rconfSms, setRconfSms] = useState<SmsState>("unsure");
  const [rconfText, setRconfText] = useState("");
  const [cxztSms, setCxztSms] = useState<SmsState>("unsure");
  const [cxztText, setCxztText] = useState("");
  const [platform, setPlatform] = useState<Platform>("unsure");
  const [checklist, setChecklist] = useState<Record<string, Tri>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, imei, deviceId, rconfSms, rconfText, cxztSms, cxztText, platform, checklist }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Request failed");
      setResult(await res.json());
      requestAnimationFrame(() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const grouped = result
    ? result.checks.reduce<Record<string, Check[]>>((acc, c) => ((acc[c.category] ||= []).push(c), acc), {})
    : {};
  const vc = result ? VERDICT_COPY[result.verdict] : null;

  return (
    <main>
      <h1>TrackerCheck</h1>
      <p className="lede">
        Estimate whether a SinoTrack-style GPS tracker (ST-901, ST-906, ST-915 …) is original or a clone. The score combines IMEI
        validation, the tracker&apos;s own SMS replies, platform behaviour and physical checks. Nothing is sent to third parties.
      </p>

      <div className="grid">
        <form className="card" onSubmit={submit}>
          <h2>1 · Identifiers</h2>
          <label htmlFor="model">Model on the label</label>
          <select id="model" value={model} onChange={(e) => setModel(e.target.value)}>
            {MODELS.map((m) => <option key={m}>{m}</option>)}
          </select>

          <label htmlFor="imei">IMEI <span className="hint">(15 digits, printed on the label)</span></label>
          <input id="imei" className="mono" type="text" inputMode="numeric" autoComplete="off" placeholder="490154203237518" value={imei} onChange={(e) => setImei(e.target.value)} />

          <label htmlFor="devid">Platform / device ID <span className="hint">(optional, the login ID in the manual)</span></label>
          <input id="devid" className="mono" type="text" inputMode="numeric" autoComplete="off" placeholder="10–11 digits" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} />

          <h2 style={{ marginTop: 22 }}>2 · SMS fingerprint</h2>
          <p className="hint" style={{ marginTop: 0 }}>Text each command (no extra characters) to the tracker&apos;s SIM number and report what comes back.</p>

          <label>Command <code>RCONF</code></label>
          <Seg label="RCONF result" value={rconfSms} onChange={setRconfSms} options={SMS_OPTS} />
          {rconfSms === "reply" && (
            <textarea aria-label="RCONF reply" placeholder="Paste the reply text here (optional but improves the ID cross-check)" value={rconfText} onChange={(e) => setRconfText(e.target.value)} />
          )}

          <label>Command <code>CXZT</code></label>
          <Seg label="CXZT result" value={cxztSms} onChange={setCxztSms} options={SMS_OPTS} />
          {cxztSms === "reply" && (
            <textarea aria-label="CXZT reply" placeholder="Paste the full reply, e.g. J14_M216_GT06_418_V4.18*ID:…" value={cxztText} onChange={(e) => setCxztText(e.target.value)} />
          )}

          <h2 style={{ marginTop: 22 }}>3 · Platform</h2>
          <label>Where does it show up when you log in with the printed ID?</label>
          <Seg
            label="Platform"
            value={platform}
            onChange={setPlatform}
            options={[
              { v: "sinotrackpro", t: "SinoTrack PRO" },
              { v: "clone-app", t: "Other app / expiry notice" },
              { v: "unsure", t: "Not tested" },
            ]}
          />

          <h2 style={{ marginTop: 22 }}>4 · Physical &amp; purchase</h2>
          {CHECKLIST.map((item) => (
            <div className="row" key={item.id}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{item.label}</div>
              <div className="hint">{item.help}</div>
              <Seg
                label={item.label}
                value={checklist[item.id] ?? "unsure"}
                onChange={(v) => setChecklist((s) => ({ ...s, [item.id]: v }))}
                options={TRI_OPTS}
              />
            </div>
          ))}

          <button className="primary" type="submit" disabled={busy}>{busy ? "Analyzing…" : "Check authenticity"}</button>
          {err && <div className="err" role="alert">{err}</div>}
        </form>

        <div id="result">
          {!result && (
            <div className="card">
              <h2>How it works</h2>
              <ol>
                <li>The IMEI is checked for length, Luhn check digit, placeholder patterns and reserved test ranges.</li>
                <li>Genuine SinoTrack units answer <code>RCONF</code>; many clones answer only <code>CXZT</code> with a GT06-style status string.</li>
                <li>The ID the device reports over the air is compared with the printed one.</li>
                <li>Platform behaviour and physical/purchase signals add weighted evidence.</li>
              </ol>
              <p className="hint" style={{ marginTop: 12 }}>Fill in what you can. Untested items are left out of the score, and low coverage pulls the verdict toward &ldquo;inconclusive&rdquo;.</p>
            </div>
          )}

          {result && vc && (
            <>
              <div className="card">
                <div className="verdict">
                  <Gauge score={result.score} cls={vc.c} />
                  <div>
                    <p className={`vlabel ${vc.c}`}>{vc.t}</p>
                    <p className="vsub">{vc.s}</p>
                    <p className="vsub">Evidence coverage: {Math.round(result.coverage * 100)}%{result.parsed.firmware ? ` · firmware string ${result.parsed.firmware}` : ""}</p>
                  </div>
                </div>
              </div>

              <div className="card">
                <h2>Evidence</h2>
                {Object.entries(grouped).map(([cat, items]) => (
                  <div key={cat}>
                    <div className="cat">{cat}</div>
                    {items.map((c) => (
                      <div className="chk" key={c.id}>
                        <div className="top">
                          <span style={{ fontWeight: 600, fontSize: 14 }}>{c.label}</span>
                          <span className={`pill ${c.status}`}>{c.status === "unknown" ? "untested" : c.status}</span>
                        </div>
                        <p className="d">{c.detail}</p>
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              <div className="card">
                <h2>Next steps</h2>
                <ol>{result.nextSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              </div>
            </>
          )}
        </div>
      </div>

      <p className="disc">
        This is a heuristic assessment, not a certificate. Clone firmware changes over time and an original unit can fail a test because of SIM, network or command-password
        issues. A &ldquo;likely genuine&rdquo; result is not a guarantee, and a &ldquo;likely counterfeit&rdquo; result should be confirmed with the seller or manufacturer.
      </p>
    </main>
  );
}
