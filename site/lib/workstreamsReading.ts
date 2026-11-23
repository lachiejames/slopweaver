/**
 * The workstreams register as every console reader takes it: a document, or the typed answer that the store holds
 * no workstream yet.
 *
 * A warning triangle on the Queue makes everything look and feel broken, and two of the five drawn at once were this
 * register, so none may draw over it when it is merely unwritten. On an install whose store holds no workstream and
 * no register document, `slopweaver workstreams list --json` exits 3, `NO_WORKSTREAMS` — `EXIT_EXPECTED_EMPTY`,
 * an answer (`src/cli/commands/workstreams/list.ts`) — so the sidebar count and the Queue's priorities draw no
 * staleness mark over a register that was never broken, only never written. A store refusal exits 1 and stays one.
 *
 * The allowlist row declares that exit (`./liveVerbs.ts`), so the runner hands it over as a typed expected-empty
 * payload (`./liveVerbRun.ts`); this reads it as {@link WorkstreamsAbsent}. Absent is not empty-by-default: it is
 * its own arm, so no reader invents a grouping, a lane or a priority list the register never declared. Any other
 * exit, a timeout or a document that will not read stays a failure, marked as one.
 */
import { isBag } from "./bag";
import { readWorkstreamTiles, type WorkstreamsView } from "./workstreamTiles";

/** The code the allowlist row declares for `workstreams list`'s exit 3: the store holds no workstream yet. */
export const NO_WORKSTREAMS = "NO_WORKSTREAMS";

/** The keys of the runner's `LiveExpectedEmpty` envelope (`./liveVerbs.ts`), and no others. */
const ENVELOPE_KEYS: ReadonlySet<string> = new Set(["code", "kind", "why"]);

/** The store holds no workstream and no register document yet: none to count, lift or draw. */
export interface WorkstreamsAbsent {
  readonly kind: "absent";
  /** The verb's own sentence, naming the verb that writes one. */
  readonly why: string;
}

/** The register as it read: its document, or the answer that there is none yet. */
export type WorkstreamsReading = WorkstreamsView | WorkstreamsAbsent;

/**
 * Whether a reading is the no-register answer.
 *
 * @param reading the register as it read
 * @returns true for the absent arm
 */
export function isWorkstreamsAbsent(reading: WorkstreamsReading): reading is WorkstreamsAbsent {
  // Keyed on the field every consumer reads, never on `kind`: a view is structural, so one decorated with ANY `kind`,
  // `"absent"` included, still carries its `workstreams` and is still a view.
  return !Array.isArray(Reflect.get(reading, "workstreams"));
}

/**
 * Read the `workstreams` live payload: the runner's expected-empty answer for `NO_WORKSTREAMS` as the absent arm,
 * anything else through the strict document reader.
 *
 * @param payload the live reading's payload, untrusted
 * @returns the reading, or `undefined` when it reads as neither — another refusal code included
 */
export function readWorkstreamsReading({ payload }: { payload: unknown }): WorkstreamsReading | undefined {
  if (isBag(payload) && payload["kind"] === "expected-empty") {
    const why = payload["why"];
    // Exactly the runner's three keys (`liveVerbRun.ts` `liveResultOf`): the envelope travels in-band, so a document
    // carrying anything beyond them is the verb's own stdout, unreadable, never the absent answer.
    const onlyEnvelopeKeys = Object.keys(payload).every((key) => ENVELOPE_KEYS.has(key));
    if (payload["code"] !== NO_WORKSTREAMS || typeof why !== "string" || !onlyEnvelopeKeys) {
      return undefined;
    }
    return { kind: "absent", why };
  }
  return readWorkstreamTiles({ payload });
}

/**
 * The workstreams a reading holds: none when the store holds none.
 *
 * @param reading the register as it read
 * @returns its workstreams, in the verb's order
 */
export function workstreamsOf({ reading }: { reading: WorkstreamsReading }): WorkstreamsView["workstreams"] {
  if (isWorkstreamsAbsent(reading)) {
    return [];
  }
  return reading.workstreams;
}
