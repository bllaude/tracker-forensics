import { test } from "node:test";
import assert from "node:assert/strict";
import { luhnValid, luhnCheckDigit, parseCloneStatus, parseRconfId, verify, type VerifyInput } from "./verify";

const base: VerifyInput = {
  model: "ST-901",
  imei: "",
  rconfSms: "unsure",
  cxztSms: "unsure",
  platform: "unsure",
  checklist: {},
};

test("luhn accepts the textbook IMEI and rejects a corrupted one", () => {
  assert.equal(luhnValid("490154203237518"), true);
  assert.equal(luhnValid("490154203237519"), false);
  assert.equal(luhnCheckDigit("49015420323751"), 8);
});

test("clone status string is parsed from the forum sample", () => {
  const s = "J14_M216_GT06_418_V4.18*ID:864943043842042*185.119.17.42:5023*0.0.0.0*A:iot.1nce.net*G:A|0*DCS:25*POW:1*ACC:1*F:30*R:15|75382|3638*S:180|0*BAT:3.98V";
  const p = parseCloneStatus(s);
  assert.equal(p?.id, "864943043842042");
  assert.equal(p?.firmware, "J14_M216_GT06_418_V4.18");
});

test("rconf id extraction", () => {
  assert.equal(parseRconfId("Tracker identification number in format ID: 9171234567"), "9171234567");
});

test("invalid luhn forces counterfeit verdict", () => {
  const r = verify({ ...base, imei: "490154203237519" });
  assert.equal(r.verdict, "likely-counterfeit");
  assert.ok(r.score <= 20);
});

test("clone-style CXZT reply forces counterfeit even with valid IMEI", () => {
  const r = verify({
    ...base,
    imei: "490154203237518",
    rconfSms: "none",
    cxztSms: "reply",
    cxztText: "J14_M216_GT06_418_V4.18*ID:864943043842042*185.119.17.42:5023*0.0.0.0*A:x*BAT:3.98V",
    platform: "clone-app",
  });
  assert.equal(r.verdict, "likely-counterfeit");
  assert.equal(r.parsed.cloneStyleStatus, true);
});

test("fully positive evidence yields likely genuine", () => {
  const checklist = { labelClean: "yes", labelMatches: "yes", manual: "yes", priceTooLow: "no", authorizedSeller: "yes", sealedGasket: "yes", ledsMatch: "yes" } as const;
  const r = verify({
    ...base,
    imei: "490154203237518",
    deviceId: "9171234567",
    rconfSms: "reply",
    rconfText: "Tracker identification number in format ID: 490154203237518 ... config follows",
    cxztSms: "reply",
    cxztText: "ST901 status ok",
    platform: "sinotrackpro",
    checklist: { ...checklist },
  });
  assert.equal(r.verdict, "likely-genuine");
  assert.ok(r.score >= 80);
});

test("no input stays inconclusive", () => {
  const r = verify(base);
  assert.equal(r.verdict, "inconclusive");
  assert.equal(r.score, 50);
});

test("test TAC and repeating IMEI are flagged", () => {
  assert.equal(verify({ ...base, imei: "004999010640000" }).verdict, "likely-counterfeit");
  assert.equal(verify({ ...base, imei: "111111111111111" }).verdict, "likely-counterfeit");
});
