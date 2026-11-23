/**
 * `slopweaver handover set-workspace` — state whose work a board row is, `team` or `self`.
 *
 * ## The gap this closes
 *
 * The console's workspace selector places a board row by what the row carries as a FIELD — its stated
 * `workspace:`, its pull requests' repositories, the Slack destinations its action would send to — and never by
 * its words (`site/lib/workspacePlacement.ts`). `repo:` is not one of those fields: it is the checkout a seat
 * runs in, and every fleet session runs in Slopweaver's. MEASURED: of the 26 open rows carrying a
 * question, seven were the team's work carrying the Slopweaver checkout, and only one of them named anything else.
 * A row whose fields say nothing is a finding on every page; this verb is how a session answers it.
 *
 * ## `--respell`: the one rewrite an old spelling gets
 *
 * The home's board docs outlive a change to the workspace words, and every checkout on the machine reads them, so
 * `src/handover/workspace.ts` reads an old spelling as the role it now is. `--respell` rewrites each such line in
 * place to that role and touches nothing else on the row — its `workspaceBecause:` was a judgement about whose work
 * it is, and a change of spelling changes no judgement. A board with none left writes nothing.
 *
 * ## A judgement, so it may correct, and it says why
 *
 * Unlike `set-repo`, which only fills a gap because moving a row between checkouts could strand a run, this
 * replaces an existing value: a workspace is a classification, and a wrong one has to be fixable. `--because`
 * is required and written beside it as `workspaceBecause:`, so the row carries the reason the next reader
 * would otherwise have to guess — the whole failure this field exists to end. Setting the value a row already
 * states writes nothing. The row writes themselves are `./setWorkspaceWrite.ts`.
 */

import { slopweaverHome } from "../../../config.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { scanBoard } from "../../../handover/store.js";
import { isWorkspace, WORKSPACES, type Workspace } from "../../../handover/workspace.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { resolveHandoverDir } from "./commandSupport.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";
import { SET_WORKSPACE_USAGE } from "./setWorkspaceUsage.js";
import { respellWorkspace, type WorkspaceWrite, writeWorkspace } from "./setWorkspaceWrite.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover set-workspace` accepts. */
const SET_WORKSPACE_FLAGS = {
  boolean: ["respell"],
  string: ["workspace", "because", "dir", "home"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_SET_WORKSPACE_FLAG_NAMES: readonly string[] = [
  ...SET_WORKSPACE_FLAGS.string,
  ...SET_WORKSPACE_FLAGS.boolean,
]
  .map((name) => `--${name}`)
  .toSorted();

/**
 * Parse `handover set-workspace`'s own flags — exported for the help-truth ratchet. Positionals are the slugs.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverSetWorkspaceArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: SET_WORKSPACE_FLAGS });
}

/** One slug's outcome, with the path when the slug named exactly one row. */
function setOne({
  docs,
  slug,
  workspace,
  because,
}: {
  docs: readonly HandoverDoc[];
  slug: string;
  workspace: Workspace;
  because: string;
}): { readonly path: string; readonly write: WorkspaceWrite } | { readonly problems: readonly string[] } {
  const claimed = docs.filter((doc) => doc.slug === slug);
  if (claimed.length !== 1) {
    const why = claimed.length === 0 ? "no row on the board claims" : `${String(claimed.length)} rows claim`;
    return { problems: [`${why} the slug "${slug}"`] };
  }
  const doc = claimed[0]!;
  return { path: doc.path, write: writeWorkspace({ because, doc, workspace }) };
}

/** Print a usage-level refusal with the verb's own help, and hand back the exit code. */
function usageRefused({ problems }: { problems: readonly string[] }): number {
  problems.forEach((problem) => {
    logger.error({ msg: `handover set-workspace: ${problem}` });
  });
  logger.error({ msg: SET_WORKSPACE_USAGE });
  return EXIT_USAGE;
}

/**
 * The line a written row prints: what it states now, and what it stated before.
 *
 * @returns the line
 */
function writtenLine({
  slug,
  workspace,
  from,
}: {
  slug: string;
  workspace: Workspace;
  from: string | undefined;
}): string {
  if (from === undefined) {
    return `handover set-workspace: ${slug} now states workspace: ${workspace}`;
  }
  return `handover set-workspace: ${slug} now states workspace: ${workspace} (was ${from})`;
}

/**
 * Say why a row was not written.
 *
 * @returns always `true`: the row was not written
 */
function refused({ problems }: { problems: readonly string[] }): true {
  problems.forEach((problem) => {
    logger.error({ msg: `handover set-workspace: ${problem}` });
  });
  return true;
}

/**
 * State one named row's workspace, and say what happened to it.
 *
 * @param docs every doc on the board
 * @param home the installation home the board mirror is written under
 * @returns whether the row was NOT written — a refusal, or a mirror that failed
 */
async function applyOne({
  docs,
  slug,
  workspace,
  because,
  home,
}: {
  docs: readonly HandoverDoc[];
  slug: string;
  workspace: Workspace;
  because: string;
  home: string;
}): Promise<boolean> {
  const outcome = setOne({ because, docs, slug, workspace });
  if ("problems" in outcome) {
    return refused({ problems: outcome.problems });
  }
  const { path, write } = outcome;
  if (write.kind === "refused") {
    return refused({ problems: write.problems });
  }
  if (write.kind === "unchanged") {
    logger.out({ line: `handover set-workspace: ${slug} already states workspace: ${workspace} — nothing written` });
    return false;
  }
  logger.out({ line: writtenLine({ from: write.from, slug, workspace }) });
  return mirrorAfterWrite({ home, path, verb: "set-workspace" });
}

/**
 * The `--respell` pass: every board row whose `workspace:` line spells an old word, rewritten to the role it reads as.
 *
 * @param dir the board directory, when not the home's
 * @param home the installation home the board mirror is written under
 * @returns the process exit code — non-zero when a row was refused, a doc would not read, or an authoritative
 *   store's mirror failed
 */
async function respellBoard({ dir, home }: { dir: string | undefined; home: string }): Promise<number> {
  const scan = scanBoard({ handoverDir: resolveHandoverDir({ dir, home }) });
  if (scan.isErr()) {
    logger.error({ msg: `handover set-workspace: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  const spelt = scan.value.docs.flatMap((doc) =>
    doc.workspace !== undefined && doc.workspaceAlias !== undefined ? [{ doc, workspace: doc.workspace }] : [],
  );
  let written = 0;
  let unchanged = 0;
  let refusedRows = 0;
  // A failed mirror is printed by `mirrorAfterWrite` and fails the pass only once the store is authoritative —
  // while the file is, the rewrite stood, as with every other handover writer.
  let mirrorFatal = 0;
  for (const { doc, workspace } of spelt) {
    const write = respellWorkspace({ doc });
    if (write.kind === "refused") {
      refused({ problems: write.problems });
      refusedRows += 1;
      continue;
    }
    if (write.kind === "unchanged") {
      unchanged += 1;
      continue;
    }
    logger.out({ line: writtenLine({ from: write.from, slug: doc.slug, workspace }) });
    written += 1;
    if (await mirrorAfterWrite({ home, path: doc.path, verb: "set-workspace" })) {
      mirrorFatal += 1;
    }
  }
  for (const name of scan.value.unreadable) {
    logger.error({ msg: `handover set-workspace --respell: ${name} would not read, so it was not respelt` });
  }
  const unread = scan.value.unreadable.length;
  logger.out({
    line:
      `handover set-workspace --respell: ${String(spelt.length)} row(s) spelling an old word — ` +
      `${String(written)} rewritten, ${String(unchanged)} already respelt, ${String(refusedRows)} refused, ` +
      `${String(mirrorFatal)} failed on an authoritative store's mirror, ${String(unread)} unreadable`,
  });
  return refusedRows + mirrorFatal + unread > 0 ? EXIT_ERROR : EXIT_OK;
}

/** `--respell`, refused before touching the board when a slug, `--workspace` or `--because` rides beside it. */
async function runRespell({
  because,
  dir,
  home,
  positionals,
  workspace,
}: {
  because: unknown;
  dir: string | undefined;
  home: string;
  positionals: readonly string[];
  workspace: unknown;
}): Promise<number> {
  if (positionals.length > 0 || workspace !== undefined || because !== undefined) {
    return usageRefused({
      problems: ["--respell names no row, workspace or reason: it rewrites every old spelling"],
    });
  }
  return respellBoard({ dir, home });
}

/**
 * State the named rows' workspace.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero when any named row was not written
 */
export async function runHandoverSetWorkspace(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: SET_WORKSPACE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverSetWorkspaceArgs({ rest });
  if (parsed.isErr()) {
    return usageRefused({ problems: parsed.error });
  }
  const { positionals, values } = parsed.value;
  const home = typeof values["home"] === "string" ? values["home"] : slopweaverHome();
  const dir = typeof values["dir"] === "string" ? values["dir"] : undefined;
  if (values["respell"] === true) {
    return runRespell({ because: values["because"], dir, home, positionals, workspace: values["workspace"] });
  }
  const requested = values["workspace"];
  const because = typeof values["because"] === "string" ? values["because"].trim() : "";
  if (positionals.length === 0) {
    return usageRefused({ problems: ["which row? Pass at least one slug"] });
  }
  if (!isWorkspace(requested)) {
    return usageRefused({ problems: [`--workspace must be one of ${WORKSPACES.join("|")}`] });
  }
  if (because.length === 0) {
    return usageRefused({ problems: ["--because is required: the row carries why it is this workspace's"] });
  }
  const scan = scanBoard({ handoverDir: resolveHandoverDir({ dir, home }) });
  if (scan.isErr()) {
    logger.error({ msg: `handover set-workspace: ${scan.error.message}` });
    return EXIT_ERROR;
  }
  let failed = false;
  for (const slug of positionals) {
    failed = (await applyOne({ because, docs: scan.value.docs, home, slug, workspace: requested })) || failed;
  }
  return failed ? EXIT_ERROR : EXIT_OK;
}

export const handoverSetWorkspaceCommand = defineCommand({ run: runHandoverSetWorkspace });
