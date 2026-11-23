/**
 * Whether the base a spawn is about to fork from is current ENOUGH for the doc being spawned — the pure half.
 *
 * ## The owner's ruling this encodes, and the line it draws
 *
 * *"Sometimes it's fine if your base is a little drifted depending on your changes — but if your change
 * depends on something in the latest main, you should be on the latest base."* Nothing can detect semantic
 * dependence, so this does not try. It states the honest proxy instead: the doc names files (its `doneWhen:`
 * probes, and the paths its prose points a reader at), the upstream changed files, and an OVERLAP between the
 * two is the case worth saying out loud. No overlap and the drift is reported as a plain count, because that
 * is the "a little drifted, and fine" case the ruling explicitly protects.
 *
 * Advisory by default for the same reason: refusing every spawn on any drift is the overkill the ruling names.
 * `--require-current-base` is the opt-in for a caller who knows their change depends on the newer base.
 *
 * ## Not the same thing as `cli/commands/github/baseFreshnessCore.ts`
 *
 * That module measures a PULL REQUEST's head against the remote default branch tip, to stop a diff being
 * reviewed against a base that has since advanced. This one measures the MAIN CHECKOUT a worktree is about to
 * be forked from, before any code exists. Same word, different subject, deliberately separate files.
 *
 * Pure: the counts and paths a caller could only get by running git are passed in already-read.
 */
import type { Probe } from "../handover/probe.js";

/** How a spawn's base stands, and which of the doc's own files the drift actually touches. */
export interface SpawnBaseAssessment {
  /** Commits the upstream carries that the main checkout does not. */
  readonly behind: number;
  /** The doc-named paths the upstream's newer commits also changed — the "your change depends on it" case. */
  readonly overlapping: readonly string[];
  /** How many paths the doc named at all, so an empty overlap is readable as evidence rather than silence. */
  readonly docPathCount: number;
}

/**
 * The repo-relative paths one handover doc names — its `doneWhen:` probe targets plus every backtick-quoted
 * path in its prose.
 *
 * Prose is included because a doc's `Context` section is where it names the files the work actually reads,
 * and those are as much a dependency as a probe target. The extraction is deliberately conservative: a
 * backticked token counts only when it contains a `/` and no whitespace, and never when it is absolute or
 * home-relative, so a shell one-liner or a bare identifier is not mistaken for a path.
 *
 * @param probes the doc's `doneWhen:` probes
 * @param docText the doc's full markdown text
 * @returns the deduplicated paths, in first-seen order
 */
export function docReferencedPaths({
  probes,
  docText,
}: {
  probes: readonly Probe[];
  docText: string;
}): readonly string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = ({ path }: { path: string }): void => {
    if (!seen.has(path)) {
      seen.add(path);
      found.push(path);
    }
  };
  for (const probe of probes) {
    if (probe.kind === "path") {
      add({ path: probe.path });
    } else if (probe.kind === "present" || probe.kind === "absent") {
      add({ path: probe.file });
    }
  }
  for (const match of docText.matchAll(/`([^`\n]{1,200})`/gu)) {
    const token = match[1];
    if (token !== undefined && isRepoRelativePath({ token })) {
      add({ path: token });
    }
  }
  return found;
}

/** Whether one backticked token reads as a repo-relative path rather than a command, flag or identifier. */
function isRepoRelativePath({ token }: { token: string }): boolean {
  return (
    !/[\s`]/u.test(token) &&
    token.includes("/") &&
    !token.startsWith("/") &&
    !token.startsWith("~") &&
    !token.startsWith("-") &&
    !token.includes("://")
  );
}

/**
 * Whether a changed path and a doc-named path refer to the same work — equal, or one a directory prefix of
 * the other, compared on whole segments so `src/cmux` never matches `src/cmuxOther`.
 *
 * @param changed one path the upstream changed
 * @param docPath one path the doc named
 * @returns true when the two overlap
 */
export function pathsOverlap({ changed, docPath }: { changed: string; docPath: string }): boolean {
  const a = changed.replace(/\/+$/u, "");
  const b = docPath.replace(/\/+$/u, "");
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

/**
 * Assess one spawn's base: how far behind it is, and which doc-named paths the newer commits touched.
 *
 * @param behind commits the upstream carries that the main checkout does not
 * @param changedPaths the paths those commits changed
 * @param docPaths the paths the doc names (see {@link docReferencedPaths})
 * @returns the assessment
 */
export function assessSpawnBase({
  behind,
  changedPaths,
  docPaths,
}: {
  behind: number;
  changedPaths: readonly string[];
  docPaths: readonly string[];
}): SpawnBaseAssessment {
  const overlapping = changedPaths.filter((changed) => docPaths.some((docPath) => pathsOverlap({ changed, docPath })));
  return { behind, docPathCount: docPaths.length, overlapping: [...new Set(overlapping)] };
}

/** The flag that turns this module's advisory into a refusal. Named once so the prose and the parser agree. */
export const REQUIRE_CURRENT_BASE_FLAG = "--require-current-base";

/**
 * The advisory lines for one assessment — what a spawn prints before it opens anything.
 *
 * @param assessment the measured base
 * @param branch the main checkout's branch
 * @param upstream the ref it was compared against
 * @param requireCurrentBase whether the caller already passed the flag — suppresses the line offering it,
 *   which would otherwise recommend a flag that is already on
 * @returns the lines to print, empty when the base is current
 */
export function spawnBaseLines({
  assessment,
  branch,
  upstream,
  requireCurrentBase,
}: {
  assessment: SpawnBaseAssessment;
  branch: string;
  upstream: string;
  requireCurrentBase: boolean;
}): readonly string[] {
  if (assessment.behind === 0) {
    return [`base: ${branch} is current with ${upstream}`];
  }
  const head = `base: ${branch} is ${String(assessment.behind)} commit(s) behind ${upstream}`;
  if (assessment.overlapping.length === 0) {
    return [
      head,
      `  none of the ${String(assessment.docPathCount)} path(s) this doc names changed upstream — drift looks harmless, forking anyway`,
    ];
  }
  return [
    head,
    `  and it changed ${String(assessment.overlapping.length)} path(s) this doc names:`,
    ...assessment.overlapping.map((path) => `    ${path}`),
    requireCurrentBase
      ? '  this is the "your change depends on the latest base" case — pull the main checkout first'
      : `  this is the "your change depends on the latest base" case — pull the main checkout first, or pass ${REQUIRE_CURRENT_BASE_FLAG} to make this a refusal`,
  ];
}

/**
 * Whether a spawn must refuse rather than proceed.
 *
 * Refuses on ANY drift under `--require-current-base`, not only on an overlap: a caller who asked for a
 * current base has already made the judgement this module deliberately declines to make, and answering that
 * ask with "close enough" would be the tool overruling them.
 *
 * @param assessment the measured base
 * @param requireCurrentBase whether the caller passed the flag
 * @returns the refusal reason, or undefined when the spawn may proceed
 */
export function spawnBaseRefusal({
  assessment,
  requireCurrentBase,
}: {
  assessment: SpawnBaseAssessment;
  requireCurrentBase: boolean;
}): string | undefined {
  if (!requireCurrentBase || assessment.behind === 0) {
    return undefined;
  }
  const overlap =
    assessment.overlapping.length === 0
      ? ""
      : ` (including ${String(assessment.overlapping.length)} path(s) this doc names)`;
  return `${REQUIRE_CURRENT_BASE_FLAG} was passed and the base is ${String(assessment.behind)} commit(s) behind${overlap} — pull the main checkout, then retry`;
}
