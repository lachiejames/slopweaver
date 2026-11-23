/**
 * Decoding a `ruling` line, split out of `./ledger.ts`.
 *
 * A real seam rather than a size dodge: `./ledger.ts` answers what a journal line IS, and everything here
 * answers the one question a ruling line asks that no other kind does — which of its optional halves are
 * DECLARED, and whether each one is usable. The write side of the same contract is `./rowEventSchema.ts`;
 * the meaning of a gate's values is `./rulingGateTypes.ts`; what a standing gate then refuses is
 * `./rulingGate.ts`.
 *
 * **The one property every function here holds: a field that is PRESENT and unusable makes the line
 * unreadable, and is never collapsed into absent.** Absence is a CLAIM on a ruling — an absent
 * `backfilledFrom` says the owner ruled on this themselves, an absent `gate` says this ruling gates nothing — so it
 * may only ever come from a line that never made the claim at all. {@link rulingEvent}'s own header carries
 * the measured counterexample that made this a rule, and widening a refusal nobody wrote is the one
 * direction the gate half must not be wrong in.
 *
 * Pure: no filesystem, no clock.
 */
import { isRecord } from "../lib/parsers.js";
import { ATTACH_UPLOAD_VERDICTS, type AttachUploadRuling } from "./attachUploadRulingTypes.js";
import type { ExplicitSteer } from "./explicitSteerTypes.js";
import type { RunEvent } from "./ledger.js";
import { optionalText, stringList } from "./ledgerFields.js";
import type { GatedVerb, RulingGate } from "./rulingGateTypes.js";
import type { StandingSession } from "./standingSessionTypes.js";

/**
 * Decode a recorded owner ruling; the owner's words and where they said them are both load-bearing, so a line missing
 * either decodes to nothing.
 *
 * The optional halves are read with `optionalText` and OMITTED rather than set to `undefined`, because
 * `../handover/rowEvent.ts`'s read-back compares the SERIALISED forms: a manufactured `decidedIso:
 * undefined` disappears through `JSON.stringify` on the way out and would not come back, failing a write
 * that was in fact correct. Same reason `claimedEvent` only ever adds its own literal `forced: true`.
 *
 * **An optional field that is PRESENT and unusable makes the line unreadable, and that is a permission
 * boundary rather than tidiness.** Found by an adversarial review pass with a concrete counterexample: a
 * hand-edited line carrying `"backfilledFrom": ""` decoded to a ruling with the field simply ABSENT, and an
 * absent `backfilledFrom` is exactly what `./ruling.ts` reads as "the owner ruled on this themselves" — so one blank
 * string turned a reconstruction into a team-facing permission on an unruled finding. Absence is a claim
 * here, so it may only ever come from a line that never made the claim at all. The write schema already
 * refuses every one of these shapes; this is the reader refusing to invent them.
 *
 * @param atIso when the line itself was written, already decoded by the caller
 * @param payload the line's own fields, undecoded
 * @returns the decoded ruling, or `undefined` when the line cannot be read as one at all
 */
export function rulingEvent({
  atIso,
  payload,
}: {
  atIso: string;
  payload: Readonly<Record<string, unknown>>;
}): RunEvent | undefined {
  const ruling = optionalText({ key: "ruling", payload });
  const anchor = optionalText({ key: "anchor", payload });
  if (ruling === undefined || anchor === undefined) {
    return undefined;
  }
  const decidedIso = declaredInstant({ key: "decidedIso", payload });
  const backfilledFrom = declaredInstant({ key: "backfilledFrom", payload });
  const gate = declaredGate({ payload });
  const gateReleases = declaredGateReleases({ payload });
  const explicitSteer = declaredExplicitSteer({ payload });
  const standingSession = declaredStandingSession({ payload });
  const attachUpload = declaredAttachUpload({ payload });
  if (
    decidedIso === "unusable" ||
    backfilledFrom === "unusable" ||
    gate === "unusable" ||
    gateReleases === "unusable" ||
    explicitSteer === "unusable" ||
    standingSession === "unusable" ||
    attachUpload === "unusable"
  ) {
    return undefined;
  }
  const declaredHalves = { attachUpload, explicitSteer, gate, gateReleases, standingSession };
  if (reconstructionOverclaims({ backfilledFrom, decidedIso, ...declaredHalves })) {
    return undefined;
  }
  return {
    anchor,
    atIso,
    ...(attachUpload === undefined ? {} : { attachUpload }),
    ...(backfilledFrom === undefined ? {} : { backfilledFrom }),
    ...(decidedIso === undefined ? {} : { decidedIso }),
    ...(explicitSteer === undefined ? {} : { explicitSteer }),
    ...(gate === undefined ? {} : { gate }),
    ...(gateReleases === undefined ? {} : { gateReleases }),
    kind: "ruling",
    ruling,
    ...(standingSession === undefined ? {} : { standingSession }),
  };
}

/**
 * Whether a reconstruction claims more than a reconstruction can carry, so the line is refused rather than
 * decoded.
 *
 * A reconstruction is decided when its source was answered — the same rule the write schema enforces; a line
 * claiming otherwise would let an old decision outrank a newer one. A reconstruction has no gate to
 * reconstruct, which is what keeps a backfill from manufacturing a refusal. And the same two-sided rule for an
 * override, a standing seat and attach upload: a reconstruction is neither an explicit steer nor a standing
 * session, and it neither opens nor closes `github attach upload`.
 */
function reconstructionOverclaims({
  attachUpload,
  backfilledFrom,
  decidedIso,
  explicitSteer,
  gate,
  gateReleases,
  standingSession,
}: {
  attachUpload: AttachUploadRuling | undefined;
  backfilledFrom: string | undefined;
  decidedIso: string | undefined;
  explicitSteer: ExplicitSteer | undefined;
  gate: RulingGate | undefined;
  gateReleases: readonly string[] | undefined;
  standingSession: StandingSession | undefined;
}): boolean {
  if (backfilledFrom === undefined) {
    return false;
  }
  return (
    backfilledFrom !== decidedIso ||
    gate !== undefined ||
    gateReleases !== undefined ||
    explicitSteer !== undefined ||
    standingSession !== undefined ||
    attachUpload !== undefined
  );
}

/**
 * A ruling's attach-upload half: the verdict, `undefined` when the key is genuinely absent, and `"unusable"` when it is
 * present and not one. A present value that is not an object, carries an unknown key, or names a verdict outside the
 * two is never read as absent: absence leaves attach upload as the latest OTHER ruling set it, and a hand-edited line must
 * not be able to make an earlier permit the latest word.
 */
function declaredAttachUpload({
  payload,
}: {
  payload: Readonly<Record<string, unknown>>;
}): AttachUploadRuling | undefined | "unusable" {
  if (!Object.hasOwn(payload, "attachUpload")) {
    return undefined;
  }
  const raw = payload["attachUpload"];
  if (!isRecord(raw) || Object.keys(raw).some((key) => key !== "verdict")) {
    return "unusable";
  }
  const verdict = ATTACH_UPLOAD_VERDICTS.find((one) => one === raw["verdict"]);
  return verdict === undefined ? "unusable" : { verdict };
}

/**
 * An optional instant field: the instant, `undefined` when the key is genuinely absent, and the literal
 * `"unusable"` when it is present but not an instant anything can order by.
 *
 * Three outcomes rather than two because "absent" and "present and broken" mean different things on a
 * ruling, and collapsing them is the defect {@link rulingEvent}'s header describes.
 */
function declaredInstant({
  key,
  payload,
}: {
  key: string;
  payload: Readonly<Record<string, unknown>>;
}): string | undefined | "unusable" {
  if (!Object.hasOwn(payload, key)) {
    return undefined;
  }
  const value = optionalText({ key, payload });
  if (value === undefined || Number.isNaN(Date.parse(value))) {
    return "unusable";
  }
  return value;
}
/**
 * A ruling's optional gate: the gate, `undefined` when the key is genuinely absent, and `"unusable"` when
 * it is present and not a gate.
 *
 * Present-and-broken is never collapsed into absent, for the reason `./ledger.ts`'s `rulingEvent`'s header gives at
 * length: absence is a CLAIM here — it says this ruling gates nothing — so it may only ever come from a line
 * that never made the other claim. A half-decoded gate would be a refusal with a verb list nobody wrote.
 */
function declaredGate({
  payload,
}: {
  payload: Readonly<Record<string, unknown>>;
}): RulingGate | undefined | "unusable" {
  if (!Object.hasOwn(payload, "gate")) {
    return undefined;
  }
  const raw = payload["gate"];
  if (!isRecord(raw)) {
    return "unusable";
  }
  const verbs = declaredGatedVerbs({ raw: raw["verbs"] });
  if (verbs === undefined || verbs.length === 0) {
    return "unusable";
  }
  // An EMPTY `subjects` is the legitimate whole-verb gate, so it decodes. A present `subjects` that is not a
  // list at all does not: `stringList` would read it as empty, which is a WIDER gate than the line declared,
  // and widening a refusal nobody wrote is the one direction this decoder must not be wrong in.
  if (Object.hasOwn(raw, "subjects") && !Array.isArray(raw["subjects"])) {
    return "unusable";
  }
  const subjects = stringList({ key: "subjects", payload: raw });
  if (!Object.hasOwn(raw, "untilIso")) {
    return { subjects, verbs };
  }
  const untilIso = optionalText({ key: "untilIso", payload: raw });
  if (untilIso === undefined || Number.isNaN(Date.parse(untilIso))) {
    return "unusable";
  }
  return { subjects, untilIso, verbs };
}

/** The `<noun> <verb>` pairs a gate names, or `undefined` when the value is not a list of them. */
function declaredGatedVerbs({ raw }: { raw: unknown }): readonly GatedVerb[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const pairs: GatedVerb[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      return undefined;
    }
    const noun = optionalText({ key: "noun", payload: entry });
    const verb = optionalText({ key: "verb", payload: entry });
    if (noun === undefined || verb === undefined) {
      return undefined;
    }
    pairs.push({ noun, verb });
  }
  return pairs;
}

/**
 * A ruling's explicit-steer half: the steer, `undefined` when the key is genuinely absent, and `"unusable"` when it
 * is present and not one. Absence is a claim here too — it says the owner's words override nothing — so a present value
 * that is not an object, carries an unknown key, or names an instant nothing can order is never read as absent.
 */
function declaredExplicitSteer({
  payload,
}: {
  payload: Readonly<Record<string, unknown>>;
}): ExplicitSteer | undefined | "unusable" {
  if (!Object.hasOwn(payload, "explicitSteer")) {
    return undefined;
  }
  const raw = payload["explicitSteer"];
  if (!isRecord(raw) || Object.keys(raw).some((key) => key !== "deliverByIso")) {
    return "unusable";
  }
  const deliverByIso = declaredInstant({ key: "deliverByIso", payload: raw });
  if (deliverByIso === "unusable") {
    return "unusable";
  }
  return deliverByIso === undefined ? {} : { deliverByIso };
}

/**
 * A ruling's standing-session half: the standing session, `undefined` when the key is genuinely absent, and
 * `"unusable"` when it is present and not one. Absence is the claim that LETS a seat be parked, so a present value
 * that is not an object, carries an unknown key, or names an instant nothing can order is never read as absent.
 */
function declaredStandingSession({
  payload,
}: {
  payload: Readonly<Record<string, unknown>>;
}): StandingSession | undefined | "unusable" {
  if (!Object.hasOwn(payload, "standingSession")) {
    return undefined;
  }
  const raw = payload["standingSession"];
  if (!isRecord(raw) || Object.keys(raw).some((key) => key !== "untilIso")) {
    return "unusable";
  }
  const untilIso = declaredInstant({ key: "untilIso", payload: raw });
  if (untilIso === "unusable") {
    return "unusable";
  }
  return untilIso === undefined ? {} : { untilIso };
}

/**
 * The gate ids a ruling lifts: the list, absent, or `"unusable"` when the key is there and empty or wrong. A list
 * holding anything but non-blank strings is wrong WHOLE: dropping the stray member would decode a release set
 * nobody wrote.
 */
function declaredGateReleases({
  payload,
}: {
  payload: Readonly<Record<string, unknown>>;
}): readonly string[] | undefined | "unusable" {
  if (!Object.hasOwn(payload, "gateReleases")) {
    return undefined;
  }
  const raw = payload["gateReleases"];
  if (!Array.isArray(raw) || raw.length === 0) {
    return "unusable";
  }
  // The write schema's own `words`: a trimmed, non-empty id. A blank one names no gate.
  const releases = stringList({ key: "gateReleases", payload }).filter((id) => id.trim() !== "");
  return releases.length === raw.length ? releases : "unusable";
}
