/**
 * The board sweep's verdict CENSUS as a persisted document — `sweep-board-census.json`, published beside
 * `sweep-board.jsonl` by the same `sweep board --write` pass.
 *
 * ## Why a second document at all
 *
 * The JSONL holds only the candidates the default view SHOWS — the findings — and never the census the verb
 * prints above them. The design the Fleet Briefing's "Nothing stale" section answers to says the unproven rows
 * are "reported as a count, never as hundreds of cards" (MEASURED: 657 of 814 live rows
 * UNWITNESSED — `./classify.ts`), and a count that exists only on a terminal is one no later reader can report.
 * So the census is written whole, from the same pass, under the same partial-read refusal: a partial read
 * publishes neither document.
 *
 * ## Two files, one pass — and the digest that proves it
 *
 * Each file is replaced atomically, but not the PAIR. So the census carries {@link findingsDigest} of the
 * exact finding lines its own pass wrote, a reader recomputes it over the findings it read and refuses a
 * pairing that does not match, and the census is written FIRST. That order is what makes a content digest
 * enough: the census on disk is always the newest pass's, so a torn write leaves it beside
 * either findings that match its digest — byte-for-byte the lines it counted, the same content whichever pass
 * wrote them — or findings that do not, which the reader refuses. Findings-first would let an OLDER census
 * pair with a newer pass whose findings happened not to change while its unproven count did.
 *
 * Pure: no clock and no filesystem. The writer is `../live/hygiene/reportStore.ts`; the reader validates the
 * stored bytes with {@link parseSweepBoardCensus}.
 */
import { createHash } from "node:crypto";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import { type SweepCandidate, verdictCensus } from "./classify.js";

/** The census document's own schema version. A reader refuses any other. */
const SWEEP_BOARD_CENSUS_SCHEMA_VERSION = 5;

/** A count, as the census carries one per verdict. */
const count = z.number().int().nonnegative();

/** The stored census, strict so a reader refuses a document this build did not write. */
const sweepBoardCensusSchema = z.strictObject({
  schemaVersion: z.literal(SWEEP_BOARD_CENSUS_SCHEMA_VERSION),
  producer: z.literal("sweep board"),
  /** How many handover docs the scan read. */
  scanned: count,
  /** How many rows were classified — every live row, plus each terminal row the sweep found UNCARDED. */
  swept: count,
  /** {@link findingsDigest} of the finding lines the same pass wrote to `sweep-board.jsonl`. */
  findingsSha256: z.string().regex(/^[0-9a-f]{64}$/),
  census: z.strictObject({
    CONTRADICTED: count,
    SHIPPED: count,
    /** Live asks whose question names only pull requests that have ended (`./endedPullRequest.ts`). */
    PR_ENDED: count,
    /** Terminal asks whose page never reached the owner's Queue (`./uncarded.ts`) — counted, unlike every other terminal row. */
    UNCARDED: count,
    ORPHANED: count,
    SUPERSEDED: count,
    OVERTAKEN: count,
    UNWITNESSED: count,
    KEEP: count,
  }),
});

/** The persisted verdict census of one `sweep board --write` pass. */
export type SweepBoardCensus = z.infer<typeof sweepBoardCensusSchema>;

/**
 * The sha256 of a findings document's non-blank lines, joined by newlines — the same on the lines a pass writes
 * and on the lines a reader reads back, since the reader drops only the terminal newline's empty tail.
 *
 * @param lines the finding lines, without their newlines
 * @returns the lowercase hex digest
 */
export function findingsDigest({ lines }: { readonly lines: readonly string[] }): string {
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/**
 * Build the census document from the pass's classified rows.
 *
 * @param candidates every classified live row — the whole census, not the filtered selection
 * @param findingLines the exact lines the same pass writes to `sweep-board.jsonl`
 * @param scanned how many handover docs the scan read
 * @returns the document
 */
export function sweepBoardCensus({
  candidates,
  findingLines,
  scanned,
}: {
  readonly candidates: readonly SweepCandidate[];
  readonly findingLines: readonly string[];
  readonly scanned: number;
}): SweepBoardCensus {
  return {
    census: { ...verdictCensus({ candidates }) },
    findingsSha256: findingsDigest({ lines: findingLines }),
    producer: "sweep board",
    scanned,
    schemaVersion: SWEEP_BOARD_CENSUS_SCHEMA_VERSION,
    swept: candidates.length,
  };
}

/**
 * The census as the one line `--write` publishes, without its trailing newline.
 *
 * @param census the document to serialise
 * @returns the JSON text
 */
export function renderSweepBoardCensusJson({ census }: { readonly census: SweepBoardCensus }): string {
  return safeJsonStringify({ label: "the sweep board census", value: census });
}

/**
 * Validate stored bytes, already parsed, against the strict census schema.
 *
 * @param value anything claiming to be a census document
 * @returns the typed census, or one line per schema issue
 */
export function parseSweepBoardCensus({ value }: { readonly value: unknown }): Result<SweepBoardCensus> {
  const parsed = sweepBoardCensusSchema.safeParse(value);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  return ok(parsed.data);
}
