/**
 * The lap seat: while hosted Actions is off, a chair runs a ROTA in which one designated handover run laps pull
 * requests in the chair's order and every other seat sends its number to the chair. `github lap-seat set <slug>`
 * writes that designation to `<home>/laps/seat.json`; `github lap` reads it before anything else and refuses a
 * runner whose held run is not the seat.
 *
 * Why it is a file and not a message: a wake reseated a seat whose pull request sat far
 * down the landing order. Its rebuilt brief never carried the chair's "never run `github lap` yourself", canon told
 * it to land its own pull request, and it took the machine's one lap lock for a whole lap ahead of the ready
 * priority batch. A rule that travels by message is lost on every reseat; one the verb reads is not.
 *
 * Pure: the decoder and the verdict. Reading the file and the journals is `./lapSeatStore.ts`'s.
 */

import { z } from "zod";
import { isSafeSlug } from "../../../handover/runStore.js";
import { err, ok, type Result } from "../../../lib/result.js";

/** The designation `github lap-seat set` writes. */
export interface LapSeat {
  /** The handover run whose session holds the lap seat. */
  readonly slug: string;
  readonly setIso: string;
  /** The session that set it, when one could be named: attribution, never authority. */
  readonly setBy?: string;
}

/** What {@link lapSeatVerdict} judges: the designation, whether its run has closed, and the run the caller holds. */
export interface LapSeatFacts {
  readonly seat: LapSeat | undefined;
  /** True only for a READABLE journal whose current cycle is closed; a missing or damaged one never reaches here. */
  readonly seatRunClosed: boolean;
  /** The run the invoking session writes, `undefined` when none can be established. */
  readonly callerRun: string | undefined;
}

/** Whether `github lap` may run, and when not, why. */
export type LapSeatVerdict =
  | { readonly kind: "proceed" }
  | {
      readonly kind: "refuse";
      readonly reason: "caller-undetermined" | "off-seat" | "seat-closed";
      readonly seatSlug: string;
    };

/** The strict shape of `seat.json`: a hand-edited authority file is refused, never normalised. */
const LapSeatSchema = z
  .object({
    setBy: z.string().min(1).optional(),
    setIso: z.iso.datetime({ offset: true }),
    slug: z.string().refine((slug) => isSafeSlug({ slug }), { message: "not a usable run slug" }),
  })
  .strict();

/** One schema issue as a line: its field path, or `(root)` for the whole document, and the message. */
function issueLine({ path, message }: { path: readonly PropertyKey[]; message: string }): string {
  if (path.length === 0) {
    return `(root): ${message}`;
  }
  return `${path.map(String).join(".")}: ${message}`;
}

/**
 * Decode a parsed `seat.json`.
 *
 * @param value the parsed JSON
 * @returns the designation, or every problem the schema found
 */
export function decodeLapSeat({ value }: { value: unknown }): Result<LapSeat> {
  const parsed = LapSeatSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => issueLine({ message: issue.message, path: issue.path })));
  }
  const { slug, setIso, setBy } = parsed.data;
  if (setBy === undefined) {
    return ok({ setIso, slug });
  }
  return ok({ setBy, setIso, slug });
}

/**
 * Judge whether this invocation of `github lap` may run under the standing designation. Only the seat's own open
 * run proceeds. A CLOSED seat run refuses everyone rather than lapsing the rota: a seat settling its run is routine,
 * and lapsing on it would hand the lap lock back to every seat, which is the defect this gate exists to close. Only
 * the chair ends a rota, by `github lap-seat clear` or a new `set`.
 *
 * @param facts the designation, its run's closure and the caller's held run
 * @returns `proceed`, or `refuse` naming the seat and why
 */
export function lapSeatVerdict({ facts }: { facts: LapSeatFacts }): LapSeatVerdict {
  const { seat, seatRunClosed, callerRun } = facts;
  if (seat === undefined) {
    return { kind: "proceed" };
  }
  if (seatRunClosed) {
    return { kind: "refuse", reason: "seat-closed", seatSlug: seat.slug };
  }
  if (callerRun === seat.slug) {
    return { kind: "proceed" };
  }
  return { kind: "refuse", reason: callerRun === undefined ? "caller-undetermined" : "off-seat", seatSlug: seat.slug };
}

/**
 * The refusal's detail: who holds the seat, what this caller is, and what to do instead.
 *
 * @param verdict the refusal
 * @param callerRun the run the caller holds, when one was established
 * @returns one sentence for the hatch renderer's `detail`
 */
export function lapSeatRefusalDetail({
  verdict,
  callerRun,
}: {
  verdict: Extract<LapSeatVerdict, { kind: "refuse" }>;
  callerRun: string | undefined;
}): string {
  if (verdict.reason === "seat-closed") {
    return (
      `the lap seat ${verdict.seatSlug} names a closed run, so no session holds the seat. ` +
      "The chair designates an open run (`github lap-seat set <slug>`) or ends the rota (`github lap-seat clear`)"
    );
  }
  let who = "this session holds no run its branch, its directory or a sole open journal names";
  if (callerRun !== undefined) {
    who = `this session holds the run ${callerRun}`;
  }
  return (
    `the lap seat is ${verdict.seatSlug} and ${who}. ` +
    "Send your pull request number(s) and head SHA(s) to the chair instead; " +
    "the lap seat laps them in order. A reseated lap seat claims its run first (`handover claim`)"
  );
}
