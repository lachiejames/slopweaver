/**
 * `slopweaver handover set-repo` — give a board row that names no `repo:` the checkout a seat opens in.
 *
 * ## The gap this closes
 *
 * `cmux spawn` cuts a worktree from a row's `repo:` and refuses a row without one — *"names no `repo:`, so
 * there is nowhere to open a worktree in"* (`../cmux/spawnPreflight.ts`). `handover register` keeps `--repo`
 * optional, and several registrars omit it, so a row could reach the board that no verb could ever seat and
 * no verb could repair: `handover amend` journals an amendment on an open RUN and has no `--repo`. MEASURED:
 * 253 of the 458 ask rows the reconciliation offered as ready named no repo, and a fill spawned four
 * of them straight into that refusal. The reconciliation now holds such a row rather than offering it
 * (`../../../handover/rowStanding.ts`); this verb is the way back to ready.
 *
 * ## Add-only, and only the top of a main checkout
 *
 * It FILLS a missing `repo:` and refuses a row that already names one, through
 * `../../../handover/frontmatter.ts`'s `addFrontMatterFields`. Moving a row between repositories is a
 * different act — a run may already be open in a worktree of the first one — and a verb that quietly did it
 * would be the silent overwrite that helper exists to refuse.
 *
 * The value is a main checkout's top, by path, by a declared checkout's `owner/name` or by its bare repository
 * name. `../../../handover/repoCheckout.ts` is the judge, shared with `handover register`, and carries why a
 * subdirectory, a linked worktree and an undeclared name are all refused.
 */

import { readFileSync } from "node:fs";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { slopweaverHome } from "../../../config.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { addFrontMatterFields, frontMatterErrorLines } from "../../../handover/frontmatter.js";
import { resolveRepoCheckout } from "../../../handover/repoCheckout.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { type BoardRowLockOptions, withBoardRowLock } from "./boardRowLock.js";
import { resolveHandoverDir } from "./commandSupport.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover set-repo` accepts. */
const SET_REPO_FLAGS = { boolean: [], string: ["repo", "dir", "home"] } satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_SET_REPO_FLAG_NAMES: readonly string[] = [...SET_REPO_FLAGS.string, ...SET_REPO_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `handover set-repo`'s own flags — exported for the help-truth ratchet. Positionals are the slugs.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverSetRepoArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: SET_REPO_FLAGS });
}

export const SET_REPO_USAGE =
  "usage: slopweaver handover set-repo <slug> [<slug> ...] --repo <path|owner/name|name> [--dir <path>] [--home <dir>]\n" +
  "\n" +
  "Gives a board row that names no `repo:` the checkout `cmux spawn` opens its worktree in. Until it has\n" +
  "one, the reconciliation holds the row rather than offering it as ready.\n" +
  "\n" +
  "  --repo   the top of a main git checkout (never a linked worktree), or a declared checkout's owner/name\n" +
  "           or bare repository name — a name is never read as a directory; ./name is one relative to here\n" +
  "\n" +
  "Add-only: a row that already names a repo is refused, never moved.\n" +
  "\n" +
  "example: slopweaver handover set-repo a-finding-row --repo ~/dev/personal/slopweaver";

/**
 * Why this row may not be given a repo, or `undefined` when it may.
 *
 * @param doc the row, as the board scan read it
 * @returns the refusal sentence, or `undefined`
 */
export function setRepoRefusal({ doc }: { doc: HandoverDoc }): string | undefined {
  if (doc.problems.length > 0) {
    return `${doc.slug} does not parse cleanly, so nothing may be written to it: ${doc.problems[0]!}`;
  }
  if (doc.repo !== undefined) {
    return `${doc.slug} already names repo: ${doc.repo} — set-repo fills a missing one and never moves a row`;
  }
  return undefined;
}

/**
 * Write `repo:` into one row, or say what stopped it. The file is re-judged as it reads NOW, not as the
 * board scan saw it: another writer may have replaced it, or given it a repo, in between. The read, judgement and
 * atomic write all happen inside the row's one lock (`./boardRowLock.ts`), so no other row edit is written over.
 *
 * @param doc the row as the board scan read it
 * @param repo the checkout top to write
 * @param rowLock how the write waits on the row's lock when another writer holds it
 * @returns every reason nothing was written — empty when the row now names `repo`
 */
export function writeRepo({
  doc,
  repo,
  rowLock,
}: {
  doc: HandoverDoc;
  repo: string;
  rowLock?: BoardRowLockOptions;
}): readonly string[] {
  const locked = withBoardRowLock({
    ...rowLock,
    path: doc.path,
    write: ({ target }) => writeRepoAt({ doc, repo, target }),
  });
  if (locked.isErr()) {
    return [locked.error.message];
  }
  return locked.value;
}

/** {@link writeRepo}'s read, judgement and write, run under the row's lock on the real file `target`. */
function writeRepoAt({ doc, repo, target }: { doc: HandoverDoc; repo: string; target: string }): readonly string[] {
  let text: string;
  try {
    text = readFileSync(target, "utf8");
  } catch (cause: unknown) {
    return [`cannot read ${doc.path}: ${String(cause)}`];
  }
  const current = parseHandoverDoc({ path: doc.path, text });
  if (current.slug !== doc.slug) {
    return [`${doc.path} now holds the row "${current.slug}", not "${doc.slug}" — nothing was written`];
  }
  const refusal = setRepoRefusal({ doc: current });
  if (refusal !== undefined) {
    return [refusal];
  }
  const edited = addFrontMatterFields({ fields: [{ key: "repo", value: repo }], path: doc.path, text });
  if (edited.isErr()) {
    return frontMatterErrorLines({ error: edited.error });
  }
  try {
    writeFileAtomic({ contents: edited.value, path: target });
  } catch (cause: unknown) {
    return [`could not write ${doc.path}: ${String(cause)}`];
  }
  return [];
}

/** One slug's outcome: the path written, or every reason it was not. */
function setOne({
  docs,
  slug,
  repo,
}: {
  docs: readonly HandoverDoc[];
  slug: string;
  repo: string;
}): { readonly path: string } | { readonly problems: readonly string[] } {
  const claimed = docs.filter((doc) => doc.slug === slug);
  if (claimed.length !== 1) {
    const why = claimed.length === 0 ? "no row on the board claims" : `${String(claimed.length)} rows claim`;
    return { problems: [`${why} the slug "${slug}"`] };
  }
  const doc = claimed[0]!;
  const refusal = setRepoRefusal({ doc });
  if (refusal !== undefined) {
    return { problems: [refusal] };
  }
  const problems = writeRepo({ doc, repo });
  return problems.length > 0 ? { problems } : { path: doc.path };
}

/** Print a usage-level refusal with the verb's own help, and hand back the exit code. */
function usageRefused({ problems }: { problems: readonly string[] }): number {
  problems.forEach((problem) => {
    logger.error({ msg: `handover set-repo: ${problem}` });
  });
  logger.error({ msg: SET_REPO_USAGE });
  return EXIT_USAGE;
}

/**
 * Give each named row the checkout `--repo` names.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero when any named row was not written
 */
export async function runHandoverSetRepo(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: SET_REPO_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverSetRepoArgs({ rest });
  if (parsed.isErr()) {
    return usageRefused({ problems: parsed.error });
  }
  const { positionals, values } = parsed.value;
  const requested = typeof values["repo"] === "string" ? values["repo"] : "";
  if (positionals.length === 0 || requested.trim().length === 0) {
    return usageRefused({ problems: ["which row, and which checkout? Pass at least one slug and --repo"] });
  }
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  const checkout = resolveRepoCheckout({ home, requested });
  if (checkout.isErr()) {
    return usageRefused({ problems: [checkout.error.message] });
  }
  const scan = scanBoard({
    handoverDir: resolveHandoverDir({ dir: typeof values["dir"] === "string" ? values["dir"] : undefined, home }),
  });
  if (scan.isErr()) {
    logger.error({ msg: `handover set-repo: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  let failed = false;
  for (const slug of positionals) {
    const outcome = setOne({ docs: scan.value.docs, repo: checkout.value, slug });
    if ("problems" in outcome) {
      failed = true;
      outcome.problems.forEach((problem) => {
        logger.error({ msg: `handover set-repo: ${problem}` });
      });
      continue;
    }
    logger.out({ line: `handover set-repo: ${slug} now names repo: ${checkout.value}` });
    failed = (await mirrorAfterWrite({ home, path: outcome.path, verb: "set-repo" })) || failed;
  }
  return failed ? EXIT_ERROR : EXIT_OK;
}

export const handoverSetRepoCommand = defineCommand({ run: runHandoverSetRepo });
