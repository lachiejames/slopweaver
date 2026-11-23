/**
 * Mirroring ONE board document into `board_row` the moment a handover verb writes it.
 *
 * Step 3 of the board migration (owner ruling): after any handover write the row
 * matches the file on disk without a batch re-import, while the FILE stays authoritative. `store import-fleet`
 * is still the reconciler; this is what keeps it from being the only way a row ever moves.
 *
 * ## It re-reads the file rather than taking the text the writer composed
 *
 * The row's `doc_hash` is only a witness if it is the hash of what is on disk. A writer's own text is what the
 * writer BELIEVED it wrote; a formatter, a hook or a concurrent writer between the write and the mirror is
 * exactly what that belief would hide. So {@link mirrorBoardDoc} takes a path, never a text.
 *
 * ## Only a document in the home's own board directory is mirrored
 *
 * `store import-fleet` reads `stateHomePaths(home).handovers` and nothing else, so that directory IS the
 * table's board. `handover lint --doc <any path>` and a `--dir` board elsewhere would otherwise upsert over a
 * real row that happens to share a slug. {@link isHomeBoardDoc} is that line, and it is pure.
 *
 * ## Loud, and not yet fatal — a reading of the owner's ruling, not the ruling
 *
 * The owner's rule that the fleet fails loudly is about the state where the board LIVES in the store. During
 * dual-write the file is authoritative and has already been written, so a fleet whose row is behind is not
 * running on stale state. A fatal mirror would also import the authority flip's failure surface before its
 * blocker lands: until the build reads its own migrations, a checkout on a schema branch
 * cannot open the store at all, so no session there could register a row.
 * {@link boardStoreIsAuthoritative} is the one switch that turns every failure fatal.
 */
import { readFileSync, realpathSync } from "node:fs";
import { dirname } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { parseHandoverDoc } from "../../handover/doc.js";
import { stateHomePaths } from "../../stateHome.js";

import { connectStore } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import type { NewBoardRowRecord } from "../schema/board.js";

import { projectBoardDoc } from "./boardRow.js";
import { type FleetImportError, FleetImportErrors } from "./errors.js";
import { importBoardRows } from "./store.js";

/** What mirroring one document did, when nothing failed. */
export type BoardMirrorOutcome =
  /** The row now carries this document's hash. */
  | { readonly kind: "mirrored"; readonly slug: string; readonly docHash: string }
  /** The document is not in the home's board directory, so no row is this document's to write. */
  | { readonly kind: "outside-board" }
  /** This home has selected no store, so there is no row to be behind. */
  | { readonly kind: "no-store" };

/** Every way a mirror can fail: the store's own failures, or the document's. */
export type BoardMirrorError = StoreError | FleetImportError;

/**
 * Whether the board LIVES in the store rather than in `handovers/`.
 *
 * `false` for the whole dual-write step. The authority flip (step 5) is this one line, and it is sequenced
 * behind the build reading its own migrations — see the module header for why flipping it first would stop every session on a
 * schema branch from registering a row.
 *
 * @returns whether a failed mirror must fail the verb that wrote the document
 */
export function boardStoreIsAuthoritative(): boolean {
  return false;
}

/**
 * Whether a document sits directly in the board directory `store import-fleet` reads.
 *
 * Compared as given: the caller resolves both sides the same way (see {@link mirrorBoardDoc}), so a symlinked
 * temp directory does not read as two places.
 *
 * @param path the document just written
 * @param boardDir the home's `handovers/` directory
 * @returns true only for a top-level document there — `archive/` is not the live board
 */
export function isHomeBoardDoc({ path, boardDir }: { path: string; boardDir: string }): boolean {
  return path.endsWith(".md") && dirname(path) === boardDir;
}

/**
 * Project a document's on-disk text into the row an upsert takes.
 *
 * @param path where the text was read from, recorded as the row's source
 * @param text the document exactly as read
 * @returns the row, or the typed reason the document cannot become one
 */
export function projectMirroredDoc({
  path,
  text,
}: {
  path: string;
  text: string;
}): Result<NewBoardRowRecord, FleetImportError> {
  return projectBoardDoc({ doc: parseHandoverDoc({ path, text }), text });
}

/**
 * The lines a verb prints when its mirror failed, having already written the file.
 *
 * @param verb the handover verb that wrote the document, named so the operator knows which write is behind
 * @param path the document
 * @param error what failed
 * @returns the refusal, first line naming the file as authoritative and the reconcile command
 */
export function mirrorFailureLines({
  verb,
  path,
  error,
}: {
  verb: string;
  path: string;
  error: BoardMirrorError;
}): readonly string[] {
  return [
    `handover ${verb}: ${path} is written and is the board, but board_row is BEHIND it (${error.code}) — ` +
      "reconcile with `slopweaver store import-fleet --only board` once the store answers",
    `  ${error.message}`,
  ];
}

/**
 * Both sides of the board-directory comparison, resolved through the filesystem.
 *
 * @param path the document
 * @param boardDir the home's board directory
 * @returns the resolved pair, or `undefined` when either is absent — an absent board holds no document
 */
function resolvedPair({
  path,
  boardDir,
}: {
  path: string;
  boardDir: string;
}): { path: string; boardDir: string } | undefined {
  try {
    return { boardDir: realpathSync(boardDir), path: realpathSync(path) };
  } catch {
    return undefined;
  }
}

/**
 * Re-read one just-written document and upsert its row on slug.
 *
 * @param path the document the verb wrote
 * @param home the state home whose board and store selection apply
 * @param env the environment the store selection is read from; defaults to the process's own
 * @returns what happened, or the typed failure — never thrown
 */
export async function mirrorBoardDoc({
  path,
  home,
  env = process.env,
}: {
  path: string;
  home: string;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<Result<BoardMirrorOutcome, BoardMirrorError>> {
  const pair = resolvedPair({ boardDir: stateHomePaths({ home }).handovers, path });
  if (pair === undefined || !isHomeBoardDoc(pair)) {
    return ok({ kind: "outside-board" });
  }
  let text: string;
  try {
    text = readFileSync(pair.path, "utf8");
  } catch {
    return err(FleetImportErrors.sourceAbsent({ path }));
  }
  const row = projectMirroredDoc({ path, text });
  if (row.isErr()) {
    return err(row.error);
  }
  try {
    return await upsertMirroredRow({ env, home, row: row.value });
  } catch (cause) {
    // The verb has ALREADY written the file, so a driver that throws (a `close` that rejects, a connection
    // string the driver cannot parse) must not crash it: the throw becomes the same loud, typed failure.
    return err(StoreErrors.queryFailed({ cause, what: `mirror ${path} into board_row` }));
  }
}

/**
 * Open the selected store, upsert one row, and close it.
 *
 * @param row the projected document
 * @param home the state home whose store selection applies
 * @param env the environment the selection is read from
 * @returns the outcome, or the typed store failure
 */
async function upsertMirroredRow({
  row,
  home,
  env,
}: {
  row: NewBoardRowRecord;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}): Promise<Result<BoardMirrorOutcome, BoardMirrorError>> {
  const opened = await connectStore({ env, home });
  if (opened.isErr()) {
    if (opened.error.code === "STORE_URL_MISSING") {
      return ok({ kind: "no-store" });
    }
    return err(opened.error);
  }
  try {
    const written = await importBoardRows({ client: opened.value, rows: [row] });
    if (written.isErr()) {
      return err(written.error);
    }
  } finally {
    await opened.value.close();
  }
  return ok({ docHash: row.docHash, kind: "mirrored", slug: row.slug });
}
