/**
 * `slopweaver workstreams put` — make the whole register a schema-version-2 document, in one transaction.
 *
 * The argv edge only. The document is the one `workstreams list --json` printed, edited: it carries the `baseline`
 * it was read at, and that baseline is the only one used (`../../../workstreams/store/wholePut.ts`) — a register
 * that moved since is refused rather than written over what its author never saw, and a document with no baseline can
 * only seed an empty register. Every rule of a workstream is the store's own judge, inside `applyBatch`, so a caller
 * that is not this CLI cannot skip one. Nothing is written when one rule fails.
 */
import { readFileSync } from "node:fs";

import { errorMessage } from "#lib/errorMessage.js";
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { snapshotBaseline } from "../../../workstreams/store/baseline.js";
import { sameRevisions } from "../../../workstreams/store/batchPlan.js";
import { WorkstreamStoreErrors } from "../../../workstreams/store/errors.js";
import type { WorkstreamStore } from "../../../workstreams/store/port.js";
import { productionWorkstreamRegister } from "../../../workstreams/store/register.js";
import type { WorkstreamRegisterSnapshot } from "../../../workstreams/store/types.js";
import {
  parseWholeRegisterDocument,
  type WholeRegisterBatch,
  type WholeRegisterDocument,
  wholeRegisterBatch,
} from "../../../workstreams/store/wholePut.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";

import { parseWorkstreamsPutArgs, stringFlag, VERB_ARG_OFFSET } from "./core.js";
import { WORKSTREAMS_PUT_USAGE } from "./usage.js";

/** The refusals a batch's compare-and-set gives when the register moved after the read it was built from. */
const COMMIT_CONFLICTS: ReadonlySet<string> = new Set([
  "WORKSTREAM_WHOLE_REGISTER_CONFLICT",
  "WORKSTREAM_REVISION_CONFLICT",
  "WORKSTREAM_META_REVISION_CONFLICT",
]);

/** Everything `workstreams put` touches outside itself, injected so a test drives the whole verb. */
export interface WorkstreamsPutDeps {
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
  /** The register: production's is the store behind the tombstone. */
  readonly store: WorkstreamStore;
}

/**
 * The argv and the document file, read and parsed; every refusal printed here, so a failure is only its exit code.
 *
 * @param rest the argv tail after `workstreams put`
 * @returns the document, its home and whether `--json` was asked, or the exit code to end on
 */
function readPutDocument({
  deps,
  rest,
}: {
  deps: WorkstreamsPutDeps;
  rest: readonly string[];
}): Result<{ document: WholeRegisterDocument; home: string; json: boolean }, number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(WORKSTREAMS_PUT_USAGE);
    return err(EXIT_OK);
  }
  const parsed = parseWorkstreamsPutArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((problem) => {
      deps.writeDiagnostic(problem);
    });
    deps.writeDiagnostic(WORKSTREAMS_PUT_USAGE);
    return err(EXIT_USAGE);
  }
  const values = parsed.value.values;
  const file = stringFlag({ name: "file", values });
  if (file === undefined) {
    deps.writeDiagnostic("workstreams put: --file is required");
    deps.writeDiagnostic(WORKSTREAMS_PUT_USAGE);
    return err(EXIT_USAGE);
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "the workstreams register", text: readFileSync(file, "utf8") });
  } catch (error: unknown) {
    deps.writeDiagnostic(`workstreams put: could not read ${file} as JSON — ${errorMessage({ error })}`);
    return err(EXIT_ERROR);
  }
  const document = parseWholeRegisterDocument({ value });
  if (document.isErr()) {
    deps.writeDiagnostic(`workstreams put: ${document.error.message}`);
    return err(EXIT_USAGE);
  }
  const home = resolveHome({ named: stringFlag({ name: "home", values }) });
  return ok({ document: document.value, home, json: values["json"] === true });
}

/**
 * Whether a fresh read is still the register the document was read at: the same content AND every id at the revision
 * that read saw. A batch with no `wholeRegister` to compare is never still as read, so it refuses rather than passes.
 *
 * @param baseline the content baseline the document carries
 * @param read every id and the revision the batch's read saw it at
 * @param snapshot the fresh read
 * @returns true only when neither the content nor any revision moved
 */
function stillAsRead({
  baseline,
  read,
  snapshot,
}: {
  baseline: string;
  read: Readonly<Record<string, number>> | undefined;
  snapshot: WorkstreamRegisterSnapshot;
}): boolean {
  if (read === undefined || snapshotBaseline({ snapshot }) !== baseline) {
    return false;
  }
  return sameRevisions({
    actual: Object.fromEntries(snapshot.workstreams.map((one) => [one.id, one.revision])),
    expected: read,
  });
}

/**
 * Commit one batch, or — when it changes nothing, which the store's judge refuses as a batch — confirm the document
 * is still current. A register that moved between the read and the commit, even if only a revision did, is the same
 * stale document.
 *
 * @param batch what makes the register the document, built from one read
 * @param baseline the baseline the document carries
 * @returns how many workstreams were written, or the exit code to end on
 */
async function commitPutBatch({
  baseline,
  batch,
  deps,
  home,
}: {
  baseline: string;
  batch: WholeRegisterBatch;
  deps: WorkstreamsPutDeps;
  home: string;
}): Promise<Result<number, number>> {
  const { deletes, meta, writes } = batch;
  const nothingToChange =
    writes.length === 0 && deletes.length === 0 && meta.document === null && meta.expectedRevision === null;
  if (nothingToChange) {
    const fresh = await deps.store.read({ home });
    if (fresh.isErr() || !stillAsRead({ baseline, read: batch.wholeRegister, snapshot: fresh.value })) {
      return err(reportStale({ deps, expected: baseline, fresh }));
    }
    return ok(0);
  }
  const applied = await deps.store.applyBatch({ ...batch, home });
  if (applied.isOk()) {
    return ok(applied.value.written.length);
  }
  if (COMMIT_CONFLICTS.has(applied.error.code)) {
    return err(reportStale({ deps, expected: baseline, fresh: await deps.store.read({ home }) }));
  }
  deps.writeDiagnostic(`workstreams put: ${applied.error.code}: ${applied.error.message}`);
  // A workstream the store's rules refuse is content that was read and is wrong; anything else is the store.
  return err(applied.error.code === "WORKSTREAM_INVALID" ? EXIT_USAGE : EXIT_ERROR);
}

/**
 * Run `workstreams put` against injected seams.
 *
 * @param rest the argv tail after `workstreams put`
 * @param deps everything the verb touches outside itself
 * @returns the process exit code
 */
export async function runWorkstreamsPut({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: WorkstreamsPutDeps;
}): Promise<number> {
  const input = readPutDocument({ deps, rest });
  if (input.isErr()) {
    return input.error;
  }
  const { document, home, json } = input.value;
  const read = await deps.store.read({ home });
  if (read.isErr()) {
    deps.writeDiagnostic(`workstreams put: ${read.error.code}: ${read.error.message}`);
    return EXIT_ERROR;
  }
  const batch = wholeRegisterBatch({ document, snapshot: read.value });
  if (batch.isErr()) {
    deps.writeDiagnostic(`workstreams put: ${batch.error.code}: ${batch.error.message}`);
    return EXIT_ERROR;
  }
  const written = await commitPutBatch({ baseline: document.baseline, batch: batch.value, deps, home });
  if (written.isErr()) {
    return written.error;
  }
  const summary = {
    deleted: batch.value.deletes.length,
    workstreams: document.workstreams.length,
    written: written.value,
  };
  if (json) {
    deps.writeOut(JSON.stringify(summary));
    return EXIT_OK;
  }
  deps.writeOut(
    `workstreams put: the register holds ${String(summary.workstreams)} workstreams — ${String(summary.written)} written, ${String(summary.deleted)} deleted`,
  );
  return EXIT_OK;
}

/**
 * Refuse a document the register moved away from, naming where it moved to when a fresh read can say. The refusal
 * stands whether or not that read answers; a failed one is printed after it.
 *
 * @param expected the baseline the document carries
 * @param fresh the store read again after the move was seen
 * @returns the error exit
 */
function reportStale({
  deps,
  expected,
  fresh,
}: {
  deps: Pick<WorkstreamsPutDeps, "writeDiagnostic">;
  expected: string;
  fresh: Awaited<ReturnType<WorkstreamStore["read"]>>;
}): number {
  let actual = "unknown, because reading it again failed";
  if (fresh.isOk()) {
    actual = snapshotBaseline({ snapshot: fresh.value });
  }
  const stale = WorkstreamStoreErrors.baselineStale({ actual, expected });
  deps.writeDiagnostic(`workstreams put: ${stale.code}: ${stale.message}`);
  if (fresh.isErr()) {
    deps.writeDiagnostic(`workstreams put: ${fresh.error.code}: ${fresh.error.message}`);
  }
  return EXIT_ERROR;
}

/**
 * The real seams: the two output channels and the register.
 *
 * @returns the production dependencies for {@link runWorkstreamsPut}
 */
export function productionWorkstreamsPutDeps(): WorkstreamsPutDeps {
  return {
    store: productionWorkstreamRegister(),
    writeDiagnostic: (line) => {
      logger.error({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver workstreams put`. */
export const workstreamsPutCommand = defineCommand({
  run: (argv) => runWorkstreamsPut({ deps: productionWorkstreamsPutDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
