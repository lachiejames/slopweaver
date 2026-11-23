/**
 * A chair seat's constants, written ONCE by `supervisor tick seat` into `seat.json` and read by every
 * `tick open` and `tick close` after it.
 *
 * The chair's per-pass script retyped `--workspace workspace:93 --handoff handoff-<n> --model fable
 * --pinned-at <iso>` and its loop session key on every one of its passes, and a successor
 * seat copying that script inherits a predecessor's constants with nothing to say they are stale. Here they
 * are one strict file in the seat's own scratch directory, and the handoff is re-derived from that directory's
 * name on every read, so a `seat.json` copied into another seat's directory refuses rather than publishing
 * the wrong seat's header.
 *
 * Pure: parse and validate. The edge reads and writes the file.
 */
import { basename } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "#lib/result.js";

import { type TickWorkflowError, TickWorkflowErrors } from "./tickWorkflowErrors.js";

/** The file's name inside the seat's scratch directory. */
export const SEAT_FILE = "seat.json";

/** A cmux workspace ref as the form's header spells it: `workspace:<digits>`. */
const WORKSPACE_REF = /^workspace:\d+$/u;

/** A handoff directory name: `handoff-<digits>`. */
const HANDOFF_NAME = /^handoff-\d+$/u;

/** An `owner/name` repository slug. */
const REPO_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/u;

const seatSchema = z
  .object({
    handoff: z.string().regex(HANDOFF_NAME, "must be handoff-<digits>"),
    landingRepos: z.array(z.string().regex(REPO_SLUG, "must be an owner/name slug")),
    loopSessionKey: z.string().trim().min(1),
    model: z.string().trim().min(1),
    pinnedAtIso: z.iso.datetime({ offset: true }),
    schemaVersion: z.literal(1),
    workspace: z.string().regex(WORKSPACE_REF, "must be workspace:<digits>"),
  })
  .strict();

/** One seat's constants. */
export type TickSeat = z.output<typeof seatSchema>;

/**
 * The handoff a scratch directory names — its basename, when that basename is `handoff-<digits>`.
 *
 * @param dir the seat's scratch directory
 * @returns the handoff, or undefined when the directory is not named for one
 */
export function handoffOfDir({ dir }: { dir: string }): string | undefined {
  const name = basename(dir);
  return HANDOFF_NAME.test(name) ? name : undefined;
}

/**
 * Validate one seat document, and refuse one read from a directory it does not belong to.
 *
 * @param value the parsed `seat.json`
 * @param dir the scratch directory it was read from
 * @param path the file's path, named in a refusal
 * @returns the seat, or why it cannot be used from this directory
 */
export function parseTickSeat({
  value,
  dir,
  path,
}: {
  value: unknown;
  dir: string;
  path: string;
}): Result<TickSeat, TickWorkflowError> {
  const parsed = seatSchema.safeParse(value);
  if (!parsed.success) {
    const reason = parsed.error.issues
      .map((issue) => {
        const at = issue.path.map(String).join(".");
        return at.length === 0 ? issue.message : `${at}: ${issue.message}`;
      })
      .join("; ");
    return err(TickWorkflowErrors.seatInvalid({ path, reason }));
  }
  const fromDir = handoffOfDir({ dir });
  if (fromDir !== undefined && fromDir !== parsed.data.handoff) {
    return err(
      TickWorkflowErrors.seatInvalid({
        path,
        reason:
          `names ${parsed.data.handoff} but sits in ${fromDir}'s directory — a seat file is never carried to a ` +
          "successor; run `supervisor tick seat` in this seat",
      }),
    );
  }
  return ok(parsed.data);
}

/**
 * A new seat document, validated by the same schema that reads it back.
 *
 * @param seat the constants, as flags supplied them
 * @param dir the scratch directory the file is written into
 * @param path the file's path, named in a refusal
 * @returns the document to write, or why it would not read back
 */
export function newTickSeat({
  seat,
  dir,
  path,
}: {
  seat: Omit<TickSeat, "schemaVersion">;
  dir: string;
  path: string;
}): Result<TickSeat, TickWorkflowError> {
  return parseTickSeat({ dir, path, value: { ...seat, schemaVersion: 1 } });
}
