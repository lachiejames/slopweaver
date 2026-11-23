/**
 * The page half of `supervisor tick close`'s decide step: render and check the proposed form through `briefing
 * render`, in process, and on a refusal leave the refused page its refusal names inside the tick's directory.
 *
 * Three closes in a row: the refusal named `tick-N/page.fragment.refused.html` and the file was never there, because
 * the in-process render captured its pages in memory and the close kept only `--out`. The chair spent three passes
 * guessing at sources. Every page is now captured by path, and the refused one is written.
 *
 * ## A page over its byte cap is fitted, not refused
 *
 * Measured: a page rendered to 262,649 bytes against `PAGE_TEXT_MAX_BYTES`' 262,144, and
 * `earlierToday` held 27 notes weighing 156,801 bytes — under the 28-note count the pre-sweep archive trims to, so
 * nothing moved, and the chair archived down to 12 by hand three refusals in. So a render refused as
 * `RENDER_TOO_LARGE`, and only that, moves more of the oldest notes into the same archive and renders again,
 * down to one note. Each step drops enough notes to cover the measured overshoot (`keepForOvershoot`), because
 * every render re-reads from GitHub the pull requests the page's cards rest on and one render per note would be
 * up to twenty-nine of those reads.
 *
 * ## A passing page writes its bare references back qualified
 *
 * About sixty bare `#N` references in notes twenty ticks old are refused at once when an unrelated row newly links
 * a second repository and nothing names one repository for them any more. So once a page passes, every bare
 * reference its narrative carries is written into
 * the form as `owner/repo#N` against that page's own context (`../../../briefing/qualifyBareRefs.ts`), and the
 * qualified form is rendered and checked again — the form a close commits is always one a page passed, never one
 * rewritten after the check. A qualified form over the byte cap is fitted from the QUALIFIED form.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic, writeFileAtomicBytes } from "#lib/writeAtomic.js";

import {
  archiveBriefingForm,
  type BriefingArchive,
  earlierNotesOf,
  joinArchives,
  keepForOvershoot,
} from "../../../briefing/archive.js";
import { bareRefContextOfPage } from "../../../briefing/bareRef.js";
import { PAGE_TEXT_MAX_BYTES } from "../../../briefing/caps.js";
import { pageTextBytes } from "../../../briefing/pageBudget.js";
import { qualifyBareRefsInNarrative } from "../../../briefing/qualifyBareRefs.js";
import { type TickWorkflowError, TickWorkflowErrors } from "../../../supervisor/tickWorkflowErrors.js";
import { EXIT_OK } from "../../exitCodes.js";
import { formJsonText } from "../briefing/formEditIo.js";
import type { CloseRead } from "./tickCloseRead.js";
import type { SupervisorTickDeps, TickRenderOutcome } from "./tickDeps.js";
import { tickDirIntact } from "./tickFiles.js";

/** The fewest `earlierToday` notes a fitted page keeps: the section schema refuses an empty one. */
const FIT_FLOOR_NOTES = 1;

/** The form a close proposes, before its page has been fitted under the byte cap. */
export interface ProposedForm {
  /** The form after the count archive and the sweep block — every fitting attempt is cut from THIS. */
  readonly swept: Readonly<Record<string, unknown>>;
  /** What the count archive moved before the sweep block ran. */
  readonly countArchive: BriefingArchive;
}

/** The page a close publishes, the form it was rendered from, and everything moved out to get there. */
export interface FittedPage {
  readonly html: string;
  readonly formAfter: string;
  /** Every note and section moved, newest first, beside the form that stays. */
  readonly archive: BriefingArchive;
}

/** One render's inputs that do not change between attempts. */
interface StagedRender {
  readonly argv: readonly string[];
  readonly out: string;
}

/**
 * Settle what every render of this close reads, writing the reviewed open-pages copy once.
 *
 * @param listPath the file the render reads the owner's list from — a private copy of the bound bytes, or the seat's own
 * @returns the argv and the `--out` path the render captures, or the refusal naming a replaced tick directory
 */
function stageRender({
  read,
  home,
  listPath,
}: {
  read: CloseRead;
  home: string;
  listPath: string;
}): Result<StagedRender, TickWorkflowError> {
  const seatPages = join(read.dir, "open-pages.json");
  const tickPages = join(read.tickDir, "open-pages.json");
  // The reviewed copy lands in the tick's directory after the refresh child ran, so the directory is checked to be
  // the one the close read IMMEDIATELY before the write, its bytes read first. The in-process render's --out is
  // never written: its page is captured in memory.
  const reviewed = read.input.openPagesReviewed && existsSync(seatPages) ? readFileSync(seatPages) : undefined;
  const intact = tickDirIntact({ identity: read.tickDirIdentity, tickDir: read.tickDir });
  if (intact.isErr()) {
    return err(intact.error);
  }
  if (reviewed !== undefined) {
    // A COPY, so the seat's own file is untouched until the commit — its fresh mtime is the chair's review. Staged
    // and renamed into place, so a link already sitting at the tick's path is REPLACED, never written through.
    writeFileAtomicBytes({ bytes: reviewed, path: tickPages });
  }
  const pages = read.input.openPagesReviewed ? tickPages : seatPages;
  const out = join(read.tickDir, "page.fragment.html");
  const argv = [
    "--form",
    "-",
    "--home",
    home,
    "--autonomy-ledger",
    "--nothing-stale",
    "--out",
    out,
    ...(existsSync(listPath) ? ["--your-list", listPath] : []),
    ...(existsSync(pages) ? ["--open-artifacts", pages, "--open-page-cards"] : []),
  ];
  return ok({ argv, out });
}

/**
 * A refused render's refusal, once the refused page it names is on disk.
 *
 * @param extra lines this close adds after the render's own
 * @returns the refusal, or the one naming a replaced tick directory
 */
function refusedRender({
  read,
  staged,
  outcome,
  extra,
}: {
  read: CloseRead;
  staged: StagedRender;
  outcome: TickRenderOutcome;
  extra: readonly string[];
}): TickWorkflowError {
  const written = writeRefusedPages({
    out: staged.out,
    pages: outcome.pages,
    tickDir: read.tickDir,
    tickDirIdentity: read.tickDirIdentity,
  });
  if (written.isErr()) {
    return written.error;
  }
  return TickWorkflowErrors.preflightRefused({ reasons: [...outcome.diagnostics, ...extra], stage: "briefing render" });
}

/**
 * Render and check a form already committed to the seat, exactly as it stands — the resumed close's page.
 *
 * Never fitted: a resumed close has written its form, and choosing a different note count now would publish a
 * page for a form the seat does not hold.
 *
 * @param formText the committed form, fed to the render on stdin
 * @param listPath the file the render reads the owner's list from
 * @returns the checked fragment, or the render's own refusal once the refused page it names is on disk
 */
export async function renderCommittedPage({
  deps,
  read,
  formText,
  home,
  listPath,
}: {
  deps: SupervisorTickDeps;
  read: CloseRead;
  formText: string;
  home: string;
  listPath: string;
}): Promise<Result<string, TickWorkflowError>> {
  const staged = stageRender({ home, listPath, read });
  if (staged.isErr()) {
    return err(staged.error);
  }
  const outcome = await deps.render({ argv: staged.value.argv, formText });
  const page = outcome.pages.get(staged.value.out);
  if (outcome.exitCode !== EXIT_OK || page === undefined) {
    return err(refusedRender({ extra: [], outcome, read, staged: staged.value }));
  }
  return ok(page);
}

/**
 * Render and check the proposed form, moving more of the oldest `earlierToday` notes out while the render
 * refuses the page as too large. Every attempt is cut from the same form, so a failed one leaves nothing behind,
 * and only the LAST refusal writes a refused page. A passing page whose narrative still carries a bare reference
 * it resolved is rendered once more with every such reference qualified, and fitting cuts from THAT form after.
 *
 * @param proposal the swept form and what the count archive already moved
 * @param listPath the file the render reads the owner's list from
 * @returns the checked fragment, its form and the whole archive, or the render's own refusal once the refused
 *   page it names is on disk
 */
export async function renderFittedPage({
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
}): Promise<Result<FittedPage, TickWorkflowError>> {
  const staged = stageRender({ home, listPath, read });
  if (staged.isErr()) {
    return err(staged.error);
  }
  // `base` is the form every fitting attempt is cut from, and `moved` what left the form before `base` was taken.
  let base = proposal.swept;
  let moved = proposal.countArchive;
  let candidate: BriefingArchive = { earlierNotes: [], form: base, historySections: [] };
  for (;;) {
    const formText = formJsonText({ form: candidate.form });
    if (formText.isErr()) {
      return err(TickWorkflowErrors.preflightRefused({ reasons: [formText.error.message], stage: "the form" }));
    }
    const outcome = await deps.render({ argv: staged.value.argv, formText: formText.value });
    const page = outcome.pages.get(staged.value.out);
    if (outcome.exitCode === EXIT_OK && page !== undefined) {
      const qualified = qualifiedForm({ form: candidate.form, formText: formText.value, page });
      if (qualified !== undefined) {
        // Each pass only ever turns a bare reference into a qualified one, so this re-render terminates. A note
        // already moved out before this page passed is archived as it stood: it was on no page that passed, so
        // no check ever resolved a repository for it, and writing one would be the writer guessing.
        moved = joinArchives({ earlier: moved, later: candidate });
        base = qualified;
        candidate = { earlierNotes: [], form: base, historySections: [] };
        continue;
      }
      const archive = joinArchives({ earlier: moved, later: candidate });
      return ok({ archive, formAfter: formText.value, html: page });
    }
    const fitted = fittedCandidate({ base, candidate, outcome, read, staged: staged.value });
    if (fitted.isErr()) {
      return err(fitted.error);
    }
    candidate = fitted.value;
  }
}

/**
 * The form a passing page's own check qualifies every resolved bare reference in.
 *
 * @param form the form the page was rendered from
 * @param formText that form as the render read it
 * @param page the passing page
 * @returns the qualified form, or undefined when qualifying changed nothing. A qualified form too large to serialize
 *   is returned too, so the next attempt's own serialization refuses it by name rather than the unqualified form
 *   being committed as though nothing had changed.
 */
function qualifiedForm({
  form,
  formText,
  page,
}: {
  form: Readonly<Record<string, unknown>>;
  formText: string;
  page: string;
}): Readonly<Record<string, unknown>> | undefined {
  const qualified = qualifyBareRefsInNarrative({ context: bareRefContextOfPage({ html: page }), form });
  const qualifiedText = formJsonText({ form: qualified });
  if (qualifiedText.isOk() && qualifiedText.value === formText) {
    return undefined;
  }
  return qualified;
}

/**
 * The next fitting attempt after a refused render: fewer of the oldest notes, cut from `base`.
 *
 * @param base the form every fitting attempt is cut from
 * @param candidate the attempt the render just refused
 * @param outcome that render's outcome
 * @returns the next attempt, or the refusal once the render refused for another reason or no note is left to move
 */
function fittedCandidate({
  base,
  candidate,
  outcome,
  read,
  staged,
}: {
  base: Readonly<Record<string, unknown>>;
  candidate: BriefingArchive;
  outcome: TickRenderOutcome;
  read: CloseRead;
  staged: StagedRender;
}): Result<BriefingArchive, TickWorkflowError> {
  if (outcome.refusalCode !== "RENDER_TOO_LARGE") {
    return err(refusedRender({ extra: [], outcome, read, staged }));
  }
  const notes = earlierNotesOf({ form: candidate.form });
  const keep = keepForOvershoot({
    floor: FIT_FLOOR_NOTES,
    notes,
    overBytes: refusedBytes({ outcome, out: staged.out }) - PAGE_TEXT_MAX_BYTES,
  });
  if (keep === notes.length) {
    const extra = [
      `tick close moved earlierToday down to ${String(notes.length)} note(s) and the page is still over its cap — ` +
        "the weight is in another section, so fold or drop there",
    ];
    return err(refusedRender({ extra, outcome, read, staged }));
  }
  return ok(archiveBriefingForm({ form: base, keepNotes: keep }));
}

/**
 * The text bytes of the page a too-large render refused — the heaviest page it wrote other than `--out`.
 *
 * @param out the render's `--out`, which a refusal never writes
 * @returns the bytes, zero when the render wrote no refused page
 */
function refusedBytes({ outcome, out }: { outcome: TickRenderOutcome; out: string }): number {
  let bytes = 0;
  for (const [path, html] of outcome.pages) {
    if (path !== out) {
      bytes = Math.max(bytes, pageTextBytes({ html }));
    }
  }
  return bytes;
}

/**
 * Write the refused page a refused render named, so the path its refusal prints is one the chair can open.
 *
 * `--out` stays unwritten, since a caller publishes that path; the refused page beside it is the one thing the
 * chair needs to see what was counted. Only a page inside the tick's own directory is written, and only after
 * checking that directory is still the one the close read.
 *
 * @param out the render's `--out`, never written here
 * @param pages every page the render wrote, keyed by the path it named
 * @param tickDirIdentity the tick directory's identity when the close read it
 * @returns nothing on success, or the refusal when the tick directory was replaced under the close
 */
export function writeRefusedPages({
  out,
  pages,
  tickDir,
  tickDirIdentity,
}: {
  out: string;
  pages: ReadonlyMap<string, string>;
  tickDir: string;
  tickDirIdentity: string;
}): Result<void, TickWorkflowError> {
  const refused = [...pages].filter(([path]) => path !== out && dirname(path) === tickDir);
  if (refused.length === 0) {
    return ok(undefined);
  }
  const intact = tickDirIntact({ identity: tickDirIdentity, tickDir });
  if (intact.isErr()) {
    return err(intact.error);
  }
  for (const [path, html] of refused) {
    writeFileAtomic({ contents: html, path });
  }
  return ok(undefined);
}
