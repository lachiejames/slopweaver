/**
 * A finished Codex pass reclaims its OWN scratch workspace, the moment its artifact is written.
 *
 * `home reclaim --root codex-scratch --apply` (`./run.ts`) already removes a finished pass's whole scratch, and
 * its criterion is right. Nothing ran it, though. A pass may clone the repository, install dependencies or
 * build inside its scratch, so a multi-gigabyte checkout per pass built up under `orchestration` until the disk
 * filled. There is no daemon or timer to run the bulk verb (AGENTS.md rule 2). The pass is already running,
 * and it is the one process that KNOWS which workspace is its own, so it takes that one directory when it
 * finishes.
 *
 * The checks are the bulk verb's own, narrowed to one entry. The criterion is `./roots.ts`'s
 * `finished-scratch`: a scratch whose sibling `<id>/artifact.md` exists. A symlink is never followed, a
 * record-shaped scratch is refused, sizing counts only blocks the removal frees, the witness re-checks what
 * must survive, and the ledger row is the one `home reclaimed` prints. Three checks are added here:
 *
 * - **The exact path the pass was given.** The caller passes the path `createPassScratch` returned
 *   (`../../codex/artifactStore.ts`), and this refuses any other. An id alone is not enough: a second pass
 *   minted with a duplicate id fails to create its scratch, so the directory under that name is somebody
 *   else's, and the caller passes no path at all.
 * - **Both record files before anything is removed.** The writer puts `record.json` first and `artifact.md`
 *   last, so both are present for a pass that just published. A witness bound to fail is caught before the
 *   delete rather than after it.
 * - **Every directory involved is real**: the orchestration root, the record directory and the scratch.
 *
 * What this cannot make atomic, the same as the bulk verb: a removal that succeeds and is then followed by a
 * failed witness or ledger append has already freed the bytes. A process the pass left running in the
 * background with its cwd in the scratch is not detected either. The pass contract is that commands finish
 * with the turn, and a one-time process scan would itself race.
 */
import { dirname, join, resolve } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { type HomeReclaimError, HomeReclaimErrors } from "./errors.js";
import { appendReclaimRow } from "./journalStore.js";
import { RECLAIM_ROOTS } from "./roots.js";
import { isRecordShaped, type RootOutcome, rootIsRealDirectory, sizeScratch } from "./run.js";
import { removeEntry, stillExists } from "./scan.js";

/** What a one-pass reclaim reaches outside itself. */
export interface PassScratchReclaimDeps {
  /** The reclaim ledger, `stateHomePaths().homeReclaimLedgerJsonl`. */
  readonly ledgerPath: string;
  /** The instant the ledger row is stamped with. */
  readonly nowIso: () => string;
}

/** The `codex-scratch` root the bulk verb declares; this module takes from it and from nowhere else. */
const CODEX_SCRATCH_ROOT = RECLAIM_ROOTS.find((root) => root.name === "codex-scratch")!;

/**
 * The ledger's author for a pass's own reclaim: the pass, by its id, so the row leads straight to the
 * `<id>/record.json` whose scratch it removed. It holds in or out of cmux, unlike the ambient workspace name.
 * The root already says which runner the pass was, so the label does not repeat it.
 *
 * @param artifactId the pass id
 * @returns the session value the ledger row carries
 */
export function passReclaimSession({ artifactId }: { artifactId: string }): string {
  return `pass:${artifactId}`;
}

/**
 * Remove one finished pass's own scratch workspace, witness that its record survived, and journal the act.
 *
 * @param artifactId the pass id whose artifact was just published
 * @param orchestrationRoot `$SLOPWEAVER_HOME/orchestration`
 * @param scratchPath the path `createPassScratch` returned to THIS pass, never one rebuilt from the id
 * @param deps the ledger path and the clock
 * @returns what was removed and freed, or the typed refusal; a refusal before the removal leaves the
 *   scratch exactly as it was
 */
export function reclaimFinishedPassScratch({
  artifactId,
  orchestrationRoot,
  scratchPath,
  deps,
}: {
  artifactId: string;
  orchestrationRoot: string;
  scratchPath: string;
  deps: PassScratchReclaimDeps;
}): Result<RootOutcome, HomeReclaimError> {
  const root = resolve(orchestrationRoot);
  const scratchName = `${artifactId}.scratch`;
  const scratch = resolve(scratchPath);
  if (dirname(scratch) !== root || scratch !== join(root, scratchName)) {
    return err(HomeReclaimErrors.passScratchNotReclaimable({ artifactId, reason: "workspace-mismatch" }));
  }
  const recordDir = join(root, artifactId);
  const checked = checkBeforeRemoval({ artifactId, recordDir, root, scratch });
  if (checked.isErr()) {
    return err(checked.error);
  }
  const sized = sizeScratch({ absolute: root, relativePath: scratchName });
  if (sized.isErr()) {
    return err(sized.error);
  }
  const stillReal = rootIsRealDirectory({ absolute: root });
  if (stillReal.isErr()) {
    return err(stillReal.error);
  }
  const removal = removeEntry({ relativePath: scratchName, root });
  if (removal.isErr()) {
    return err(removal.error);
  }
  const journalled = witnessAndJournal({ artifactId, deps, freedBytes: sized.value.bytes, root });
  if (journalled.isErr()) {
    return err(journalled.error);
  }
  return ok({
    applied: true,
    because: CODEX_SCRATCH_ROOT.because,
    entries: [scratchName],
    examined: 1,
    freedBytes: sized.value.bytes,
    root: CODEX_SCRATCH_ROOT.name,
    takes: CODEX_SCRATCH_ROOT.takes,
    witnessHeld: true,
  });
}

/**
 * After the removal: prove both record files survived, then append the ledger row. A failure here comes after
 * the bytes are gone, which is the residue the header states.
 *
 * @param artifactId the pass id whose record must still be there
 * @param root the resolved orchestration root
 * @param freedBytes what the removal freed, for the row
 * @param deps the ledger path and the clock
 * @returns true once witnessed and journalled, or the typed failure
 */
function witnessAndJournal({
  artifactId,
  deps,
  freedBytes,
  root,
}: {
  artifactId: string;
  deps: PassScratchReclaimDeps;
  freedBytes: number;
  root: string;
}): Result<true, HomeReclaimError> {
  const lostPaths = ["record.json", "artifact.md"]
    .map((name) => join(artifactId, name))
    .filter((relativePath) => !stillExists({ path: join(root, relativePath) }));
  if (lostPaths.length > 0) {
    return err(HomeReclaimErrors.witnessFailed({ lostPaths }));
  }
  const journalled = appendReclaimRow({
    path: deps.ledgerPath,
    row: {
      atIso: deps.nowIso(),
      freedBytes,
      removedEntries: 1,
      root: CODEX_SCRATCH_ROOT.name,
      session: passReclaimSession({ artifactId }),
      takes: CODEX_SCRATCH_ROOT.takes,
      witnessHeld: true,
    },
  });
  if (journalled.isErr()) {
    return err(journalled.error);
  }
  return ok(true);
}

/**
 * Every check that must hold before the one removal: real directories, a published record, and a scratch that
 * is not itself record-shaped.
 *
 * @param artifactId the pass id, for the refusal
 * @param root the resolved orchestration root
 * @param recordDir `<root>/<id>`
 * @param scratch `<root>/<id>.scratch`
 * @returns true when the scratch may go, or the refusal; nothing is touched either way
 */
function checkBeforeRemoval({
  artifactId,
  root,
  recordDir,
  scratch,
}: {
  artifactId: string;
  root: string;
  recordDir: string;
  scratch: string;
}): Result<true, HomeReclaimError> {
  for (const directory of [root, recordDir, scratch]) {
    const real = rootIsRealDirectory({ absolute: directory });
    if (real.isErr()) {
      return err(real.error);
    }
  }
  if (!stillExists({ path: join(recordDir, "record.json") })) {
    return err(HomeReclaimErrors.passScratchNotReclaimable({ artifactId, reason: "record-missing" }));
  }
  if (!stillExists({ path: join(recordDir, "artifact.md") })) {
    return err(HomeReclaimErrors.passScratchNotReclaimable({ artifactId, reason: "artifact-missing" }));
  }
  if (isRecordShaped({ directory: scratch })) {
    return err(HomeReclaimErrors.passScratchNotReclaimable({ artifactId, reason: "record-shaped-scratch" }));
  }
  return ok(true);
}
