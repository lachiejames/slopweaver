/**
 * The page a `supervisor tick close` publishes, rendered from EXACTLY the list the close bound. The staged
 * `tick-<n>/run.json` is read once, its bytes checked against the digest the close state records
 * (`./tickCloseListPolicy.ts`), and the render handed a private copy of those very bytes — never `tick-<n>/run.json`
 * itself, which another process could replace between the check and the render's own open, then restore before any later
 * check. The render dates the owner's list from the document's own `nowIso`, never the file's mtime
 * (`../briefing/renderReaders.ts`), so the copy is exactly as stale as the bytes it holds.
 *
 * What this defends is the tick's WELL-KNOWN path, which other sessions and the overrun route legitimately write.
 * A process running as the same user that deliberately rewrites the close's own randomly named, owner-only copy
 * while the in-process render awaits is outside it: that actor could equally rewrite close-state.json
 * and the staged list together, which no digest kept beside them can tell apart.
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { archiveDocument } from "../../../briefing/archive.js";
import { type TickWorkflowError, TickWorkflowErrors } from "../../../supervisor/tickWorkflowErrors.js";
import type { CloseRead } from "./tickCloseRead.js";
import { boundListBytes, refreshList } from "./tickCloseRefresh.js";
import { type ProposedForm, renderCommittedPage, renderFittedPage } from "./tickCloseRender.js";
import type { TickCloseArgs } from "./tickCore.js";
import type { SupervisorTickDeps } from "./tickDeps.js";
import { readText, tickDirIntact } from "./tickFiles.js";

/** A rendered page: its HTML, the form it shows, and what the count archive moved out. */
interface ClosePage {
  readonly html: string;
  readonly formAfter: string;
  readonly archive: Readonly<Record<string, unknown>> | undefined;
}

/**
 * The page this close publishes and the form it commits. A close that has not yet committed its form fits the
 * proposed one under the byte cap; a resumed close past that stage renders the form the seat ALREADY holds,
 * exactly, and archives nothing, so the page can never describe a form the seat does not have.
 *
 * @param proposal the swept form, used only when the form stage is still owed
 * @param listPath the file the render reads the owner's list from
 * @returns the page, the form after and the archive document, or the first refusal
 */
async function closePage({
  deps,
  read,
  proposal,
  home,
  listPath,
}: {
  deps: SupervisorTickDeps;
  read: CloseRead;
  proposal: ProposedForm;
  home: string;
  listPath: string;
}): Promise<Result<ClosePage, TickWorkflowError>> {
  if (!read.owed.includes("form-committed")) {
    const formPath = join(read.dir, "form.json");
    const committed = readText({ path: formPath });
    if (committed.isErr()) {
      return err(TickWorkflowErrors.captureInvalid({ path: formPath, reason: "the committed form could not be read" }));
    }
    const page = await renderCommittedPage({ deps, formText: committed.value, home, listPath, read });
    return page.map((html) => ({ archive: undefined, formAfter: committed.value, html }));
  }
  const fitted = await renderFittedPage({ deps, home, listPath, proposal, read });
  return fitted.map(({ archive, formAfter, html }) => ({
    archive:
      archive.earlierNotes.length + archive.historySections.length > 0
        ? archiveDocument({ archive, archivedAtIso: read.nowIso, formPath: join(read.dir, "form.json") })
        : undefined,
    formAfter,
    html,
  }));
}

/**
 * The private copy of the bound bytes, in a fresh, owner-only, randomly named directory inside the tick's OWN
 * directory: the one place every resume already writes (its close state), so the copy adds no directory a resume
 * must be able to write that it did not before — not the seat's, not `TMPDIR`'s. The tick
 * directory is checked to be the one the close read first, as every write into it is (`./tickFiles.ts`). No failure
 * is a throw, and a copy that fails once its directory exists removes that directory before refusing.
 *
 * The residue, stated: the copy is still one subdirectory and one list-sized file a resume did not make before, so
 * an environment built to admit the close-state write while refusing exactly those — an ACL denying only
 * `add_subdirectory` on `tick-<n>/`, a file-size limit between the two sizes — refuses a resume the old code
 * finished. Handing the render the bound BYTES rather than a path would close it, at the cost
 * of a second input shape on the in-process `briefing render` seam; this does not take that on.
 *
 * The directory is set to `0700` explicitly once made, because `mkdtemp`'s mode is masked by the process umask and a
 * umask of `0777` would leave a directory nothing can write into or remove.
 *
 * @param bytes the bound list's bytes, already checked against its digest
 * @returns the private directory and the copy inside it, or the refusal naming why either could not be made
 */
function privateCopy({ read, bytes }: { read: CloseRead; bytes: Buffer }): Result<PrivateCopy, TickWorkflowError> {
  const intact = tickDirIntact({ identity: read.tickDirIdentity, tickDir: read.tickDir });
  if (intact.isErr()) {
    return err(intact.error);
  }
  let dir: string;
  try {
    dir = mkdtempSync(join(read.tickDir, ".list-copy-"));
  } catch (error) {
    return err(copyRefused({ error, tickDir: read.tickDir }));
  }
  try {
    chmodSync(dir, 0o700);
    const listPath = join(dir, "run.json");
    writeFileSync(listPath, bytes);
    return ok({ dir, listPath });
  } catch (error) {
    rmSync(dir, { force: true, recursive: true });
    return err(copyRefused({ error, tickDir: read.tickDir }));
  }
}

/** The private directory a render reads the bound list from, and the copy inside it. */
interface PrivateCopy {
  readonly dir: string;
  readonly listPath: string;
}

/**
 * The refusal naming a private copy that could not be made — a directory the tick's cannot hold, a full disk.
 *
 * @param error what the filesystem threw
 * @returns the refusal
 */
function copyRefused({ tickDir, error }: { tickDir: string; error: unknown }): TickWorkflowError {
  const reason = error instanceof Error ? error.message : String(error);
  return TickWorkflowErrors.preflightRefused({
    reasons: [`${tickDir}: could not make a private copy of the bound list (${reason})`],
    stage: "the staged list",
  });
}

/**
 * Render the page from the bound list's own bytes, copied into a private directory removed once the render is done.
 *
 * @param listSha256 the digest the close bound
 * @param proposal the swept form, used only when the form stage is still owed
 * @returns the page, or the refusal naming a staged list that no longer holds the bound bytes
 */
async function pageFromBoundBytes({
  deps,
  home,
  listSha256,
  proposal,
  read,
}: {
  deps: SupervisorTickDeps;
  home: string;
  listSha256: string;
  proposal: ProposedForm;
  read: CloseRead;
}): Promise<Result<ClosePage, TickWorkflowError>> {
  const bytes = boundListBytes({ listSha256, path: join(read.tickDir, "run.json") });
  if (bytes.isErr()) {
    return err(TickWorkflowErrors.preflightRefused({ reasons: [bytes.error], stage: "the staged list" }));
  }
  const copy = privateCopy({ bytes: bytes.value, read });
  if (copy.isErr()) {
    return err(copy.error);
  }
  try {
    return await closePage({ deps, home, listPath: copy.value.listPath, proposal, read });
  } finally {
    rmSync(copy.value.dir, { force: true, recursive: true });
  }
}

/**
 * Stage the owner's list, then render the page from the bound bytes — or from the seat's own list, which binds none.
 *
 * @param proposal the swept form, used only when the form stage is still owed
 * @returns the page beside which list it rendered and that list's digest, or the first refusal
 */
export async function renderBoundPage({
  args,
  deps,
  home,
  proposal,
  read,
}: {
  args: TickCloseArgs;
  deps: SupervisorTickDeps;
  home: string;
  proposal: ProposedForm;
  read: CloseRead;
}): Promise<Result<ClosePage & { listSha256: string | null; refreshed: boolean }, TickWorkflowError>> {
  const list = await refreshList({ args, deps, read });
  if (list.isErr()) {
    return err(list.error);
  }
  const { listSha256, refreshed } = list.value;
  const page =
    listSha256 === null
      ? await closePage({ deps, home, listPath: join(read.dir, "run.json"), proposal, read })
      : await pageFromBoundBytes({ deps, home, listSha256, proposal, read });
  return page.map((rendered) => ({ ...rendered, listSha256, refreshed }));
}
