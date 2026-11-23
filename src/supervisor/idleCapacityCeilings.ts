/**
 * The capacity half of `./idleCapacityGate.ts`: what a tick's capture decides before a single row is read.
 *
 * A capture carrying `ceilings` (`../capacity/ceilings.ts`) is judged by `admissionOf` over the ceilings rebuilt
 * from the capture; one without runs the machine-hold and plan-gauge predicate every capture before ceilings existed
 * was judged by. Either way the answer is a verdict the gate returns as-is, or the ceiling a row's reason must
 * name. Pure, like the gate.
 */

import { admissionOf, rejudgedReading } from "../capacity/admission.js";
import type { CeilingsReading } from "../capacity/ceilings.js";
import { ceilingsReadingSchema } from "../capacity/ceilingsSchema.js";
import { isRecord } from "../lib/parsers.js";

/** The capacity capture's ceilings: absent on an older capture, or a reading, or the reason it does not parse. */
type CeilingsDecode =
  | { readonly kind: "absent" }
  | { readonly kind: "read"; readonly reading: CeilingsReading }
  | { readonly kind: "unreadable"; readonly why: string };

/** A verdict the capture alone settles — never a refusal, which needs the rows. */
type CaptureVerdict = { readonly kind: "clean" } | { readonly kind: "unreadable"; readonly why: string };

/** Decode the capacity observation's `ceilings`, which only a newer capture carries. */
function ceilingsOf({ sources }: { sources: unknown }): CeilingsDecode {
  if (!isRecord(sources) || !isRecord(sources["capacity"]) || !isRecord(sources["capacity"]["facts"])) {
    return { kind: "absent" };
  }
  const facts = sources["capacity"]["facts"];
  // Key PRESENCE, not value: a present `ceilings: undefined` is malformed, never an older capture.
  if (!("ceilings" in facts)) {
    return { kind: "absent" };
  }
  const parsed = ceilingsReadingSchema.safeParse(facts["ceilings"]);
  if (!parsed.success) {
    return {
      kind: "unreadable",
      why: `the draft's capacity observation carries ceilings that do not parse — ${parsed.error.message}`,
    };
  }
  // Rejudged, so the refusal's binding, its printed lines and `lowest` all come from the captured ceilings.
  return { kind: "read", reading: rejudgedReading({ reading: parsed.data }) };
}

/** Whether the reading's machine ceiling is held. */
function machineHeldIn({ reading }: { reading: CeilingsReading }): boolean {
  return reading.ceilings.some((ceiling) => ceiling.kind === "machine" && ceiling.status === "held");
}

/** Whether the tick's plan gauge was read and says no plan can take an all-models spawn — Ceiling A, measured. */
function planCeilingHit({ sources }: { sources: unknown }): boolean {
  if (!isRecord(sources) || !isRecord(sources["gauge"])) {
    return false;
  }
  const gauge = sources["gauge"];
  if (gauge["status"] !== "read" && gauge["status"] !== "partial") {
    return false;
  }
  const facts = gauge["facts"];
  return isRecord(facts) && facts["nextAllModels"] === null;
}

/**
 * Whether a tick with ceilings could start a seat, and on which ceiling a reason must be anchored.
 *
 * @returns `clean` when nothing could start, `unreadable` when the machine had no number, else the binding id
 */
function ceilingAdmission({
  reading,
}: {
  reading: CeilingsReading;
}): CaptureVerdict | { readonly kind: "free"; readonly binding: string } {
  const admission = admissionOf({ reading });
  if (admission.kind === "held" || admission.kind === "capped") {
    return { kind: "clean" };
  }
  if (admission.kind === "unreadable") {
    return { kind: "unreadable", why: "the draft's ceilings carry no machine reading" };
  }
  return { binding: admission.binding, kind: "free" };
}

/**
 * Everything the tick's capture decides before its rows are read: a broken or contradictory ceilings, a hold, a
 * spent plan — else the ceiling a reason must name, `null` for a capture from before ceilings existed.
 *
 * @param sources the draft's source observations, of which the capacity (and its ceilings) and gauge are read
 * @param held whether the capture's legacy machine hold was set
 * @returns `decided` with the verdict, or `open` with the binding and the ceilings it came from
 */
export function admittedCeilingOf({ sources, held }: { sources: unknown; held: boolean }):
  | { readonly kind: "decided"; readonly verdict: CaptureVerdict }
  | {
      readonly kind: "open";
      readonly bindingCeilingId: string | null;
      readonly ceilings: CeilingsReading | null;
    } {
  // Decoded BEFORE the hold short-circuit: a malformed ceilings is a broken producer, and a held tick must not
  // hide it.
  const ceilings = ceilingsOf({ sources });
  if (ceilings.kind === "unreadable") {
    return { kind: "decided", verdict: ceilings };
  }
  if (ceilings.kind === "absent") {
    const capped = held || planCeilingHit({ sources });
    if (capped) {
      return { kind: "decided", verdict: { kind: "clean" } };
    }
    return { bindingCeilingId: null, ceilings: null, kind: "open" };
  }
  // One producer writes both holds from one machine report, so a capture where they disagree is malformed —
  // never judged by picking one (a contradictory capture's legacy hold would clear a tick its
  // ceilings admitted).
  if (machineHeldIn({ reading: ceilings.reading }) !== held) {
    return {
      kind: "decided",
      verdict: {
        kind: "unreadable",
        why: "the draft's capacity observation says the machine is held where its ceilings say it is not, or the reverse",
      },
    };
  }
  if (held) {
    return { kind: "decided", verdict: { kind: "clean" } };
  }
  const admission = ceilingAdmission({ reading: ceilings.reading });
  if (admission.kind !== "free") {
    return { kind: "decided", verdict: admission };
  }
  return { bindingCeilingId: admission.binding, ceilings: ceilings.reading, kind: "open" };
}
