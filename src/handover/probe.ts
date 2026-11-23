/**
 * `doneWhen:` — asking the REPOSITORY whether a doc's work has landed, instead of believing what it declared.
 *
 * ## The defect this exists for
 *
 * A hand sweep of the board found a large minority of non-done docs carrying a wrong status:
 * work that had shipped still said `ready`, work sitting on an unmerged branch still said `ready`, and docs
 * said `in-progress` with no branch and no commits anywhere. `handover check` caught none of it, correctly —
 * it verifies a doc is well WRITTEN, never that its work is undone. Nothing had ever asked the repository.
 *
 * So a doc declares the observable consequences of its own completion, and the board evaluates them.
 *
 * ## A probe downgrades confidence; it never flips a doc
 *
 * Passing probes do not mark a doc done. They prove a SYMPTOM is absent, which is not the same as the scope
 * having shipped — a doc's real deliverable is usually wider than anything a file check can see. Silently
 * auto-completing on a green probe would be a fresh instance of this repo's silent-failure class: state
 * reported true because a proxy for it was true. What probes do is refuse to let `start` open work that has
 * already landed, and refuse to let `finish` call a run done while a probe still fails.
 *
 * ## Why an unreadable file is never a PASS
 *
 * Measured, on this board's own docs: `linear-full-corpus-build.md` contains a single raw NUL byte at line
 * 169 — inside a sentence about control-character escapes — which makes `file` report it as `data` and makes
 * **grep silently blind to the entire file**. A grep-backed `absent:` probe over that file exits 1 and reads
 * as "the symbol is gone". It is not gone; nothing looked.
 *
 * Two rules follow, and both are load-bearing:
 *
 *  1. `present:`/`absent:` read bytes through the caller's seam (Node), never by shelling out to a text tool
 *     that decides for itself whether a file is text;
 *  2. a file that could not be READ yields {@link ProbeOutcome} `not-evaluated`, never `pass`. "I could not
 *     look" and "it is absent" are different answers, and collapsing them is how a blind check reports green.
 *
 * The one deliberate carve-out, because it is knowledge rather than ignorance: a file that does not EXIST
 * answers `false` — the symbol is definitively not in it — so `present:` fails and `absent:` passes. The seam
 * in {@link ./evaluate} draws that line on ENOENT alone, and it also treats an absent REPOSITORY as ignorance,
 * because there nothing was examined at all.
 *
 * ## Why a symbol match is structural for a TypeScript file
 *
 * A raw substring search cannot tell a real reference from a COMMENT about one. `src/live/turn/poster.ts`
 * once withheld a symbol's name from its own docstring for exactly this reason: an `absent:` probe grepped
 * the file for it, and naming the symbol in prose would have made a finished migration read as never having
 * happened. {@link textContainsSymbol} closes that hole for the case it can be closed: when the symbol is
 * IDENTIFIER-shaped and the file is a `.ts`/`.tsx` source, it parses the file and asks whether the symbol
 * appears as a real `Identifier` node — which a comment or a string literal never produces, since neither is
 * a syntax node the compiler visits. A symbol that is not identifier-shaped (`.slice(0, 1200)`, a bare
 * number, a doc phrase) has no AST equivalent to check, so it keeps the plain substring behaviour; so does
 * every non-TypeScript file, where "comment" is not even a distinct concept from prose.
 *
 * Pure: the caller supplies every seam. No filesystem, no subprocess, no clock.
 */

import { isAbsolute } from "node:path";

import { isRecord } from "#lib/parsers.js";
import { identifierReferenced } from "#lib/tsLazy.js";

/**
 * One observable consequence of a doc's work having landed.
 *
 * `present`/`absent` name a file and a symbol — any literal substring, not an identifier, because the thing
 * a fix removes is often a magic number (`.slice(0, 1200)`) rather than a name.
 */
export type Probe =
  | { readonly kind: "present"; readonly file: string; readonly symbol: string }
  | { readonly kind: "absent"; readonly file: string; readonly symbol: string }
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "command"; readonly command: string };

/**
 * What evaluating one probe concluded.
 *
 * `not-evaluated` is a first-class answer rather than a failure, and it is what keeps this honest. It covers
 * a `command:` probe the caller declined to run (see {@link ProbeSeams.runCommand}) and a file that could not
 * be read. Both are "nothing looked", which must never be reported as either pass or fail.
 */
export type ProbeOutcome = "pass" | "fail" | "not-evaluated";

/**
 * What one `command:` probe's run reported — enough for a refusal to name the exit, and no output at all.
 *
 * The runner discards the command's stdout and stderr on purpose (an undrained pipe is how a diagnostic
 * wedges — see {@link ./commandProbe}), so what survives to be printed is the STATUS. That is the whole
 * point of this record: before it, the runner answered a bare `boolean` and a refusal could only say
 * "command exited non-zero", which is true of a timeout, a shell that could not launch, and an exit 1 alike.
 */
export interface CommandProbeOutcome {
  /** The exit status, or `undefined` when a signal or a launch failure ended it instead. */
  readonly status: number | undefined;
  /** The signal that killed it, when the child did not trap it. A runner timeout is `timedOutAfterMs`, not this. */
  readonly signal: string | undefined;
  /**
   * The budget, in milliseconds, when the RUNNER killed the command for exceeding it — `undefined` otherwise.
   *
   * Read before `status` and `signal`, because a child that traps `SIGTERM` exits with a status of its own
   * (`yarn` answers 143), and that status describes the kill rather than anything the command observed.
   */
  readonly timedOutAfterMs: number | undefined;
  /** Why it could not be launched at all, or `undefined` when the command itself ran and reported. */
  readonly launchFailure: string | undefined;
}

/**
 * The glyph for one outcome. `–` is not a failure: it means nothing looked, which is its own answer.
 *
 * Here rather than beside the lifecycle verbs that first printed it, because the BOARD prints it too now
 * (`./boardState.ts`'s `contradictionDetail`) and two glyph tables for one three-valued outcome is the same
 * drift {@link textContainsSymbol}'s own header refuses for `fileContains`. A glyph is never the whole
 * answer on the board — see that function for why the outcome is also spelled as a word there.
 *
 * @param outcome one probe's verdict
 * @returns the mark to print beside it
 */
export function probeMark({ outcome }: { outcome: ProbeOutcome }): string {
  if (outcome === "pass") {
    return "✔";
  }
  return outcome === "fail" ? "✘" : "–";
}

/** One probe's verdict, with the reason stated so a reader never has to infer it. */
export interface ProbeResult {
  readonly probe: Probe;
  readonly outcome: ProbeOutcome;
  /** Why this outcome, as one phrase fit to print on the board. */
  readonly note: string;
}

/**
 * The edges evaluation needs, supplied by the caller so every rule here is testable without a filesystem.
 *
 * `fileContains` is deliberately tri-state rather than boolean: a boolean forces every failure into `false`,
 * which silently PASSES an `absent:` probe on a file nothing could read. See the module header — that is a
 * measured failure, not a hypothetical one. Non-EXISTENCE is the one failure that legitimately answers `false`.
 */
export interface ProbeSeams {
  /**
   * `true`/`false` when the answer is known, `undefined` when nothing could be examined.
   *
   * A file that does not exist is `false`, not `undefined` — its non-existence IS the answer. `undefined` is for
   * genuine ignorance: an unreadable file, a directory, a missing repository root.
   */
  readonly fileContains: (args: { file: string; symbol: string }) => boolean | undefined;
  readonly pathExists: (args: { path: string }) => boolean;
  /**
   * Runs a `command:` probe and reports HOW it ended, or `undefined` to decline.
   *
   * Declining is the DEFAULT everywhere, including the single-doc verbs. The board recomputes every time and
   * prints every doc, so evaluating command probes there would fan arbitrary shell from every doc on every
   * print. `--probe` is the only thing that ever supplies a runner, on `list`, `start`, `finish` and `resume`
   * alike — running a doc's shell is always something someone asked for explicitly.
   */
  readonly runCommand: ((args: { command: string }) => CommandProbeOutcome) | undefined;
}

/** A symbol shaped like a real TypeScript identifier — the only shape the structural check can apply to. */
const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Extensions this repo writes real TypeScript into — the only files the structural check applies to. */
const TYPESCRIPT_EXTENSIONS: readonly string[] = [".ts", ".tsx"];

/**
 * Whether an occurrence of `symbol` in `file` has to be CODE to count, rather than any substring.
 *
 * The named half of the module header's structural rule, and it is named because the probe that found the
 * defect could not cite it: `present: src/corpus/slack/fetch.ts#flushWithinChannel` passed on a comment
 * reading *"See channelRead.ts's flushWithinChannel"* long after the function itself moved, and the rule
 * that would have caught it lived as an anonymous local inside {@link textContainsSymbol}. A rule with no
 * name cannot be probed for, tested on its own, or cited by the next reader.
 *
 * Both halves are necessary and neither is sufficient. A symbol that is not identifier-shaped
 * (`.slice(0, 1200)`, a bare number, a doc phrase) has no AST node to look for at all; a file that is not
 * TypeScript has no parse in which "comment" is even distinct from prose.
 *
 * @param file the repo-relative path the symbol is being looked for in
 * @param symbol the `doneWhen:` symbol
 * @returns true when only a real code occurrence counts, false when any substring does
 */
export function codeBearing({ file, symbol }: { file: string; symbol: string }): boolean {
  return IDENTIFIER_PATTERN.test(symbol) && TYPESCRIPT_EXTENSIONS.some((ext) => file.endsWith(ext));
}

/**
 * Whether a file's text contains a `doneWhen:` symbol — the shared rule every `ProbeSeams.fileContains`
 * implementation applies, so `handover/evaluate.ts` (the live working tree) and
 * `outbound/github/probeSweep.ts` (a historical git ref) can never drift onto two different definitions of
 * "contains".
 *
 * @param file the repo-relative path the text was read from, deciding whether the structural check applies
 * @param text the file's full text
 * @param symbol the `doneWhen:` symbol to look for
 * @returns true when the symbol is present, by the structural rule for a TypeScript identifier or by plain
 *   substring otherwise
 */
export function textContainsSymbol({ file, text, symbol }: { file: string; text: string; symbol: string }): boolean {
  return codeBearing({ file, symbol }) ? identifierReferenced({ symbol, text }) : text.includes(symbol);
}

/**
 * Where a doc's work has got to, computed from its probes rather than declared.
 *
 * `unevaluated` is distinct from `partial`: it means every probe that WAS checked passed, and the rest were
 * simply never examined (a declined `command:` probe, or a file nothing could read) — nothing contradicts
 * the doc. `partial` means a probe was actually checked and failed. Collapsing the two used to make a
 * `done` doc with an unrun `command:` probe read as CONTRADICTION on a bare `list` before anything had
 * looked — see {@link computeState}'s header comment for the measured case.
 */
export type ComputedState = "not-started" | "in-flight" | "unevaluated" | "partial" | "landed";

/** The `file#symbol` separator. The FIRST `#` splits, so a symbol may itself contain one. */
const SYMBOL_SEPARATOR = "#";

/** Parse one `file#symbol` target, or report why it is unusable. */
function splitTarget({ value }: { value: string }): { file: string; symbol: string } | string {
  const hash = value.indexOf(SYMBOL_SEPARATOR);
  if (hash <= 0) {
    return `must be \`file${SYMBOL_SEPARATOR}symbol\`, but got \`${value}\``;
  }
  const file = value.slice(0, hash).trim();
  const symbol = value.slice(hash + 1).trim();
  if (file.length === 0 || symbol.length === 0) {
    return `must be \`file${SYMBOL_SEPARATOR}symbol\` with both halves non-empty, but got \`${value}\``;
  }
  return { file, symbol };
}

/** What a `doneWhen:` block yielded: the probes it declares, plus every entry that could not be read. */
export interface ParsedProbes {
  readonly probes: readonly Probe[];
  /**
   * Entries that did not parse, each a sentence.
   *
   * Reported rather than dropped. A `doneWhen:` entry silently ignored would make a doc look like it had
   * fewer conditions than its author wrote — so the board would compute `landed` off a subset, which is the
   * overclaim this whole module exists to remove.
   */
  readonly problems: readonly string[];
}

/** The single-key probe forms, mapped to the field their value fills. */
const TARGET_KINDS = ["present", "absent"] as const;

/** Read one `doneWhen:` entry into a probe, or a sentence saying why it could not be. */
function parseEntry({ entry, index }: { entry: unknown; index: number }): Probe | string {
  const at = `doneWhen[${String(index)}]`;
  if (!isRecord(entry)) {
    return `${at} is not a \`kind: value\` entry`;
  }
  const keys = Object.keys(entry);
  if (keys.length !== 1) {
    return `${at} must declare exactly one of present/absent/path/command, but declares ${String(keys.length)}`;
  }
  const key = keys[0]!;
  const value = entry[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    return `${at} declares \`${key}\` with no value`;
  }
  return parseByKind({ at, key, value: value.trim() });
}

/**
 * The sentence an absolute `path:`/`present:`/`absent:` target earns, naming the remedy.
 *
 * MEASURED over the whole board (301 ready docs, 1,171 in total): THREE probes declare one, and
 * every one of them reads as silently false today. `insideRepo` (`./evaluate.ts`) returns `undefined` for an
 * absolute target before any read happens, so the board prints the row as an ordinary unmet probe rather
 * than as a probe it declined to evaluate — indistinguishable from a file that is genuinely not there.
 * Reproduce by pointing one at a file that certainly exists and watching the row stay red.
 *
 * This is a PARSE problem rather than a gated rule, so it carries no waiver: the fix is to make the target
 * repo-relative. A deliverable that genuinely lands outside the doc's own `repo:` has no legal spelling in
 * this form at all — that case belongs in a `command:` probe, and the message says so rather than leaving
 * the author to discover it.
 */
function absoluteTargetProblem({ at, key, value }: { at: string; key: string; value: string }): string {
  return (
    `${at} declares \`${key}\` with the ABSOLUTE path \`${value}\` — every target resolves against the doc's ` +
    "own `repo:`, so an absolute one is declined before it is read and the probe reads as permanently " +
    "unmet. Make it repo-relative, or use a `command:` probe when the deliverable really does land outside " +
    "that repository."
  );
}

/** Dispatch a parsed `key: value` pair onto its probe shape. */
function parseByKind({ at, key, value }: { at: string; key: string; value: string }): Probe | string {
  if (key === "path") {
    return isAbsolute(value) ? absoluteTargetProblem({ at, key, value }) : { kind: "path", path: value };
  }
  if (key === "command") {
    return { command: value, kind: "command" };
  }
  const kind = TARGET_KINDS.find((known) => known === key);
  if (kind === undefined) {
    return `${at} declares unknown probe kind \`${key}\` — expected present/absent/path/command`;
  }
  const target = splitTarget({ value });
  if (typeof target === "string") {
    return `${at} ${target}`;
  }
  if (isAbsolute(target.file)) {
    return absoluteTargetProblem({ at, key, value: target.file });
  }
  return { file: target.file, kind, symbol: target.symbol };
}

/**
 * Read a doc's `doneWhen:` block.
 *
 * @param value the raw `doneWhen` value as the YAML parser produced it
 * @returns the probes it declares plus a sentence per unreadable entry
 */
export function parseProbes({ value }: { value: unknown }): ParsedProbes {
  if (value == null) {
    return { probes: [], problems: [] };
  }
  if (!Array.isArray(value)) {
    return { probes: [], problems: ["`doneWhen:` must be a list of `kind: value` entries"] };
  }
  const probes: Probe[] = [];
  const problems: string[] = [];
  value.forEach((entry: unknown, index) => {
    const parsed = parseEntry({ entry, index });
    if (typeof parsed === "string") {
      problems.push(parsed);
      return;
    }
    probes.push(parsed);
  });
  return { probes, problems };
}

/** Evaluate a `present:`/`absent:` probe, keeping "could not read" distinct from "not there". */
function evaluateTarget({
  probe,
  seams,
}: {
  probe: Probe & { kind: "present" | "absent" };
  seams: ProbeSeams;
}): ProbeResult {
  const found = seams.fileContains({ file: probe.file, symbol: probe.symbol });
  if (found === undefined) {
    // NEVER a pass, in either direction. An unread file cannot testify that a symbol is gone — the measured
    // NUL-byte case in the module header is exactly this, and a grep there reports "absent" having read
    // nothing at all.
    return { note: `could not read ${probe.file} — nothing was checked`, outcome: "not-evaluated", probe };
  }
  const wantPresent = probe.kind === "present";
  return {
    note: found ? `${probe.file} contains \`${probe.symbol}\`` : `${probe.file} does not contain \`${probe.symbol}\``,
    outcome: found === wantPresent ? "pass" : "fail",
    probe,
  };
}

/** Evaluate one probe of any kind. */
function evaluateOne({ probe, seams }: { probe: Probe; seams: ProbeSeams }): ProbeResult {
  if (probe.kind === "present" || probe.kind === "absent") {
    return evaluateTarget({ probe, seams });
  }
  if (probe.kind === "path") {
    const exists = seams.pathExists({ path: probe.path });
    return {
      note: exists ? `${probe.path} exists` : `${probe.path} does not exist`,
      outcome: exists ? "pass" : "fail",
      probe,
    };
  }
  const run = seams.runCommand;
  if (run === undefined) {
    return {
      note: `command not evaluated — pass --probe to run it: ${probe.command}`,
      outcome: "not-evaluated",
      probe,
    };
  }
  const outcome = run({ command: probe.command });
  let verdict: ProbeOutcome = outcome.status === 0 ? "pass" : "fail";
  if (outcome.timedOutAfterMs !== undefined) {
    // The runner stopped it before it answered, so nothing was observed either way — the same honest answer a
    // declined command gets, never a failure the command did not report.
    verdict = "not-evaluated";
  }
  return { note: commandProbeNote({ command: probe.command, outcome }), outcome: verdict, probe };
}

/**
 * How one `command:` probe ended, phrased so a reader can tell WHICH probe it was and re-run it.
 *
 * The command is printed WHOLE. Every other probe kind names its subject — {@link evaluateTarget} prints the
 * file and the symbol, the `path` branch prints the path — and the `command` branch was the one that named
 * nothing, so two command probes on one doc printed two lines a reader could not tell apart. A doc author who
 * wrote a 300-character probe chose that length; truncating it here would produce a line that reads perfectly
 * and identifies nothing, which is the failure this is fixing rather than a smaller version of it.
 *
 * @param command the probe's own command string, printed in full
 * @param outcome what the runner reported
 * @returns the note to print beside this probe's glyph
 */
export function commandProbeNote({ command, outcome }: { command: string; outcome: CommandProbeOutcome }): string {
  if (outcome.timedOutAfterMs !== undefined) {
    return (
      `command TIMED OUT at the ${String(outcome.timedOutAfterMs / 1000)}s probe budget — the runner killed it, so it ` +
      `neither passed nor failed. A whole-suite gate is the wrong probe shape: probe the one consequence the work ` +
      `changes (skills/handover/reference/behavioural-probes.md): ${command}`
    );
  }
  if (outcome.launchFailure !== undefined) {
    return `command could not run (${outcome.launchFailure}): ${command}`;
  }
  if (outcome.signal !== undefined) {
    return `command killed by ${outcome.signal}: ${command}`;
  }
  if (outcome.status === undefined) {
    return `command ended with no exit status: ${command}`;
  }
  return `command exited ${String(outcome.status)}: ${command}`;
}

/**
 * Evaluate every probe a doc declares.
 *
 * @param probes the doc's parsed probes
 * @param seams the caller's edges — filesystem reads and, optionally, a command runner
 * @returns one result per probe, in declaration order
 */
export function evaluateProbes({
  probes,
  seams,
}: {
  probes: readonly Probe[];
  seams: ProbeSeams;
}): readonly ProbeResult[] {
  return probes.map((probe) => evaluateOne({ probe, seams }));
}

/**
 * `outputs:` is REPORTED, never turned into a probe. This function exists to say so in one place.
 *
 * The obvious design was to make each non-URL output a `path:` probe — "does the result exist yet?" — and it
 * was wrong. Measured: a decision doc declaring `outputs: [docs/constraints.md]` computed `landed` and printed
 * under LOOK SHIPPED the instant it was written, because that file already existed. Nothing had been decided.
 * That is the exact overclaim this whole feature removes, reintroduced by the convenience.
 *
 * A landing site an author names is usually a file they intend to CREATE or ADD TO, and existence cannot tell
 * those apart. So outputs are provenance for a human, and an author who genuinely wants existence checked says
 * so deliberately with `doneWhen: - path: …`. A URL is never probed either: that would need the network, and
 * this is an offline read of a repository.
 *
 * @param outputs the doc's declared landing sites
 * @returns always empty — kept as a named seam so the reason is discoverable from the call sites
 */
export function outputProbes({ outputs }: { outputs: readonly string[] }): readonly Probe[] {
  void outputs;
  return [];
}

/**
 * Where the work has got to, from the probe results plus whether a branch carries commits for it.
 *
 * `undefined` means NOT COMPUTABLE — no probe actually returned an answer — and it is deliberately not a
 * sixth state. A doc whose only probes are `command:` ones prints on the board without any being run, and
 * inventing a state for that would put a computed-looking word next to work nothing examined.
 *
 * Measured: `derived-state-freshness-contract` declared `doneWhen: [path, command]`. A bare
 * `list` evaluates the `path` probe (it passed) but declines the `command` one — so `failed === 0` and
 * `skipped === 1`, which this function used to fold into `partial`. `partial` then read to
 * `probeStatusContradiction` in `boardState.ts` as "the repository shows probes failing", and a `done` doc
 * whose command probe simply had not run yet was reported under CONTRADICTION before anything had looked.
 * `unevaluated` exists to keep that case distinct from a probe that was actually checked and failed.
 *
 * @param results the evaluated probes
 * @param commitsAhead commits on the doc's branch or worktree that are not on the base
 * @returns the computed state, or `undefined` when nothing was evaluated
 */
export function computeState({
  results,
  commitsAhead,
}: {
  results: readonly ProbeResult[];
  commitsAhead: number;
}): ComputedState | undefined {
  const passed = results.filter((result) => result.outcome === "pass").length;
  const failed = results.filter((result) => result.outcome === "fail").length;
  const skipped = results.filter((result) => result.outcome === "not-evaluated").length;
  if (passed === 0 && failed === 0) {
    return undefined;
  }
  // `landed` requires that EVERY declared probe was checked and passed. A `not-evaluated` one means a condition
  // the doc declared was never examined — a skipped `command:` probe, or a file nothing could read — and
  // treating that as landed is precisely the "partially checked, reported complete" overclaim this module
  // exists to remove. An adversarial pass found it, and an earlier test of mine had codified it.
  if (failed === 0 && skipped === 0) {
    return "landed";
  }
  if (failed === 0) {
    // Nothing that WAS checked failed. The rest is unknown, not failing — see the header comment above.
    return "unevaluated";
  }
  if (passed > 0) {
    // The one state a boolean cannot hold, and the one that would have forced a follow-up doc to exist for
    // the single item that did not land. A genuine failure, unlike `unevaluated` above.
    return "partial";
  }
  return commitsAhead > 0 ? "in-flight" : "not-started";
}
