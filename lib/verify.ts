/**
 * Heuristic authenticity scoring for SinoTrack-style GPS trackers.
 *
 * Nothing here can *prove* a unit is genuine: SinoTrack publishes no public
 * serial-verification endpoint, and clone firmware is evolving. The engine
 * combines (1) offline-verifiable identifier checks, (2) SMS-command
 * fingerprinting (genuine units answer RCONF; many clones answer only CXZT
 * with a different, GT06-style status string), and (3) physical/commercial
 * signals, then reports a confidence score with the evidence behind it.
 */

export type Tri = "yes" | "no" | "unsure";
export type SmsState = "reply" | "none" | "unsure";
export type Platform = "sinotrackpro" | "clone-app" | "unsure";
export type Status = "pass" | "warn" | "fail" | "unknown";
export type Category = "Identifiers" | "Firmware fingerprint" | "Platform" | "Physical & commercial";

export interface VerifyInput {
  model: string;
  imei: string;
  deviceId?: string;
  rconfSms: SmsState;
  rconfText?: string;
  cxztSms: SmsState;
  cxztText?: string;
  platform: Platform;
  /** Physical / commercial checklist answers keyed by checklist id. */
  checklist: Record<string, Tri>;
}

export interface Check {
  id: string;
  category: Category;
  label: string;
  status: Status;
  weight: number;
  /** A hard failure caps the score and forces a counterfeit verdict. */
  hard?: boolean;
  detail: string;
}

export type Verdict = "likely-genuine" | "inconclusive" | "likely-counterfeit";

export interface VerifyResult {
  verdict: Verdict;
  score: number; // 0-100 authenticity confidence
  coverage: number; // 0-1 share of total check weight that could be evaluated
  checks: Check[];
  parsed: {
    imei?: string;
    reportedId?: string;
    firmware?: string;
    cloneStyleStatus: boolean;
  };
  nextSteps: string[];
}

export const MODELS = [
  "ST-901", "ST-901L", "ST-901M", "ST-901 4G", "ST-903", "ST-906", "ST-906L", "ST-907", "ST-915", "ST-935", "Other / unknown",
] as const;

export interface ChecklistItem {
  id: string;
  label: string;
  help: string;
  /** Answer that indicates a *genuine-looking* unit. */
  good: Tri;
  weight: number;
}

export const CHECKLIST: ChecklistItem[] = [
  {
    id: "labelClean",
    label: "Label is cleanly printed (not a peel-off sticker over another label)",
    help: "Check the housing label under good light. Misaligned, glossy overlay stickers, or a second label beneath are common repackaging signs.",
    good: "yes",
    weight: 4,
  },
  {
    id: "labelMatches",
    label: "IMEI/ID printed on the label matches what the device reports by SMS",
    help: "Compare the label, the box, and the RCONF / CXZT reply digit by digit.",
    good: "yes",
    weight: 8,
  },
  {
    id: "manual",
    label: "Box includes a printed manual listing SMS commands and the login ID/password",
    help: "Genuine retail units normally ship with a card or booklet carrying the platform ID.",
    good: "yes",
    weight: 3,
  },
  {
    id: "priceTooLow",
    label: "Price is far below what established resellers charge",
    help: "Marketplace listings at a fraction of the usual price are the most common source of clones.",
    good: "no",
    weight: 3,
  },
  {
    id: "authorizedSeller",
    label: "Bought from an established reseller or the official store",
    help: "Unknown marketplace sellers, unbranded repackagers, and generic wholesale listings score as unknown/no.",
    good: "yes",
    weight: 4,
  },
  {
    id: "sealedGasket",
    label: "Housing has a gasket/seal and the cover closes flush (waterproof models)",
    help: "Applicable to the ST-901 family. Loose fit, no gasket, or glued shells point to a copy.",
    good: "yes",
    weight: 2,
  },
  {
    id: "ledsMatch",
    label: "LED behaviour matches the manual (e.g. blue = GPS, orange = GSM on ST-901)",
    help: "Different colours or no indicator behaviour at all is a mismatch. Check your model's manual.",
    good: "yes",
    weight: 2,
  },
];

/* ----------------------------- identifier checks ----------------------------- */

export function normalizeDigits(s: string | undefined): string {
  return (s ?? "").replace(/[\s-]/g, "");
}

export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export function luhnCheckDigit(first14: string): number {
  // Appends a placeholder 0, finds the digit that makes the sum divisible by 10.
  for (let c = 0; c < 10; c++) if (luhnValid(first14 + c)) return c;
  return 0;
}

function isTrivialPattern(d: string): boolean {
  if (/^(\d)\1+$/.test(d)) return true; // 111111111111111
  if ("01234567890123456789".includes(d) || "98765432109876543210".includes(d)) return true;
  if (/^(\d{2,5})\1+\d{0,4}$/.test(d) && new Set(d).size <= 3) return true;
  return false;
}

/** Parse GT06-style clone status replies, e.g. `J14_M216_GT06_418_V4.18*ID:864943043842042*185.119.17.42:5023*...` */
const CLONE_STATUS = /^\s*([A-Za-z]\d{1,3}_[A-Za-z]?\d{1,4}_[A-Za-z0-9]+_\d+_V[\d.]+)\*ID:(\d{8,15})\*/;

export function parseCloneStatus(text: string | undefined) {
  if (!text) return null;
  const m = CLONE_STATUS.exec(text);
  if (!m) return null;
  return { firmware: m[1], id: m[2] };
}

/** Pull an ID out of an RCONF-style configuration reply. */
export function parseRconfId(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = /\bID\b[^0-9\n]{0,40}(\d{8,15})/i.exec(text) || /(\d{15})/.exec(text) || /(\d{10,11})/.exec(text);
  return m?.[1];
}

/* ------------------------------------ engine ------------------------------------ */

export function verify(input: VerifyInput): VerifyResult {
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);

  const imei = normalizeDigits(input.imei);
  const deviceId = normalizeDigits(input.deviceId);

  /* --- Identifiers --- */
  if (!imei) {
    add({ id: "imei-present", category: "Identifiers", label: "IMEI supplied", status: "unknown", weight: 6, detail: "No IMEI entered. The IMEI is printed on the label and returned by most SMS status commands." });
  } else if (!/^\d{15}$/.test(imei)) {
    add({ id: "imei-format", category: "Identifiers", label: "IMEI is exactly 15 digits", status: "fail", weight: 8, hard: true, detail: `Got ${imei.length} characters. Genuine cellular modules report a 15-digit IMEI; many clones expose a shorter proprietary ID instead.` });
  } else {
    add({ id: "imei-format", category: "Identifiers", label: "IMEI is exactly 15 digits", status: "pass", weight: 2, detail: "Format is valid." });
    const luhn = luhnValid(imei);
    add({
      id: "imei-luhn",
      category: "Identifiers",
      label: "IMEI passes the Luhn check digit",
      status: luhn ? "pass" : "fail",
      weight: 8,
      hard: !luhn,
      detail: luhn ? "Check digit is consistent." : `Check digit is wrong; the last digit should be ${luhnCheckDigit(imei.slice(0, 14))}. Invalid check digits are a strong sign of a fabricated or mistyped IMEI.`,
    });
    const trivial = isTrivialPattern(imei);
    add({ id: "imei-pattern", category: "Identifiers", label: "IMEI is not a trivial/repeating pattern", status: trivial ? "fail" : "pass", weight: 6, hard: trivial, detail: trivial ? "Repeating or sequential digits are a typical placeholder." : "No obvious placeholder pattern." });
    const testTac = imei.startsWith("00");
    add({ id: "imei-tac", category: "Identifiers", label: "IMEI does not use a GSMA test TAC range", status: testTac ? "fail" : "pass", weight: 5, hard: testTac, detail: testTac ? "TACs beginning with 00 are reserved for test equipment and should never ship on retail devices." : "The Type Allocation Code (first 8 digits) is not in the reserved test range. Whether it is allocated to the claimed manufacturer needs a GSMA/IMEI database lookup, which this app does not perform." });
  }

  if (deviceId) {
    const okLen = /^\d{10,11}$/.test(deviceId) || /^\d{15}$/.test(deviceId);
    add({ id: "id-format", category: "Identifiers", label: "Platform/device ID has a plausible format", status: okLen ? "pass" : "warn", weight: 2, detail: okLen ? "Length matches observed 10-11 digit (or IMEI-style 15 digit) IDs." : "Observed SinoTrack IDs are 10-11 digits or the 15-digit IMEI. Verify against your manual." });
  }

  /* --- Firmware fingerprint --- */
  const clone = parseCloneStatus(input.cxztText);
  const rconfId = parseRconfId(input.rconfText);
  const reported = clone?.id ?? rconfId;

  if (input.rconfSms === "reply") {
    const looksReal = !!input.rconfText && input.rconfText.trim().length > 20;
    add({
      id: "rconf-reply",
      category: "Firmware fingerprint",
      label: "Device answers the RCONF configuration command",
      status: "pass",
      weight: looksReal ? 10 : 8,
      detail: "Reports from the Traccar and GPS-Trace communities treat an RCONF reply as the practical marker of original SinoTrack firmware.",
    });
  } else if (input.rconfSms === "none") {
    add({
      id: "rconf-reply",
      category: "Firmware fingerprint",
      label: "Device answers the RCONF configuration command",
      status: "fail",
      weight: 10,
      detail: "No reply. Confirm the SIM can send/receive SMS and the device is powered and registered on the network first; clones are known to ignore RCONF and use different syntax.",
    });
  } else {
    add({ id: "rconf-reply", category: "Firmware fingerprint", label: "Device answers the RCONF configuration command", status: "unknown", weight: 10, detail: "Not tested. Send RCONF by SMS to the tracker's SIM number and paste the reply." });
  }

  if (clone) {
    add({
      id: "clone-status",
      category: "Firmware fingerprint",
      label: "CXZT reply does not match known clone status format",
      status: "fail",
      weight: 10,
      hard: true,
      detail: `Reply has the clone-style format "${clone.firmware}*ID:${clone.id}*…" (GT06-derived firmware string). Seen on units sold as ST-901 that run third-party firmware with their own cloud lock-in.`,
    });
  } else if (input.cxztSms === "reply") {
    add({ id: "clone-status", category: "Firmware fingerprint", label: "CXZT reply does not match known clone status format", status: "pass", weight: 4, detail: "Reply does not match the GT06-style clone pattern. This is a negative test only; absence of a match is not proof." });
  } else if (input.cxztSms === "none") {
    add({ id: "clone-status", category: "Firmware fingerprint", label: "CXZT reply does not match known clone status format", status: "unknown", weight: 4, detail: "No CXZT reply to inspect." });
  } else {
    add({ id: "clone-status", category: "Firmware fingerprint", label: "CXZT reply does not match known clone status format", status: "unknown", weight: 4, detail: "Not tested. Send CXZT and paste the reply to look for clone-style status strings." });
  }

  if (reported && imei && /^\d{15}$/.test(imei)) {
    const same = reported === imei || reported === imei.slice(0, reported.length) || imei.endsWith(reported);
    const idMatch = deviceId && reported === deviceId;
    add({
      id: "id-consistency",
      category: "Firmware fingerprint",
      label: "ID reported by the device matches the IMEI/ID you entered",
      status: same || idMatch ? "pass" : "fail",
      weight: 7,
      detail: same || idMatch ? "Over-the-air identity matches the printed identity." : `Device reported ${reported}, which does not match the entered IMEI ${imei}. A relabelled or cloned board commonly reports a different identity.`,
    });
  }

  /* --- Platform --- */
  if (input.platform === "sinotrackpro") {
    add({ id: "platform", category: "Platform", label: "Registers on the official SinoTrack platform/app", status: "pass", weight: 6, detail: "Device logs in with its printed ID on the SinoTrack PRO platform and shows live data." });
  } else if (input.platform === "clone-app") {
    add({ id: "platform", category: "Platform", label: "Registers on the official SinoTrack platform/app", status: "fail", weight: 6, detail: "A rebranded or lookalike app (for example TrackerKing) with expiring \"Device Expired\" licences is a recurring symptom of clone hardware." });
  } else {
    add({ id: "platform", category: "Platform", label: "Registers on the official SinoTrack platform/app", status: "unknown", weight: 6, detail: "Not tested. Try logging in with the printed ID and default password." });
  }

  /* --- Physical & commercial --- */
  for (const item of CHECKLIST) {
    const ans = input.checklist?.[item.id] ?? "unsure";
    const status: Status = ans === "unsure" ? "unknown" : ans === item.good ? "pass" : "fail";
    add({ id: item.id, category: "Physical & commercial", label: item.label, status, weight: item.weight, detail: item.help });
  }

  /* --- scoring --- */
  let earned = 0;
  let possible = 0;
  let total = 0;
  for (const c of checks) {
    total += c.weight;
    if (c.status === "unknown") continue;
    possible += c.weight;
    earned += c.weight * (c.status === "pass" ? 1 : c.status === "warn" ? 0.5 : 0);
  }
  const coverage = total === 0 ? 0 : possible / total;
  let score = possible === 0 ? 50 : Math.round((earned / possible) * 100);
  const hardFail = checks.some((c) => c.hard && c.status === "fail");
  if (hardFail) score = Math.min(score, 20);
  // Thin evidence pulls toward the middle instead of claiming certainty.
  if (coverage < 0.4 && !hardFail) score = Math.round(50 + (score - 50) * (coverage / 0.4));

  let verdict: Verdict;
  if (hardFail || score < 45) verdict = "likely-counterfeit";
  else if (score >= 80 && coverage >= 0.5) verdict = "likely-genuine";
  else verdict = "inconclusive";

  /* --- next steps --- */
  const nextSteps: string[] = [];
  if (!imei) nextSteps.push("Enter the 15-digit IMEI from the label so the identifier checks can run.");
  if (input.rconfSms === "unsure") nextSteps.push("Send RCONF by SMS from a phone to the tracker's SIM number and paste the reply.");
  if (input.cxztSms === "unsure") nextSteps.push("Send CXZT as well; clone firmware often answers only this command, with a GT06-style status string.");
  if (input.platform === "unsure") nextSteps.push("Log in to the official SinoTrack platform with the printed ID and confirm the unit reports there.");
  if (imei && /^\d{15}$/.test(imei)) nextSteps.push("Look the TAC (first 8 digits of the IMEI) up in an IMEI database to confirm it is allocated to the claimed manufacturer.");
  nextSteps.push("Compare the PCB and cellular/GNSS modules against a verified unit or the manufacturer's published teardown if the housing can be opened.");
  if (verdict === "likely-counterfeit") nextSteps.push("Ask the seller for a refund or chargeback while the dispute window is open, and keep photos of the label, box, and SMS replies as evidence.");

  return {
    verdict,
    score,
    coverage: Math.round(coverage * 100) / 100,
    checks,
    parsed: { imei: imei || undefined, reportedId: reported, firmware: clone?.firmware, cloneStyleStatus: !!clone },
    nextSteps,
  };
}
