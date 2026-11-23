/**
 * `slopweaver handover check` — verify ONE orchestration doc before the board ever sees it.
 *
 * Split out of `./run.ts` under the file-size ratchet. The two verbs shared a file and
 * nothing else: `list` reads every doc and prints a board, `check` reads one doc and prints its findings,
 * and the only code they genuinely share is the flag and directory helpers now in `./commandSupport.ts`.
 *
 * Exits non-zero on any finding, unlike `list` — this one IS the gate the authoring workflow runs.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { archivedDependencies } from "../../../handover/assemble.js";
import {
  ALLOW_STRUCTURAL_PROBE,
  behaviouralProbeBlocks,
  behaviouralProbeGap,
  behaviouralProbeMode,
  describeBehaviouralProbeGap,
} from "../../../handover/behaviouralProbe.js";
import { checkHandoverDoc, checkHandoverFrontMatter, resolveCheckRepo } from "../../../handover/check.js";
import { type HandoverDoc, parseHandoverDoc } from "../../../handover/doc.js";
import { scanBoard } from "../../../handover/store.js";
import { summaryCapOffence } from "../../../handover/summaryCap.js";
import { workingTreeFilesOf } from "../../../lib/gitRepo.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { boolFlag, flagNamesOf, resolveHandoverDir, stringFlag, VERB_ARG_OFFSET } from "./commandSupport.js";

/**
 * The flags `handover check` accepts. `--doc` is the file to verify; `--repo` OVERRIDES what paths resolve
 * against — the doc's own `repo:` is what is used absent that, per {@link resolveCheckRepo}.
 */
const CHECK_FLAGS: FlagSpec = { boolean: ["require-status-summary"], string: ["doc", "repo", "dir", "home"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_CHECK_FLAG_NAMES: readonly string[] = flagNamesOf({ spec: CHECK_FLAGS });

const CHECK_USAGE =
  "usage: slopweaver handover check --doc <path> [--repo <dir>] [--dir <path>] [--home <dir>] " +
  "[--require-status-summary]\n" +
  "\n" +
  "Verifies one orchestration doc: every file it references is committed, it states no stale counts,\n" +
  "and its blockedBy names docs that exist. Exits non-zero on any finding.\n" +
  "\n" +
  "File references resolve against the doc's own `repo:`; --repo overrides it, and a doc naming\n" +
  "neither falls back to the current checkout. Refuses when the resolved repo does not exist on disk.\n" +
  "\n" +
  "--require-status-summary  also fail when `statusSummary:` is missing or blank. Opt-in, and meant for\n" +
  "                          the authoring workflow to run in the SAME action as creating a doc or\n" +
  "                          changing its status: existing untouched docs are never retroactively\n" +
  "                          required to carry one, since nothing here can tell a new doc from an old\n" +
  "                          one by content alone.";

/**
 * Parse `handover check` flags. Exported so the ratchet probes the real parser.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags — exported so the help-truth ratchet asserts against the REAL parser rather
 *   than against a copy of it that could drift
 */
export function parseHandoverCheckArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: CHECK_FLAGS });
}

export const handoverCheckCommand = defineCommand({ run: runHandoverCheck });

/**
 * Every slug `blockedBy` may legitimately name — a live board doc, OR one already archived.
 *
 * `handover list` resolves a dependency the same way, by handing `composeBoardModels` its own
 * `[...docs, ...archivedDependencies(...)]` as `resolutionDocs`; `check` used to ask only about live docs,
 * so it reported a real, archived prerequisite as `which no doc on the board claims` — the exact false
 * positive a typo produces, on a doc that was never a typo. `archivedDependencies` being the one answer
 * both reach is what keeps the two verbs from disagreeing about the same slug again.
 *
 * @param docs every live (unarchived) doc the board scan found
 * @param handoverDir the top-level handovers directory, whose `archive/` sibling this also resolves against
 * @returns every slug `blockedBy` may name without being flagged as unknown
 */
function knownDependencySlugs({
  docs,
  handoverDir,
}: {
  docs: readonly HandoverDoc[];
  handoverDir: string;
}): ReadonlySet<string> {
  return new Set([
    ...docs.map((doc) => doc.slug),
    ...archivedDependencies({ docs, handoverDir }).map((doc) => doc.slug),
  ]);
}

/**
 * Verify one orchestration doc.
 *
 * @param argv the full process argv
 * @returns the process exit code — non-zero when the doc has any finding
 */
export async function runHandoverCheck(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: CHECK_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverCheckArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: CHECK_USAGE });
    return EXIT_USAGE;
  }
  const docPath = stringFlag({ name: "doc", parsed: parsed.value });
  if (docPath === undefined) {
    logger.error({ msg: "handover check: --doc is required" });
    logger.error({ msg: CHECK_USAGE });
    return EXIT_USAGE;
  }
  return reportCheck({
    dir: stringFlag({ name: "dir", parsed: parsed.value }),
    docPath,
    home: stringFlag({ name: "home", parsed: parsed.value }),
    repoFlag: stringFlag({ name: "repo", parsed: parsed.value }),
    requireStatusSummary: boolFlag({ name: "require-status-summary", parsed: parsed.value }),
  });
}

/**
 * Resolve which repository a doc's file references check against, refusing when the resolved root does not
 * exist on disk and announcing which input was trusted either way.
 *
 * Split out of {@link reportCheck} to keep that function decomposed: this piece owns the repo-or-refuse
 * decision, that one owns running the checks over whatever root survives it.
 *
 * @param docRepo the doc's own `repo:` front-matter field
 * @param repoFlag the `--repo` flag, when the caller passed one
 * @returns the resolved repository root, or `undefined` when it does not exist on disk — the refusal is
 *   already printed, so the caller need only stop
 */
function resolvedCheckRoot({
  docRepo,
  repoFlag,
}: {
  docRepo: string | undefined;
  repoFlag: string | undefined;
}): string | undefined {
  const resolution = resolveCheckRepo({ docRepo, fallback: process.cwd(), repoFlag });
  // Explicit only — a doc naming no repo at all falls back to the caller's own checkout, which always
  // exists, so there is nothing to refuse. A `--repo` or a doc `repo:` that names a path with nothing on
  // disk is the author's mistake, and checking it against the wrong tree is worse than refusing outright.
  if (resolution.source !== "fallback" && !existsSync(resolution.repo)) {
    logger.error({
      msg: `handover check: ${resolution.source === "flag" ? "--repo" : "repo:"} names ${resolution.repo}, which does not exist on disk`,
    });
    return undefined;
  }
  // Printed unconditionally, pass or fail — the whole point is that the NEXT false positive is diagnosable
  // without re-deriving which root was chosen.
  logger.error({
    msg: `handover check: resolving file references against ${resolution.repo} (from ${resolution.source})`,
  });
  return resolution.repo;
}

/**
 * Every per-line finding for one doc — front-matter plus body — rendered as the strings `reportCheck` prints.
 *
 * @param doc the parsed doc
 * @param text the doc's raw text, for the body check
 * @param repo the repository the doc's file references resolve against
 * @param requireStatusSummary passed straight through to {@link checkHandoverFrontMatter}
 * @param known every slug the board already claims, for the `blockedBy` check
 * @returns each finding, front-matter first, already indented for printing
 */
function findingsFor({
  doc,
  text,
  repo,
  requireStatusSummary,
  known,
}: {
  doc: HandoverDoc;
  text: string;
  repo: string;
  requireStatusSummary: boolean;
  known: ReadonlySet<string>;
}): readonly string[] {
  return [
    ...checkHandoverFrontMatter({
      artifact: doc.artifact,
      problems: doc.problems,
      requireStatusSummary,
      status: doc.status,
      statusSummary: doc.statusSummary,
      unknownDependencies: doc.blockedBy.filter((slug) => !known.has(slug)),
    }).map((finding) => `  ${finding.message}`),
    ...checkHandoverDoc({
      configPathExists: configPathExistsIn({ repo }),
      resolves: resolverFor({ repo }),
      text,
    }).map((finding) => `  line ${String(finding.line)}: ${finding.message}`),
    ...summaryCapLines({ doc, text }),
  ];
}

/**
 * The `summary:` size finding for one doc, as the line `reportCheck` prints.
 *
 * A separate helper rather than a rule inside {@link checkHandoverDoc} because that function is line-oriented
 * and reads raw text, while this cap is measured against the PARSED scalar — the field is a YAML value whose
 * size has nothing to do with how many lines it is written across, which is the whole reason the existing
 * line-counting gate could not see this class.
 *
 * @param doc the parsed doc, for its `summary:`
 * @param text the doc's raw text, for the key's line number
 * @returns the one finding, or nothing when the summary is absent or within the cap
 */
function summaryCapLines({ doc, text }: { doc: HandoverDoc; text: string }): readonly string[] {
  const offence = summaryCapOffence({ docPath: doc.path, summary: doc.summary, text });
  return offence === undefined ? [] : [`  line ${String(offence.line)}: ${offence.message}`];
}

/** Read the doc and the board, run every check, print the findings. */
function reportCheck({
  docPath,
  repoFlag,
  dir,
  home,
  requireStatusSummary,
}: {
  docPath: string;
  repoFlag: string | undefined;
  dir: string | undefined;
  home: string | undefined;
  requireStatusSummary: boolean;
}): number {
  let text: string;
  try {
    text = readFileSync(docPath, "utf8");
  } catch {
    logger.error({ msg: `handover check: cannot read ${docPath}` });
    return EXIT_ERROR;
  }
  const doc = parseHandoverDoc({ path: docPath, text });
  const repo = resolvedCheckRoot({ docRepo: doc.repo, repoFlag });
  if (repo === undefined) {
    return EXIT_ERROR;
  }
  const handoverDir = resolveHandoverDir({ dir, home });
  const scan = scanBoard({ handoverDir });
  const known = knownDependencySlugs({ docs: scan.isOk() ? scan.value.docs : [], handoverDir });
  const behavioural = behaviouralProbeLines({ doc });
  const perLine = findingsFor({ doc, known, repo, requireStatusSummary, text });
  const blocking = behavioural.blocking && behavioural.lines.length > 0;
  // An advisory prints whether or not anything else did, and never decides the exit code — that is the whole
  // difference between the two modes, and it must not also change what the reader is told.
  if (!behavioural.blocking) {
    behavioural.lines.forEach((line) => {
      logger.error({ msg: line });
    });
  }
  // The behavioural gap is ONE finding however many lines it takes to explain — a header reading "10
  // finding(s)" for a single defect teaches the reader to stop believing the number.
  const count = perLine.length + (blocking ? 1 : 0);
  if (count === 0) {
    logger.out({ line: `handover check: ${doc.slug} is sound` });
    return EXIT_OK;
  }
  logger.error({ msg: `handover check: ${String(count)} finding(s) in ${doc.slug}` });
  [...perLine, ...(blocking ? behavioural.lines : [])].forEach((finding) => {
    logger.error({ msg: finding });
  });
  return EXIT_ERROR;
}

/**
 * The behavioural-probe rule as `check` findings — the same gate `handover lint` and `handover finish` apply,
 * read here for one doc so its author sees it before the board does. See
 * {@link ../../../handover/behaviouralProbe} for the rule and the audit behind it.
 *
 * Scoped to `status: done`, exactly as in `lint`: a doc still in flight is not being refused anything yet.
 *
 * @param doc the parsed doc
 * @returns the lines to print, and whether they count toward the exit code — `false` under the advise mode,
 *   which is the only thing that mode changes
 */
function behaviouralProbeLines({ doc }: { doc: HandoverDoc }): {
  readonly lines: readonly string[];
  readonly blocking: boolean;
} {
  const mode = behaviouralProbeMode({ env: process.env });
  if (process.env[ALLOW_STRUCTURAL_PROBE] === "1" || doc.status !== "done") {
    return { blocking: true, lines: [] };
  }
  const gap = behaviouralProbeGap({
    doneWhen: doc.doneWhen,
    kind: doc.kind,
    probeWaiver: doc.probeWaiver,
    summary: doc.summary,
  });
  if (gap === undefined) {
    return { blocking: true, lines: [] };
  }
  return {
    blocking: behaviouralProbeBlocks({ gap, mode }),
    lines: describeBehaviouralProbeGap({ gap, mode, slug: doc.slug, verb: "handover check" }).map(
      (line) => `  ${line}`,
    ),
  };
}

/**
 * A resolver over the repository's tracked files, built once.
 *
 * Accepts an exact repo-relative path OR a bare basename, because a doc legitimately says "follow
 * `controlBytes.ts`" without spelling the directory and refusing that would train authors to stop running the
 * check. What it will not accept is a name that exists nowhere.
 *
 * One `git ls-files` for the whole doc rather than a subprocess per token — and it goes through
 * `workingTreeFilesOf`, which is already the sanctioned read-only seam, so this adds no new one.
 *
 * @param repo the repository paths resolve against
 * @returns a predicate over file-shaped tokens
 */
function resolverFor({ repo }: { repo: string }): (args: { token: string }) => boolean {
  let tracked: readonly string[];
  try {
    tracked = workingTreeFilesOf({ root: repo });
  } catch {
    // Not a checkout, or git refused. Every reference then reports as unresolved, which is loud and wrong in
    // the safe direction — the alternative is passing a doc nobody actually checked.
    tracked = [];
  }
  const exact = new Set(tracked);
  const byName = new Set(tracked.map((path) => path.slice(path.lastIndexOf("/") + 1)));
  return ({ token }) => exact.has(token) || byName.has(token);
}

/**
 * Whether a `--config` path a `command:` probe names exists on disk, relative to the doc's own repo.
 *
 * A real filesystem read rather than {@link resolverFor}'s git-tracked list: a config a probe names is
 * something the command itself resolves via the OS, not via git, so a working-tree file that has not been
 * committed yet still counts.
 *
 * @param repo the repository the path resolves against
 * @returns a predicate over `--config` path tokens
 */
function configPathExistsIn({ repo }: { repo: string }): (args: { path: string }) => boolean {
  return ({ path }) => existsSync(join(repo, path));
}
