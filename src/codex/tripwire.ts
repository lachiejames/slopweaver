/**
 * Deciding, WHILE a pass runs, whether it has gone hunting.
 *
 * The failure this exists for: a pass pointed at the wrong workspace reads the wrong thing, fails, and then
 * fans out across the machine looking for what the document promised. It used to cost the whole bound —
 * thirty or forty minutes — and the result was discarded. The signal is visible in the first thirty seconds.
 *
 * Two honest limits shape everything here:
 *
 *  1. **`command` is a raw shell line, not a path.** Pulling paths out of it is a heuristic and always will
 *     be. So the path signal only ever contributes to a *suspicion*; it never aborts on its own.
 *  2. **A non-zero exit is a fact.** A burst of failing commands early in a pass is what "looking for
 *     something that is not there" actually looks like, and it needs no parsing to detect. That is the
 *     signal an abort is allowed to rest on.
 *  3. **A heuristic that is WRONG is worse than no heuristic.** Added after measuring the recorded history:
 *     24 `off-track` aborts, 23 of them fired by the sweep signature, and 19 of the 24 rested on evidence
 *     that was not a sweep at all — a relative path misread as an absolute one, or the agent's own memory
 *     file. See {@link ABSOLUTE_PATH_TOKEN} and {@link isAgentOwnState}. The cost of a false abort is the
 *     whole point: it throws away a pass that was doing exactly the right thing, roughly thirty seconds in,
 *     and records the reason as the pass's fault.
 *
 * Pure: no clock, no filesystem. The caller supplies elapsed time so this stays testable.
 */

import type { CodexActivity } from "./progress.js";

/** How long the early window lasts. A pass that is misrouted shows it almost immediately. */
export const EARLY_WINDOW_MS = 60_000;

/** Failing commands inside the early window that trip an abort. */
const EARLY_FAILURE_ABORT = 3;

/**
 * Commands sweeping outside BOTH the workspace and the repository that trip an abort.
 *
 * Two, not one, because a single outside read is ordinary — a global git config, a shared rules file. Two is
 * a search. Measured against a real misrouted pass: it swept `~/dev` and then `/private/tmp` within 31
 * seconds, having already missed once, which is precisely the shape this catches.
 */
const OUTSIDE_SWEEP_ABORT = 2;

/**
 * Commands reading OTHER passes' orchestration directories that trip an abort, at any time.
 *
 * Two, so a single stray path in a command line cannot fire it.
 *
 * This is the one signal with no early-window limit, because unlike a failed grep it has no innocent
 * reading. A pass reviewing a repository has no reason to read another pass's artifacts; there is nothing
 * there but previous verdicts. It is what "lost the plot" looks like from outside, and it is the signature
 * the measured 17-minute FATAL sweep produced — 150 commands, only 11 failures, drifting into
 * `find $SLOPWEAVER_HOME/orchestration/...` while succeeding at every step.
 */
const ORCHESTRATION_PRY_ABORT = 2;

/** What the assessment concluded. */
type TripwireVerdict = "ok" | "suspect" | "abort";

/** The assessment, with the reasons stated so an abort can explain itself. */
export interface TripwireAssessment {
  readonly verdict: TripwireVerdict;
  readonly reasons: readonly string[];
}

/**
 * The observations, in the words the abort will explain itself with. Pure and separate so the decision
 * sequence below stays one readable branch rather than interleaving prose with policy.
 */
function observedReasons({
  commands,
  elapsedMs,
  failedCommands,
  pried,
  sweeps,
}: {
  commands: number;
  elapsedMs: number;
  failedCommands: number;
  pried: readonly string[];
  sweeps: readonly string[];
}): readonly string[] {
  const seconds = String(Math.round(elapsedMs / 1000));
  const reasons: string[] = [];
  if (failedCommands > 0) {
    reasons.push(`${String(failedCommands)} of ${String(commands)} commands failed in the first ${seconds}s`);
  }
  if (sweeps.length > 0) {
    reasons.push(
      `${String(sweeps.length)} command(s) searched outside the workspace and the repo: ${sweeps.join(", ")}`,
    );
  }
  if (pried.length > 0) {
    reasons.push(`${String(pried.length)} command(s) read other passes' artifacts: ${pried.join(", ")}`);
  }
  return reasons;
}

/**
 * Judge whether a running pass has gone off course badly enough to abort.
 *
 * @param activity what the pass has done so far
 * @param elapsedMs how long it has been running
 * @param workspaceRoot the scratch directory the pass may write to
 * @param repoRoot the repository it was pointed at — reads here are the whole job, never suspicious
 * @returns the assessment; a single signal never aborts on its own, since every one of them is a heuristic
 */
export function assessPassActivity({
  activity,
  elapsedMs,
  workspaceRoot,
  repoRoot,
}: {
  activity: CodexActivity;
  elapsedMs: number;
  /** The scratch directory the pass may write to. */
  workspaceRoot: string;
  /** The repository it was pointed at. Reads here are the whole job. */
  repoRoot: string;
}): TripwireAssessment {
  const early = elapsedMs <= EARLY_WINDOW_MS;
  const { commands, failedCommands } = activity;
  const sweeps = outsideSweeps({ commands: activity.recentCommands, repoRoot, workspaceRoot });
  const pried = orchestrationPries({ commands: activity.recentCommands, workspaceRoot });
  if (failedCommands === 0 && sweeps.length === 0 && pried.length === 0) {
    return { reasons: [], verdict: "ok" };
  }
  const reasons = observedReasons({ commands, elapsedMs, failedCommands, pried, sweeps });
  // Checked BEFORE the early-window bail, and NOT gated on a failure. Both of those are the fix: the two
  // signatures below only ever fire in the first minute, because a long pass legitimately accumulates failed
  // greps and killing those would be worse than the silence it replaced. That reasoning does not apply here
  // — there is no minute at which reading another pass's verdicts becomes ordinary — and the pass this was
  // written for was SUCCEEDING every command, so anything keyed on failures was blind to it.
  if (pried.length >= ORCHESTRATION_PRY_ABORT) {
    return {
      reasons: [...reasons, "it is reading other passes' artifacts instead of the code — it has lost the task"],
      verdict: "abort",
    };
  }
  if (!early) {
    return { reasons, verdict: "suspect" };
  }
  // Two independent signatures, because one alone is not enough. A pass whose EVERY command fails is reading
  // a workspace that is not there. A pass that misses and then starts sweeping the machine is looking for
  // something the document promised and did not deliver — and that is the one that used to cost the bound.
  if (failedCommands >= EARLY_FAILURE_ABORT && failedCommands === commands) {
    return {
      reasons: [...reasons, "every command has failed — killing it now rather than at the bound"],
      verdict: "abort",
    };
  }
  if (sweeps.length >= OUTSIDE_SWEEP_ABORT && failedCommands > 0) {
    return {
      reasons: [
        ...reasons,
        "it missed and then began searching the machine — the document names something that is not there",
      ],
      verdict: "abort",
    };
  }
  return { reasons, verdict: "suspect" };
}

/**
 * Absolute-path-looking tokens in a raw shell line.
 *
 * The `(?<![^\s'"\`=(\[{,;:<>|&$])` lookbehind is the whole correction. The pattern used to be a bare
 * `/\/[A-Za-z0-9._\-/]+/g`, which matches ANY run beginning with a slash — including the tail of a perfectly
 * ordinary RELATIVE path. `rg --files -g 'src/lib/providerCall.ts'` yielded the token
 * `/lib/providerCall.ts`, which starts with a slash, is not under any root, and named a file the pass was
 * correctly reading inside the repository. Measured over the recorded history: 32 of 58 tokens that had been
 * offered as evidence of a machine-wide sweep were fragments of in-repo relative paths.
 *
 * A path must therefore START at a token boundary to be evidence. `(?!\/)` on the first character removes the
 * other degenerate class the history contains: `//`, which falls out of a `https://` literal in a search
 * pattern and names nothing. A single-segment token like `/w` is deliberately KEPT — `rg --files /w` is a
 * sweep of an entire tree and is exactly the signal this exists to catch.
 *
 * The class is `\p{L}\p{N}` rather than `A-Za-z0-9` so a path whose components are not ASCII is SEEN. An
 * unmatched path is a missed sweep, and a missed sweep is the failure direction this module chooses when it has
 * to choose — but choosing it for every non-English path was an accident rather than a decision.
 *
 * The class is still narrower than what a filesystem allows, so a token can be a TRUNCATION of a longer real
 * path. That is why {@link outsideSweeps} compares the roots at the match offset against an UNESCAPED copy of
 * the command rather than against the extracted token — see there. Three review passes over this file found
 * that one class from three directions: a `+` in the root, then a space, then a backslash-escaped space.
 */
const ABSOLUTE_PATH_TOKEN = /(?<![^\s'"`=([{,;:<>|&$])\/(?!\/)[\p{L}\p{N}._\-/]+/gu;

/**
 * The absolute paths a command reached that lie outside both roots.
 *
 * A heuristic and openly so: `command` is a raw shell line, so this scans for absolute-path-looking tokens
 * rather than parsing anything. That is exactly why it never aborts alone — it only ever confirms a failure
 * signal. Returns the first path per offending command, deduplicated, for a readable reason string.
 *
 * A PATH IS EVIDENCE ONLY IF IT LOOKS OUTSIDE UNDER EVERY SPELLING OF THE LINE, and that rule is the whole
 * design. SIX review passes over this function each broke its predecessor with a root shape it had not
 * anticipated — a `+`, a space, a backslash-escaped space, a literal backslash, a colon, then empty quote pairs
 * beside an escaped space. Every one was the same defect wearing different punctuation: a root holding any
 * character the token class excludes gets truncated or split, so an in-root read stops looking in-root, and two
 * of those plus one ordinary failed command is an abort.
 *
 * Each of the first five fixes bought exactly one shape. This one asks the question differently: run the whole
 * detection over each {@link spellingsOf} the line and keep only the tokens EVERY spelling calls outside. A
 * false positive needs all spellings to agree, which the quoting family never does; a genuine sweep looks the
 * same however it is written, so it survives. Tightening the PATTERN could never have done this — whitespace,
 * backslash, quote and colon are all legitimate path punctuation elsewhere, so excluding any of them to rescue
 * one root shape breaks every other line.
 *
 * WHAT THIS STILL CANNOT SEE, stated rather than implied: `~`, `$HOME`, a symlink, a `cd` earlier in the line,
 * or a path assembled from a variable. Each is a MISSED sweep, never a false one, and that direction is
 * deliberate — a heuristic that cannot see a path is silent, while one that misreads a path kills a pass that
 * was working. Nothing here should be read as a guarantee that a pass reading outside the roots is caught.
 *
 * `.` and `..` were on that list until review showed they did not belong on it: a redundant segment made an
 * in-root path read as an outside one, which is a false ABORT rather than a missed sweep. {@link resolveSegments}
 * folds them now.
 *
 * @param commands the raw shell lines the pass ran
 * @param workspaceRoot the scratch directory writes are allowed in
 * @param repoRoot the repository reads are expected in
 * @returns the first offending path per command, deduplicated — a heuristic that only ever CONFIRMS another
 *   failure signal, never aborts alone
 */
export function outsideSweeps({
  commands,
  workspaceRoot,
  repoRoot,
}: {
  commands: readonly string[];
  workspaceRoot: string;
  repoRoot: string;
}): readonly string[] {
  const found = new Set<string>();
  for (const command of commands) {
    const perSpelling = spellingsOf({ word: command }).map(
      (spelling) => new Set(outsideIn({ command: spelling, repoRoot, workspaceRoot })),
    );
    // The FIRST token in the line AS WRITTEN that every spelling also calls outside, so the reason string
    // quotes what the pass actually typed rather than a normalised rewrite of it.
    const first = outsideIn({ command, repoRoot, workspaceRoot }).find((token) =>
      perSpelling.every((tokens) => tokens.has(token)),
    );
    if (first !== undefined) {
      found.add(first);
    }
  }
  return [...found];
}

/**
 * Every candidate path in ONE spelling of a command that lies outside both roots.
 *
 * Split out because {@link outsideSweeps} runs it over several spellings of the same line and keeps only what
 * they all agree on. On its own this is the old, credulous test — it is the intersection that makes it safe.
 *
 * @param command one spelling of the shell line
 * @param workspaceRoot the scratch directory writes are allowed in
 * @param repoRoot the repository reads are expected in
 * @returns the outside-looking tokens, in the order they appear
 */
function outsideIn({
  command,
  workspaceRoot,
  repoRoot,
}: {
  command: string;
  workspaceRoot: string;
  repoRoot: string;
}): readonly string[] {
  const tokens: string[] = [];
  for (const match of command.matchAll(ABSOLUTE_PATH_TOKEN)) {
    const token = match[0];
    if (
      !insideRoot({ command, index: match.index, root: workspaceRoot }) &&
      !insideRoot({ command, index: match.index, root: repoRoot }) &&
      !isOrdinaryToolPath({ token }) &&
      !isAgentOwnState({ token })
    ) {
      tokens.push(token);
    }
  }
  return tokens;
}

/**
 * Every absolute-path-shaped token in one command line. A command that names no absolute path — `ls`, `rg -n x
 * src` — has no match, so it offers the orchestration-root test no token at all; a no-match is never a parse failure.
 */
function absolutePathTokens({ command }: { command: string }): readonly string[] {
  const tokens = command.match(/\/[A-Za-z0-9._\-/]+/g);
  if (tokens === null) {
    return [];
  }
  return tokens;
}

/**
 * Commands that reached into the orchestration tree outside this pass's own workspace.
 *
 * The workspace is `<orchestrationRoot>/<id>.scratch`, so the orchestration root is its parent — derived
 * rather than threaded through four call sites, which keeps the one place that knows the layout in
 * `artifactStore` and gives this module nothing new to be told.
 *
 * @param commands the command lines observed so far
 * @param workspaceRoot this pass's own scratch directory, which it may read freely
 * @returns the offending paths, deduplicated
 */
function orchestrationPries({
  commands,
  workspaceRoot,
}: {
  commands: readonly string[];
  workspaceRoot: string;
}): readonly string[] {
  const orchestrationRoot = workspaceRoot.slice(0, workspaceRoot.lastIndexOf("/"));
  if (orchestrationRoot.length === 0) {
    return [];
  }
  const found = new Set<string>();
  for (const command of commands) {
    for (const token of absolutePathTokens({ command })) {
      if (token.startsWith(orchestrationRoot) && !token.startsWith(workspaceRoot)) {
        found.add(token);
        break;
      }
    }
  }
  return [...found];
}

/**
 * Whether a candidate path token at `index` is part of a path under `root`.
 *
 * FIVE review passes over this function each broke the previous version with a root shape it had not
 * anticipated: `+`, a space, a backslash-escaped space, a literal backslash, then a colon. Every one was the
 * same defect wearing a different character, and every one of my first four fixes bought exactly one shape. So
 * the test here is deliberately not "does the token equal a root-relative path" — it is the weakest question
 * that answers all five at once, asked two ways:
 *
 *  - **Does the root START here?** Checked against the raw suffix and against the unescaped suffix, because a
 *    root containing a space is written either `'/repo root/a'` or `/repo\ root/a` and both must pass.
 *  - **Does this token START INSIDE an occurrence of the root?** This is the one that generalises. A root
 *    holding any character the token class excludes gets SPLIT, and the tail becomes a second match at a later
 *    offset — `/repo:/root/a` under root `/repo:/root` matches `/repo`, then matches `/root/a` five characters
 *    in. Asking whether the offset lands inside a literal occurrence of the root covers that without caring
 *    which character did the splitting.
 *
 * Either question answering yes means in-root. That asymmetry is the safety property: every ambiguity resolves
 * toward "inside", which costs a missed sweep rather than a killed pass. An empty root therefore disables the
 * path signal entirely — also the silent direction, and there is no legitimate caller that passes one.
 *
 * @param command the raw shell line
 * @param index where the candidate path token starts in it
 * @param root the root to test against
 * @returns whether that token is part of a path under the root
 */
function insideRoot({ command, index, root }: { command: string; index: number; root: string }): boolean {
  const resolvedRoot = resolveSegments({ path: root });
  if (
    spellingsOf({ word: command.slice(index) }).some(
      (spelling) =>
        spelling.startsWith(root) ||
        resolveSegments({ path: pathAtStart({ text: spelling }) }).startsWith(resolvedRoot),
    )
  ) {
    return true;
  }
  for (let at = command.indexOf(root); at !== -1; at = command.indexOf(root, at + 1)) {
    // `<=` on the upper bound, not `<`. A match landing exactly where the root ENDS is the root's own child —
    // `<root>` followed by `/a` is `<root>/a`. Missing that was an off-by-one with a root
    // ending in a colon, where the split put the child slash precisely on the boundary.
    if (index > at && index <= at + root.length) {
      return true;
    }
  }
  return false;
}

/**
 * The leading run of a shell word that could be a path, up to the first character that cannot continue one.
 *
 * @param text the text from the candidate path onwards
 * @returns the leading path-looking run, or an empty string
 */
function pathAtStart({ text }: { text: string }): string {
  const end = text.search(PATH_TERMINATOR);
  return end === -1 ? text : text.slice(0, end);
}

/** The first character that cannot be part of a path in a shell word. */
const PATH_TERMINATOR = /[\s'"`|&;<>()]/u;

/**
 * Resolve `.` and `..` segments, so a path written the long way still matches the root it is under.
 *
 * Review found `cat /repo/./root/a` aborting a pass whose root was `/repo/root`. `..` is folded here too,
 * for the same reason and by the same argument: this is used ONLY to make the root comparison more forgiving,
 * and resolving a `..` that climbs out of a root leaves the path outside, so a real sweep is still named.
 *
 * This is the generalisation the `..` line in {@link outsideSweeps}'s "cannot see" list used to cover by
 * declaring defeat — with one difference that matters. A path it cannot see is a MISSED sweep, which is safe.
 * A path it misreads is a FALSE ABORT, which is not, and a redundant segment was landing in the second
 * category rather than the first.
 *
 * @param path a path, possibly containing `.` or `..` segments
 * @returns the path with those segments resolved, absolute and without a trailing slash
 */
function resolveSegments({ path }: { path: string }): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return `/${out.join("/")}`;
}

function spellingsOf({ word }: { word: string }): readonly string[] {
  const unescaped = word.replace(/\\(.)/gu, "$1");
  return [word, unescaped, word.replaceAll(/['"]/gu, "").replace(/\\(.)/gu, "$1")];
}

/**
 * Paths every shell command mentions, which say nothing about where a pass is looking.
 *
 * `/sbin/` was missing until review pointed out that two `/sbin` invocations plus one failure abort a pass. It
 * is as ordinary as `/bin/`, and the omission was an oversight rather than a judgement.
 */
function isOrdinaryToolPath({ token }: { token: string }): boolean {
  return ["/bin/", "/sbin/", "/usr/", "/opt/", "/dev/null", "/etc/"].some((prefix) => token.startsWith(prefix));
}

/**
 * The coding agent's OWN state directory, which it reads as part of starting up.
 *
 * Matched by SHAPE rather than by an absolute prefix, deliberately: the home path it sits under is exactly the
 * kind of string `src/hygiene` exists to keep out of this repository, and the caller has no reason to be told
 * where the agent keeps its memory.
 *
 * Measured: 15 of the 24 recorded `off-track` aborts named `~/.codex/memories/MEMORY.md` as one of their two
 * sweeps. That read is the harness, not the pass — it happens before the pass has done anything, it is
 * guaranteed to be outside both roots, and because it is usually a `rg` that finds nothing it ALSO supplied
 * the single non-zero exit the sweep signature requires. One file was therefore providing both halves of the
 * evidence for a conclusion about the pass's judgement.
 *
 * @param token the absolute-path-looking token
 * @returns whether it points into the agent's own state rather than at any code
 */
function isAgentOwnState({ token }: { token: string }): boolean {
  return token.includes("/.codex/");
}

/**
 * The line an aborted pass reports, so the reader knows why rather than only that.
 *
 * @param assessment the assessment that decided to abort
 * @returns the human explanation naming every signal that fired
 */
export function tripwireExplanation({ assessment }: { assessment: TripwireAssessment }): string {
  return `stopped early: ${assessment.reasons.join("; ")}`;
}
