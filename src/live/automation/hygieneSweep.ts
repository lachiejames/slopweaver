/**
 * The `hygiene-sweep` kind's pure half: the one landing read its row makes, and the check that what came back
 * is the landing packet a seated session can work from.
 *
 * ## The read is fixed here, not in the row
 *
 * A `hygiene-sweep` row carries NO params, and a row that carries any is refused. The author and every flag
 * are this file's, and the repositories are the organisation's own plus this build's — what a bare `github
 * landing` reads — so a definition file nothing reviews cannot widen what the read covers or turn it into a
 * write. That is `./kinds.ts`'s whole bargain — a row selects a procedure, it never writes one — applied to a
 * kind whose output is handed to a session to act on. With no organisation written the read refuses
 * `ORG_NOT_CONFIGURED`, and the row fails the way any failed read does.
 *
 * ## What it reads, and the two flags it deliberately does not pass
 *
 * `github landing` with no `--repo`, `--author @me`, drafts included, with the live Slack ask search on
 * top of the corpus scan, as one `--json` document. It records its own reading as `recipe:<id>`, which
 * appends to the readings ledger and the reviewer register — local state, never a provider write.
 *
 * - **No `--press`.** `--press` presses GitHub's own "Merge when ready" — a write — and it REFUSES
 *   `--include-drafts`, so it could not be combined with a packet that has to carry the owner's drafts. Pressing a
 *   ready pull request is one of the acts the seated session takes, visibly, through the doored verb.
 * - **No `--if-due`.** A read inside the landing cadence would come back as a `kind: "skipped"` document,
 *   which would replace yesterday's usable packet with one that says nothing. The daily row always reads.
 * - **No `--register`.** The seated session IS the consumer; registering board rows for the same pull
 *   requests would hand the same work to a second seat.
 *
 * Pure: a definition and a home in, a plan out; captured lines in, the packet text out.
 */

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import type { RecipeDefinition } from "./definition.js";

/** One `hygiene-sweep` row, resolved into the exact read it makes. */
export interface HygieneSweepPlan {
  readonly recipeId: string;
  /** The argv past `github landing`, `--home` included, exactly as the landing runner parses it. */
  readonly rest: readonly string[];
}

/** The row carried params; this kind's read is fixed in the build, so any param is a refusal. */
export interface HygieneSweepParamsPresentError {
  readonly code: "PARAMS_PRESENT";
  readonly message: string;
  readonly recipeId: string;
  readonly keys: readonly string[];
}

/** The landing read did not print exactly one document on stdout. */
export interface HygieneSweepPacketCountError {
  readonly code: "PACKET_COUNT";
  readonly message: string;
  readonly recipeId: string;
  readonly count: number;
}

/** The one document the landing read printed is not JSON. */
export interface HygieneSweepPacketNotJsonError {
  readonly code: "PACKET_NOT_JSON";
  readonly message: string;
  readonly recipeId: string;
  readonly cause: unknown;
}

/** The document is JSON and not a landing READ — a skipped tick, or something else entirely. */
export interface HygieneSweepPacketNotReadError {
  readonly code: "PACKET_NOT_READ";
  readonly message: string;
  readonly recipeId: string;
}

/** Every way a `hygiene-sweep` row fails before its packet is published. */
export type HygieneSweepError =
  | HygieneSweepParamsPresentError
  | HygieneSweepPacketCountError
  | HygieneSweepPacketNotJsonError
  | HygieneSweepPacketNotReadError;

/** Factories for {@link HygieneSweepError}, so every refusal names its row the same way. */
export const HygieneSweepErrors = {
  packetCount: ({ recipeId, count }: { recipeId: string; count: number }): HygieneSweepPacketCountError => ({
    code: "PACKET_COUNT",
    count,
    message: `recipe ${recipeId}: github landing printed ${String(count)} document(s) on stdout, expected exactly 1`,
    recipeId,
  }),
  packetNotJson: ({ recipeId, cause }: { recipeId: string; cause: unknown }): HygieneSweepPacketNotJsonError => ({
    cause,
    code: "PACKET_NOT_JSON",
    message: `recipe ${recipeId}: github landing's document is not JSON — ${cause instanceof Error ? cause.message : String(cause)}`,
    recipeId,
  }),
  packetNotRead: ({ recipeId }: { recipeId: string }): HygieneSweepPacketNotReadError => ({
    code: "PACKET_NOT_READ",
    message: `recipe ${recipeId}: github landing's document is not a read (kind "read" with rows and dispatchable)`,
    recipeId,
  }),
  paramsPresent: ({
    recipeId,
    keys,
  }: {
    recipeId: string;
    keys: readonly string[];
  }): HygieneSweepParamsPresentError => ({
    code: "PARAMS_PRESENT",
    keys,
    message:
      `recipe ${recipeId}: a hygiene-sweep row takes no params (found ${keys.join(", ")}) — ` +
      "its read is fixed in src/live/automation/hygieneSweep.ts so a row cannot widen it",
    recipeId,
  }),
} as const;

/**
 * Resolve one `hygiene-sweep` row into the landing read it makes.
 *
 * @param definition the parsed row, already known to select the `hygiene-sweep` kind
 * @param home the state home the read resolves credentials, the board and its ledgers from
 * @returns the plan, or the refusal naming the params the row should not carry
 */
export function planHygieneSweep({
  definition,
  home,
}: {
  readonly definition: RecipeDefinition;
  readonly home: string;
}): Result<HygieneSweepPlan, HygieneSweepError> {
  const keys = Object.keys(definition.params).toSorted();
  if (keys.length > 0) {
    return err(HygieneSweepErrors.paramsPresent({ keys, recipeId: definition.recipeId }));
  }
  return ok({
    recipeId: definition.recipeId,
    rest: [
      "--author",
      "@me",
      "--include-drafts",
      "--slack-live",
      "--json",
      "--record-reading",
      `recipe:${definition.recipeId}`,
      "--home",
      home,
    ],
  });
}

/**
 * The one landing document a read printed, checked to be a READ before anything publishes it.
 *
 * The text is returned as it was printed, never re-serialised: the published packet and the one the seated
 * session sees are the landing verb's own bytes. The check is the document's own discriminant plus the two
 * arrays a session works from, which is exactly how `LandingDocument` tells a read from a skipped tick.
 *
 * @param lines everything the landing read printed on stdout
 * @param recipeId the row, for the refusal
 * @returns the document text, or why it is not a packet
 */
export function landingPacketOf({
  lines,
  recipeId,
}: {
  readonly lines: readonly string[];
  readonly recipeId: string;
}): Result<string, HygieneSweepError> {
  const text = lines.length === 1 ? lines[0] : undefined;
  if (text === undefined) {
    return err(HygieneSweepErrors.packetCount({ count: lines.length, recipeId }));
  }
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: "github landing document", text });
  } catch (cause: unknown) {
    return err(HygieneSweepErrors.packetNotJson({ cause, recipeId }));
  }
  const isRead =
    isRecord(parsed) &&
    parsed["kind"] === "read" &&
    Array.isArray(parsed["rows"]) &&
    Array.isArray(parsed["dispatchable"]);
  if (!isRead) {
    return err(HygieneSweepErrors.packetNotRead({ recipeId }));
  }
  return ok(text);
}
