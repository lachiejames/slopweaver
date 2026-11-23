/**
 * The one runner behind every route that reads an allowlisted verb's document: spawn it, parse its stdout by the
 * format the allowlist declares, and stamp when it was true.
 *
 * Lifted out of `app/api/live/[verb]/route.ts` when the chair's report (`app/api/queue-refusals/route.ts`) came to
 * read the same registers the Queue page reads. A second copy would have been a second parse and a second stamp
 * rule, and the report's whole claim is that it saw what the page saw.
 */

import type { LiveExpectedEmpty, LiveFormat, LiveVerb } from "./liveVerbs";
import { type SpawnOutcome, spawnVerb } from "./spawnVerb";

/** What a tile receives. One shape for both outcomes, so a reader never has to guess which it got. */
export type LiveResult =
  | {
      readonly ok: true;
      readonly observedAtIso: string;
      readonly stampedByRoute: boolean;
      /** Set when the payload is a frozen reading rather than the machine — the tile prints it in the stamp's place. */
      readonly fixture?: string;
      readonly payload: unknown;
    }
  | { readonly ok: false; readonly observedAtIso: string; readonly notMeasured: string };

/**
 * Parse what a verb printed, according to the shape the allowlist says it prints.
 *
 * The JSONL branch exists because several registers emit one object per line on purpose (the repo's
 * `whole-file-json` rule), and it maps EMPTY stdout to an empty array rather than throwing. That case is
 * not an edge: `hand list --json` with nothing waiting on the owner prints nothing at all, and it is the state
 * the page is in most of the time. `JSON.parse("")` throws, so without this the console would report
 * `NOT MEASURED` precisely when the answer was a clean zero — a reading that is loudest exactly when
 * there is nothing wrong is worse than no reading.
 *
 * @param out everything the child wrote to stdout
 * @param format the shape the allowlist declared for this verb
 * @returns the payload — a document for `json`, an array of them for `jsonl`. Throws on unparseable
 *   output, which the one caller turns into a stated `notMeasured` naming the format it expected.
 */
function parsePayload({ out, format }: { out: string; format: LiveFormat }): unknown {
  if (format === "json") {
    return JSON.parse(out);
  }
  const lines = out.split("\n").filter((line) => line.trim() !== "");
  return lines.map((line): unknown => JSON.parse(line));
}

/**
 * Run one allowlisted verb and hand back what it printed, parsed and stamped.
 *
 * The child itself is `spawnVerb` — one spawn, one timeout kill, one ENOENT sentence, shared with the sync
 * route. What is this runner's own is {@link liveResultOf}: the parse, the declared expected-empty exit, and the stamp.
 *
 * @param verb the resolved allowlist row
 * @returns the parsed payload, or a stated reason it could not be measured — never a throw
 */
export async function runLiveVerb({ verb }: { verb: LiveVerb }): Promise<LiveResult> {
  const outcome = await spawnVerb({ argv: verb.argv, timeoutMs: verb.timeoutMs, title: verb.title });
  return liveResultOf({ outcome, receivedAtIso: new Date().toISOString(), verb });
}

/**
 * What one child run comes to as a tile's reading. Pure: the spawn and the clock are the caller's.
 *
 * A non-zero exit is a not-measured reading, bar the one exit the row declares as its expected-empty answer, which
 * becomes a {@link LiveExpectedEmpty} payload carrying the verb's own sentence. Any other exit, a timeout (no exit
 * code at all) or a launch failure stays a failure, so the declaration can never turn a fault into an answer.
 *
 * @param outcome how the child ended
 * @param receivedAtIso the route's receipt instant, the stamp for every reading the verb did not stamp itself
 * @param verb the allowlist row it ran
 * @returns the reading
 */
export function liveResultOf({
  outcome,
  receivedAtIso,
  verb,
}: {
  outcome: SpawnOutcome;
  receivedAtIso: string;
  verb: LiveVerb;
}): LiveResult {
  if (!outcome.ok) {
    if (verb.expectedEmpty !== undefined && outcome.exitCode === verb.expectedEmpty.exitCode) {
      const payload: LiveExpectedEmpty = {
        code: verb.expectedEmpty.code,
        kind: "expected-empty",
        why: outcome.notMeasured,
      };
      return { observedAtIso: receivedAtIso, ok: true, payload, stampedByRoute: true };
    }
    return { notMeasured: outcome.notMeasured, observedAtIso: receivedAtIso, ok: false };
  }
  try {
    const payload: unknown = parsePayload({ format: verb.format, out: outcome.out });
    return {
      observedAtIso: observedAt({ payload, receivedAtIso, verb }),
      ok: true,
      payload,
      stampedByRoute: !verb.stampsItsOwnTime,
    };
  } catch {
    // What it DID print is the fact a reader needs — an empty stdout and a human report are different
    // failures, and "not json" alone names neither. MEASURED: `session watch --json-report`
    // read from this route printed NOTHING on exit 0, because it is a cursor drain and the supervisor's
    // own drain had just consumed the events; the old sentence hid that behind "not json".
    const head = outcome.out.trim().slice(0, 120);
    let printed = "nothing at all";
    if (head !== "") {
      printed = `something beginning \`${head}\``;
    }
    return {
      notMeasured: `${verb.title} printed ${printed}, not ${verb.format}, after ${String(outcome.tookMs)}ms`,
      observedAtIso: receivedAtIso,
      ok: false,
    };
  }
}

/**
 * When the payload was true of the machine.
 *
 * A verb that stamps its own `observedAtIso` is believed; one that does not gets the route's receipt time,
 * and `stampedByRoute` on the result is what tells the tile to label it as such. Conflating the two would
 * let a cached answer present itself as a fresh reading.
 *
 * @param payload whatever the verb printed
 * @param receivedAtIso the route's receipt instant
 * @returns the verb's own instant when it published one, else the receipt
 */
function observedAt({
  payload,
  receivedAtIso,
  verb,
}: {
  payload: unknown;
  receivedAtIso: string;
  verb: LiveVerb;
}): string {
  if (verb.stampsItsOwnTime && typeof payload === "object" && payload !== null && "observedAtIso" in payload) {
    const declared: unknown = payload.observedAtIso;
    if (typeof declared === "string") {
      return declared;
    }
  }
  return receivedAtIso;
}
