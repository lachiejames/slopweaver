/**
 * The write half of `handover register`, under the board-wide tag lock every registration takes.
 *
 * Why every registration and not only a tagged one: a tag is judged to land on the ONE live
 * row claiming a slug. If a registration could create `<slug>.md` while that judgement stood, two rows would share
 * one journal. So registration checks the canonical path and creates it with `wx` inside the same lock
 * `../../../handover/tagStore.ts` takes, and `register --tag` additionally proves the slug has no history at all —
 * no live or archived claimant under any filename, no journal entry — before the doc exists, since a new row
 * appending to an old journal would inherit its tags, rulings and endings.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { isSafeSlug, runJournalPath } from "../../../handover/runStore.js";
import { scanBoard } from "../../../handover/store.js";
import { entryAt, type JudgedTagWrite, judgeTagWrite } from "../../../handover/tagStore.js";
import type { TagRequest } from "../../../handover/tagWrite.js";
import { TagWriteErrors } from "../../../handover/tagWriteErrors.js";
import { slugFromAsk } from "./askRowText.js";

/** A created row: where it landed, and its tag write judged BEFORE it was created — undefined when none was asked. */
export interface CreatedRow {
  readonly path: string;
  readonly judged: JudgedTagWrite | undefined;
}

/** Why the slug already has history a new row would inherit, `undefined` when it has none, or why that is unknown. */
function historyOf({
  handoverDir,
  runsDir,
  slug,
}: {
  handoverDir: string;
  runsDir: string;
  slug: string;
}): Result<string | undefined, string> {
  for (const path of [join(handoverDir, "archive", `${slug}.md`), runJournalPath({ runsDir, slug })]) {
    const entry = entryAt({ path });
    if (entry.isErr()) {
      return err(TagWriteErrors.historyUnknown({ what: `${path} exists`, why: entry.error.message }).message);
    }
    if (entry.value !== undefined) {
      return ok(TagWriteErrors.slugHasHistory({ path }).message);
    }
  }
  return archivedClaimant({ handoverDir, slug });
}

/**
 * An archived doc claiming the slug under ANOTHER filename, `undefined` when none does, or why the archive could not
 * be read. `archive/<slug>.md` alone is not the whole archive: 3 of 389 archived docs carried a slug their
 * filename did not (`grep -m1 '^slug:'` over `~/.slopweaver/handovers/archive/*.md`), so a new row
 * checked by filename only could reuse a closed row's slug. Read only on the `--tag` path.
 */
function archivedClaimant({
  handoverDir,
  slug,
}: {
  handoverDir: string;
  slug: string;
}): Result<string | undefined, string> {
  const archive = join(handoverDir, "archive");
  if (!existsSync(archive)) {
    return ok(undefined);
  }
  try {
    for (const name of readdirSync(archive).filter((each) => each.endsWith(".md"))) {
      const path = join(archive, name);
      if (parseHandoverDoc({ path, text: readFileSync(path, "utf8") }).slug === slug) {
        return ok(`${path} already claims the slug ${slug}, archived — pass --slug for a distinct row`);
      }
    }
  } catch (cause: unknown) {
    return err(TagWriteErrors.historyUnknown({ what: `an archived doc claims ${slug}`, why: String(cause) }).message);
  }
  return ok(undefined);
}

/** The live docs, the one claiming the slug under any filename if one does, or why the board could not be read. */
function liveBoard({
  handoverDir,
  slug,
}: {
  handoverDir: string;
  slug: string;
}): Result<{ readonly docs: readonly HandoverDoc[]; readonly claim: string | undefined }, string> {
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    return err(TagWriteErrors.boardUnread({ cause: scan.error }).message);
  }
  if (scan.value.unreadable.length > 0) {
    return err(TagWriteErrors.boardPartial({ unreadable: scan.value.unreadable }).message);
  }
  const claimant = scan.value.docs.find((doc) => doc.slug === slug);
  const claim =
    claimant === undefined
      ? undefined
      : `${claimant.path} already claims the slug ${slug} — pass --slug for a distinct row`;
  return ok({ claim, docs: scan.value.docs });
}

/**
 * Whether `register --tag` would find the slug already claimed — the same canonical-path, history and board checks
 * {@link createRowDoc} makes, so a caller offering a register command can tell before printing one that would be
 * refused (`../incident/postmortems.ts`). The canonical path counts even when the doc there declares another slug:
 * the `wx` create refuses it all the same.
 *
 * @param handoverDir the board directory
 * @param runsDir the runs directory, for the history check
 * @param slug the slug, already proven safe
 * @returns the claim's refusal line, `undefined` when the slug is free, or why the board or archive could not be read
 */
export function slugClaim({
  handoverDir,
  runsDir,
  slug,
}: {
  handoverDir: string;
  runsDir: string;
  slug: string;
}): Result<string | undefined, string> {
  const path = join(handoverDir, `${slug}.md`);
  const canonical = entryAt({ path });
  if (canonical.isErr()) {
    return err(TagWriteErrors.historyUnknown({ what: `${path} exists`, why: canonical.error.message }).message);
  }
  if (canonical.value !== undefined) {
    return ok(`${path} already exists — pass --slug for a distinct row`);
  }
  return historyOf({ handoverDir, runsDir, slug }).andThen((history) =>
    history === undefined ? liveBoard({ handoverDir, slug }).map((board) => board.claim) : ok(history),
  );
}

/**
 * Judge a new row's tags as if its doc already stood on the board, then create the doc — the tag lock ALREADY held
 * by the caller. Every refusal a tag can meet except the append itself is met BEFORE the doc exists, so a
 * misspelt or unacknowledged tag leaves no row behind.
 *
 * @param handoverDir the board directory
 * @param runsDir the runs directory, for the history check
 * @param slug the new row's slug, already proven safe
 * @param text the doc to write
 * @param tags the tags to judge, or undefined for none — which is also what skips the history check and the scan
 * @returns where it landed and its judged tag write, or the one-line refusal
 */
export function createRowDoc({
  handoverDir,
  runsDir,
  slug,
  text,
  tags,
}: {
  handoverDir: string;
  runsDir: string;
  slug: string;
  text: string;
  tags: TagRequest | undefined;
}): Result<CreatedRow, string> {
  const path = join(handoverDir, `${slug}.md`);
  if (tags === undefined) {
    return writeRowDoc({ handoverDir, judged: undefined, path, text });
  }
  return judgeNewRowTags({ handoverDir, path, runsDir, slug, tags, text }).andThen((judged) =>
    writeRowDoc({ handoverDir, judged, path, text }),
  );
}

/** The new row's tag write judged as if its doc already stood on the board, or the refusal its slug or tags meet. */
function judgeNewRowTags({
  handoverDir,
  path,
  runsDir,
  slug,
  tags,
  text,
}: {
  handoverDir: string;
  path: string;
  runsDir: string;
  slug: string;
  tags: TagRequest;
  text: string;
}): Result<JudgedTagWrite, string> {
  const history = historyOf({ handoverDir, runsDir, slug });
  if (history.isErr()) {
    return err(history.error);
  }
  if (history.value !== undefined) {
    return err(history.value);
  }
  const board = liveBoard({ handoverDir, slug });
  if (board.isErr()) {
    return err(board.error);
  }
  if (board.value.claim !== undefined) {
    return err(board.value.claim);
  }
  const docs = [...board.value.docs, parseHandoverDoc({ path, text })];
  return judgeTagWrite({ docs, handoverDir, request: tags, runsDir, slug }).mapErr((error) => error.message);
}

/** Create the doc with `wx`, so a row already at its path is refused rather than overwritten. */
function writeRowDoc({
  handoverDir,
  judged,
  path,
  text,
}: {
  handoverDir: string;
  judged: JudgedTagWrite | undefined;
  path: string;
  text: string;
}): Result<CreatedRow, string> {
  try {
    // A fresh home has no board directory yet, and `wx` creates the file, never its parent.
    mkdirSync(handoverDir, { recursive: true });
    writeFileSync(path, text, { encoding: "utf8", flag: "wx" });
  } catch (cause: unknown) {
    if (isRecord(cause) && cause["code"] === "EEXIST") {
      return err(`${path} already exists — pass --slug for a distinct row`);
    }
    return err(`could not write ${path}: ${String(cause)}`);
  }
  return ok({ judged, path });
}

/**
 * The slug a new row is registered under — `--slug`, else one built from the ask — or why there is none usable.
 *
 * The journal's own rule is checked before any path is built from the slug: `../x` would otherwise write the doc
 * outside the board. No live row fails it (3,492 docs measured).
 *
 * @param named what `--slug` carried, if anything
 * @param ask the ask the slug is built from when none is named
 * @returns the slug, or the usage refusal
 */
export function registerSlug({
  named,
  ask,
}: {
  named: string | undefined;
  ask: string;
}): { readonly refusal: string } | { readonly slug: string } {
  if (named === undefined) {
    return usableSlug({ slug: slugFromAsk({ ask }) });
  }
  return usableSlug({ slug: named });
}

/** The slug itself, or why no path may be built from it. */
function usableSlug({ slug }: { slug: string }): { readonly refusal: string } | { readonly slug: string } {
  if (slug.length === 0) {
    return { refusal: "could not build a slug from --ask — pass --slug" };
  }
  if (!isSafeSlug({ slug })) {
    return { refusal: `"${slug}" is not a usable slug — a plain name of letters, digits, . _ -` };
  }
  return { slug };
}
