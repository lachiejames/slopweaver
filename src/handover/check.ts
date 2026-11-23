/**
 * Verifying an orchestration doc before it is handed over. Pure.
 *
 * ## Why this is a verb and not a checklist
 *
 * The skill used to say "check that every path exists and is committed" and leave the agent to it. That is a
 * convention, and it failed on its first real use: the authoring agent hand-rolled a grep with a hard-coded
 * prefix list, silently skipped every reference that did not match — including `AGENTS.md` — and then
 * reported that every path had been checked.
 *
 * Nobody was careless. A verification instruction with no mechanism produces a different incomplete check
 * every time, and each one reports success. So the check ships as code: one implementation, the same
 * coverage for every caller, and a list of what it did NOT look at rather than silence.
 *
 * Pure: the caller supplies the doc's text and a resolver for "does this path exist in the repo". No
 * filesystem here, so every rule below is testable without one.
 */

import { stripEnvPrefix, toolName } from "../admit/commandTokens.js";
import { shellSegments } from "../admit/shellSegments.js";
import { COMMAND_PROBE_TIMEOUT_MS } from "./commandProbe.js";
import { KNOWN_STATUSES } from "./doc.js";

/** One thing wrong with a doc, phrased so the author can act on it. */
export interface DocFinding {
  readonly line: number;
  readonly message: string;
}

/** Which input named the repository a doc's file references resolve against. */
type CheckRepoSource = "flag" | "doc" | "fallback";

/** The repository root a `handover check` run resolved to, and which input named it. */
interface CheckRepoResolution {
  readonly repo: string;
  readonly source: CheckRepoSource;
}

/**
 * Pick which repository a doc's file references resolve against.
 *
 * `--repo` is an explicit override and always wins. Absent that, the doc's own `repo:` is what the doc is
 * actually about, so it comes next. Only when neither is set does the check fall back to the caller's own
 * checkout — the fallback this repo shipped with, and the source of the bug this function replaces: every
 * doc from another repository was silently checked against slopweaver's own tree instead.
 *
 * @param docRepo the doc's own `repo:` front-matter field
 * @param repoFlag the `--repo` flag, when the caller passed one
 * @param fallback the root to use when neither names one — the caller's own checkout
 * @returns the resolved root, tagged with which input produced it
 */
export function resolveCheckRepo({
  docRepo,
  repoFlag,
  fallback,
}: {
  docRepo: string | undefined;
  repoFlag: string | undefined;
  fallback: string;
}): CheckRepoResolution {
  if (repoFlag !== undefined) {
    return { repo: repoFlag, source: "flag" };
  }
  if (docRepo !== undefined) {
    return { repo: docRepo, source: "doc" };
  }
  return { repo: fallback, source: "fallback" };
}

/** Anything shaped like a file reference. Deliberately broad — over-reporting beats a silent skip. */
const FILE_TOKEN = /`([A-Za-z0-9_.][A-Za-z0-9_./-]*\.(?:ts|tsx|md|js|mjs|cjs|json|yml|yaml|sh))`/g;

/**
 * A hard-coded scale claim.
 *
 * These are banned because they go stale between writing and reading, and a stale baseline has already sent
 * one session hunting for damage it had not caused. A doc states the COMMAND that produces the number.
 *
 * The digit class allows commas INSIDE the number rather than around it. The first version anchored on
 * `\d{2,}` and so matched "826" inside "2,826" — naming the wrong substring in its own finding, which is a
 * small version of the overclaim this whole check exists to stop.
 */
const COUNT_CLAIM =
  /\b(?:\d[\d,]*|zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s*(?:unit\s+|integration\s+|static\s+|bespoke\s+)*(?:tests?|test files?|files?|passes|checks?|ratchets?|suites?|modules?|verbs?|commands?|nouns?)\b/gi;

/**
 * A `--config <path>` flag, as a `command:` doneWhen probe passes it to a test runner.
 *
 * A config that moves (every `vitest.*.config.ts` relocated into `config/vitest/`) leaves every
 * probe still naming the old path silently exiting non-zero — a false RED on work that already landed, and a
 * false lead for whoever picks up a live doc next. Deliberately broad, same reasoning as {@link FILE_TOKEN}:
 * over-reporting on an unrelated `--config` beats a silent skip.
 */
const CONFIG_FLAG = /--config[= ]+(\S+)/g;

/**
 * Every `--config <path>` a `command:` probe names on one line, checked for existence.
 *
 * Split out of {@link checkHandoverDoc} so it can be tested against a plain fixture path list, the same
 * reason {@link checkDocumentCounts} is its own export.
 *
 * @param line the raw line text
 * @param lineNumber the 1-indexed line number, for reporting
 * @param exists answers "does this path exist, relative to the doc's own repo?"
 * @returns a finding per `--config` path that does not exist
 */
export function checkProbeConfigPaths({
  line,
  lineNumber,
  exists,
}: {
  line: string;
  lineNumber: number;
  exists: (args: { path: string }) => boolean;
}): readonly DocFinding[] {
  return [...line.matchAll(CONFIG_FLAG)]
    .map((match) => match[1]!)
    .filter((path) => !exists({ path }))
    .map((path) => ({
      line: lineNumber,
      message: `--config names \`${path}\`, which does not exist — check whether it moved`,
    }));
}

/**
 * A `vitest run` invocation, up to the next shell operator (`&&`, `;`, `|`) or end of line.
 *
 * `config/vitest/base.ts:42` sets `passWithNoTests: true` for every lane, so `vitest run <path that matches
 * nothing>` prints "No test files found, exiting with code 0" — a PASS. A `command:` probe of exactly this
 * shape (`yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/<dir>`) is therefore green before
 * the work it names has been written, and stays green forever if it never is: measured on
 * `linear-cycle-hygiene-and-project-updates`, a freshly written probe naming a directory that did not yet
 * exist passed on first evaluation, and the same command with `--passWithNoTests=false` exited 1.
 */
const VITEST_RUN_SEGMENT = /\bvitest run\b[^&;|]*/g;

/**
 * Strip flags that take a value away from a `vitest run` segment, so what remains can be scanned for a bare
 * path/file argument without mistaking a flag's VALUE for one — `--config config/vitest/unit.ts` would
 * otherwise read as a path filter itself.
 *
 * @param segment one `vitest run …` match, as {@link VITEST_RUN_SEGMENT} produces it
 * @returns the segment with every recognised flag (and its value) removed
 */
function stripKnownVitestFlags({ segment }: { segment: string }): string {
  return segment
    .replace(/--config[= ]+\S+/g, "")
    .replace(/--project[= ]+\S+/g, "")
    .replace(/--passWithNoTests(?:[= ]+\S+)?/g, "")
    .replace(/-t\s+"[^"]*"/g, "")
    .replace(/-t\s+'[^']*'/g, "")
    .replace(/-t\s+\S+/g, "")
    .replace(/--test-name-pattern[= ]+\S+/g, "");
}

/**
 * Whether a `vitest run` segment names a path or file filter — a bare positional argument containing `/`,
 * once every recognised flag (and its value) is stripped away.
 *
 * @param segment one `vitest run …` match
 * @returns whether the segment carries at least one path-shaped positional argument
 */
function namesPathFilter({ segment }: { segment: string }): boolean {
  const afterRun = stripKnownVitestFlags({ segment }).replace(/^\S*vitest run/, "");
  return /(?:^|\s)(?!-)[\w.-]*\/[\w./-]+/.test(afterRun);
}

/**
 * The guard flag that makes an empty match a failure instead of a silent pass.
 *
 * @param segment one `vitest run …` match
 * @returns whether the segment already carries `--passWithNoTests=false` (or `--passWithNoTests false`)
 */
function hasPassWithNoTestsFalse({ segment }: { segment: string }): boolean {
  return /--passWithNoTests[= ]+false\b/.test(segment);
}

/**
 * Every `vitest run` invocation on one line that names a path/file filter with no `--passWithNoTests=false`.
 *
 * Split out of {@link checkHandoverDoc} for the same reason {@link checkProbeConfigPaths} is its own export —
 * testable against a plain line, no doc or filesystem needed.
 *
 * @param line the raw line text
 * @param lineNumber the 1-indexed line number, for reporting
 * @returns a finding per unguarded filtered `vitest run` on that line
 */
export function checkFilteredVitestProbes({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): readonly DocFinding[] {
  return [...line.matchAll(VITEST_RUN_SEGMENT)]
    .map((match) => match[0])
    .filter((segment) => namesPathFilter({ segment }) && !hasPassWithNoTestsFalse({ segment }))
    .map(() => ({
      line: lineNumber,
      message:
        "vitest run names a path/file filter with no --passWithNoTests=false — config/vitest/base.ts sets " +
        "passWithNoTests: true, so a directory or file with no matching tests exits 0 and the probe is green " +
        "before the work exists",
    }));
}

/**
 * A `command:` doneWhen field, its value taken to the end of the line — quoted or bare, the two shapes this
 * doc's own front matter and its fixtures both use. No `\s*` before the capture: `\s` and `.` both match a
 * space, and stacking them right before an unbounded `.*` is exactly the ambiguous-overlap shape
 * `redos-check`'s `scslre` pass refuses as polynomial backtracking. The caller trims the captured value.
 */
const COMMAND_FIELD = /\bcommand:(.*)$/;

/** A `slopweaver <noun> <verb>` (or `./bin/slopweaver …`) invocation, the shape a doneWhen probe runs. */
const SUBVERB_INVOCATION = /\bslopweaver\s+[\w-]+\s+[\w-]+/;

/**
 * A tool that actually inspects what the invocation PRINTED, rather than only its exit code.
 */
const OUTPUT_ASSERTION_TOOL = /\b(?:grep|egrep|fgrep|diff|cmp|jq|awk|sed\s+-n|wc\s+-l)\b/;

/**
 * Signals that the probe's pass criterion is REFUSAL (the invocation must fail), not success. That direction
 * never reads a not-yet-built or misbehaving sub-verb as done, so it needs no output assertion to be sound.
 */
const CHECKS_REFUSAL = /-ne\s+0|!\s*(?:\.\/bin\/)?slopweaver|-eq\s+[123](?!\d)/;

/**
 * A `command:` doneWhen probe whose only evidence a sub-verb is DONE is that a bare `slopweaver <noun> <verb>`
 * invocation exited zero, with nothing asserting what it actually printed.
 *
 * Measured (`unknown-subverb-exits-zero-makes-probes-false-green`): a dispatcher that returns exit code 0 for
 * an unrecognised sub-verb lets exactly this shape read a not-yet-built verb as already done —
 * `slopweaver github stack remove --pr <n> --dry-run` prints generic usage text and exits 0. Every dispatcher
 * returns non-zero for one, which closes that specific hole, but the probe SHAPE stays weak evidence on its own
 * terms even after it: a `--dry-run` that silently does nothing still exits 0, the same loophole
 * {@link checkFilteredVitestProbes} closes for `vitest run`. A probe checking REFUSAL (`-ne 0`, a negated
 * invocation, or a specific non-zero code) is exempt — that direction never reads "not built yet" as "done" —
 * and so is one that greps, diffs or otherwise inspects the invocation's actual output.
 *
 * @param line the raw line text
 * @param lineNumber the 1-indexed line number, for reporting
 * @returns a finding when the line's `command:` probe is a bare, unasserted, success-gated sub-verb invocation
 */
export function checkBareSubVerbSuccessProbes({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): readonly DocFinding[] {
  const field = COMMAND_FIELD.exec(line);
  if (field === null) {
    return [];
  }
  const command = field[1]!.trim();
  if (!SUBVERB_INVOCATION.test(command) || OUTPUT_ASSERTION_TOOL.test(command) || CHECKS_REFUSAL.test(command)) {
    return [];
  }
  return [
    {
      line: lineNumber,
      message:
        "command: probe is a bare sub-verb invocation gated on exit code alone, with nothing asserting what it " +
        "printed — a not-yet-built or silently-inert sub-verb can exit 0 too; assert on the output instead, or " +
        "check that misuse is REFUSED (-ne 0) rather than that a run succeeded " +
        "(see unknown-subverb-exits-zero-makes-probes-false-green)",
    },
  ];
}

/*
 * Two deliberate omissions from the grammar above, both learned by over-firing rather than guessed:
 *
 * - The word "one" is absent. "refresh + derive in one command" and "`dev lint` is the one door" are
 *   idioms meaning A SINGLE, not inventory claims, and an inventory of one does not rot the way "26" does.
 *   Digits are still matched, so a literal "1 command" is caught.
 * - Nouns like `records`, `sources`, `gates` and `connectors` are absent. Widening to them fired on
 *   `docs/constraints.md`'s dated "226,593 records" measurement — a RECORD of something observed on a date,
 *   which is the one kind of number that does not go stale. Catching it would have taught authors that the
 *   gate cries wolf, which is how a gate gets routed around.
 */

/**
 * The package managers whose `<manager> <script>` form runs a whole named script from `package.json`.
 *
 * Not a list of slow commands, and deliberately so — a list of NAMES is a shape the owner rules against
 * (`./behaviouralProbe.ts`'s header, on the owner-ask phrase list): it goes stale the day
 * somebody adds a script, and it cannot travel to a doc whose `repo:` is another repository at all. What is
 * listed here is the invocation grammar instead, which is the same for every tree.
 */
const SCRIPT_RUNNERS: ReadonlySet<string> = new Set(["npm", "pnpm", "yarn"]);

/** The word some managers require between themselves and the script name. It narrows nothing. */
const RUN_SUBCOMMANDS: ReadonlySet<string> = new Set(["run", "run-script"]);

/** A command substitution — `$(…)` or a backtick run — means the real invocation cannot be read statically. */
const PROBE_COMMAND_SUBSTITUTION = /\$\(|`/;

/**
 * A `command:` value with the YAML quoting the doc author wrote around it removed.
 *
 * {@link COMMAND_FIELD} captures to the end of the line, quotes included, because the checks that shared it
 * first match on a regex that never sees the opening quote. This one tokenises, so `"yarn` would read as the
 * tool's own name and every quoted probe — which is most of them — would pass silently.
 *
 * @param value the trimmed `command:` field as {@link COMMAND_FIELD} captured it
 * @returns the value with one matched pair of surrounding single or double quotes stripped
 */
function unquotedCommand({ value }: { value: string }): string {
  const first = value.slice(0, 1);
  const quoted = (first === '"' || first === "'") && value.length > 1 && value.endsWith(first);
  if (!quoted) {
    return value;
  }
  return value.slice(1, -1);
}

/**
 * The script one shell segment runs WHOLE, or `undefined` when the segment narrows it or runs something else.
 *
 * "Whole" is the entire criterion: a script name with nothing after it means *run everything this name stands
 * for*. One more token — a path, a test filter, a flag — is the author scoping the probe down to the
 * consequence their own work changes, which is exactly the difference between the refused and the accepted
 * example in `skills/handover/reference/behavioural-probes.md`.
 *
 * @param segment one shell segment, as {@link shellSegments} cuts it
 * @returns the script name when the segment is an unnarrowed script run, else `undefined`
 */
function wholeScriptRun({ segment }: { segment: string }): string | undefined {
  const words = segment
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  // A leading `!` negates the segment's exit status; the tool that ran is the next token, not the bang.
  const tokens = stripEnvPrefix({ tokens: words[0] === "!" ? words.slice(1) : words });
  const first = tokens[0];
  if (first === undefined || !SCRIPT_RUNNERS.has(toolName({ first }))) {
    return undefined;
  }
  const afterManager = tokens.slice(1);
  const subcommand = afterManager[0];
  let rest = afterManager;
  if (subcommand !== undefined && RUN_SUBCOMMANDS.has(subcommand)) {
    rest = afterManager.slice(1);
  }
  const script = rest[0];
  if (script === undefined || rest.length !== 1 || script.startsWith("-")) {
    return undefined;
  }
  return script;
}

/**
 * A `command:` probe that runs a whole package-manager script, which cannot finish inside the probe budget.
 *
 * ## The measured defect
 *
 * MEASURED on `auto-route-spawns-across-the-three-plans-by-live-usage-not-by-memory`: a doc
 * declared `doneWhen: - command: "yarn lint"`. `handover finish --probe` reported it failed, twice, while
 * `yarn lint` in that same worktree exited 0 — measured at 337s in its own pre-push lap, against a
 * {@link COMMAND_PROBE_TIMEOUT_MS} budget of 30s. The doc reported PARTIAL on work that was already merged
 * green, and a session spent an hour debugging a gate that was never red.
 *
 * A kill is reported as `TIMED OUT` naming the budget, and counts as unexamined rather than as a failure the
 * command never gave. That does not change WHEN the author finds out — the first feedback still arrives minutes later, from a `--probe` run, after the doc has been handed
 * over. This check moves it to the moment the probe is written.
 *
 * ## Why this is a gate rather than the prose it replaces
 *
 * `skills/handover/reference/behavioural-probes.md` already states the rule in words — *"`yarn lint`,
 * `yarn validate`, `yarn typecheck` and an unscoped `yarn test:unit` are CI's jobs, not a probe"* — and the
 * probe that produced the measurement above was written after that section existed. A rule that only prose
 * carries is one every author has to have read.
 *
 * ## Which direction it errs, and the exemptions that follow
 *
 * Toward NOT firing, like every sibling check here. Any token after the script name exempts the segment, so
 * `yarn test:unit github/merge --coverage.enabled=false` (the reference's own ACCEPTED example) and
 * `yarn tsx src/devLint/<gate>.entry.ts` are silent; so is a command carrying `$(…)` or a backtick, where
 * nothing static can see what really runs. The accepted false negative is `yarn lint --fix`. Both are cheap
 * because this is a FINDING — nothing is refused, and the run-time behaviour is already honest.
 *
 * **The message says the budget is a RISK, never that this script will exceed it**, because nothing static
 * can time a script. A review pass over the live board measured that directly: the check flags `yarn hygiene`,
 * and `time yarn hygiene` on this tree is 5.4s, comfortably inside the budget. Asserting a timeout there would
 * be the same confident-lie class this whole row is about. What the finding always states truthfully is the
 * SHAPE — a whole-suite gate would stay green if the doc's claim went false, which is why it is weak evidence
 * at any speed.
 *
 * It fires on ANY segment, not only on a command built entirely of them — the opposite fold to
 * {@link ./behaviouralProbe}'s `isStructuralCommand`, and deliberately: there one live segment redeems a
 * probe, here one whole-suite segment is the 337 seconds, whatever is piped off it.
 *
 * @param line the raw line text
 * @param lineNumber the 1-indexed line number, for reporting
 * @returns a finding per unnarrowed script run in that line's `command:` probe
 */
export function checkWholeSuiteGateProbes({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): readonly DocFinding[] {
  const field = COMMAND_FIELD.exec(line);
  if (field === null) {
    return [];
  }
  const command = unquotedCommand({ value: field[1]!.trim() });
  if (PROBE_COMMAND_SUBSTITUTION.test(command)) {
    return [];
  }
  const budgetSeconds = String(COMMAND_PROBE_TIMEOUT_MS / 1000);
  return shellSegments({ command })
    .map((segment) => wholeScriptRun({ segment: segment.command }))
    .filter((script): script is string => script !== undefined)
    .map((script) => ({
      line: lineNumber,
      message:
        `command: probe runs the whole \`${script}\` script with nothing narrowing it — a whole-suite gate is ` +
        "CI's job, and it would stay green if this doc's own claim went false, so it is weak evidence however " +
        `long it takes. It is also spending an unbounded lap against a ${budgetSeconds}s probe budget ` +
        "(COMMAND_PROBE_TIMEOUT_MS): a probe the runner kills reports TIMED OUT, counts as unexamined and never " +
        "lets `finish` close on it (measured `yarn lint` at 337s — the doc reported PARTIAL on work " +
        "already merged green). Probe the ONE consequence the work changes — a scoped test file, a verb's " +
        "--dry-run output, or one gate's own entry point (see skills/handover/reference/behavioural-probes.md)",
    }));
}

/** Suffix-only tokens like `.entry.ts` — a naming convention, not a path. Never reported as missing. */
function isSuffixPattern({ token }: { token: string }): boolean {
  return token.startsWith(".") && !token.includes("/");
}

/**
 * Every file-shaped token a doc's body names, deduplicated.
 *
 * Extracted so the collision warning reuses the SAME grammar this check does, rather than growing a second one
 * that disagrees with it — two regexes for one rule is how the count claims got out of step with the tree in
 * the first place. Suffix conventions are dropped here too, because `.entry.ts` is not a path either doc owns.
 *
 * @param text the whole doc, front-matter included
 * @returns each distinct file token, in first-appearance order
 */
export function fileTokensOf({ text }: { text: string }): readonly string[] {
  const tokens = [...text.matchAll(FILE_TOKEN)].map((match) => match[1]!);
  return [...new Set(tokens.filter((token) => !isSuffixPattern({ token })))];
}

/** Language claiming a standard is being carried from this repository into another, deliberately broad. */
const PORTS_A_STANDARD =
  /\bport(?:ing|ed)?\b[^.\n]{0,60}\b(?:from slopweaver|standard|convention)\b|\b(?:same|this) (?:standard|convention)[^.\n]{0,40}\bslopweaver\b/i;

/** Citing a prior owner ruling — a dated decision this doc is not the first to make. */
const CITES_A_RULING = /\bowner rul(?:ing|ed)\b/i;

/**
 * A doc that ports a standard from this repository into another with no citation of the nearest prior owner
 * ruling on the same class.
 *
 * The regression this closes: a precedent such as the pr-format rule exists and nothing makes anyone look at
 * it — a doc that re-derives a standard from scratch each time repeats work the owner has already settled, and
 * can silently land a WEAKER version of a rule the owner already made stricter once.
 *
 * @param text the whole doc, front-matter included
 * @returns the finding, or none when the doc does not claim to port a standard, or already cites a ruling
 */
export function checkPortedStandardCitesRuling({ text }: { text: string }): readonly DocFinding[] {
  const lines = text.split("\n");
  const portIndex = lines.findIndex((line) => PORTS_A_STANDARD.test(line));
  if (portIndex === -1 || CITES_A_RULING.test(text)) {
    return [];
  }
  return [
    {
      line: portIndex + 1,
      message:
        "ports a standard from this repository into another with no citation of the nearest prior owner " +
        'ruling on the same class — say "owner ruling, <date>: …" and name it, or the doc may silently ' +
        "re-derive a weaker version of a rule the owner already settled",
    },
  ];
}

/**
 * Check a doc's body.
 *
 * @param text the whole doc, front-matter included
 * @param resolves answers "is there a committed file at, or named, this?" — supplied so this stays pure
 * @param configPathExists answers "does this `--config` path exist, relative to the doc's own repo?" —
 *   defaults to always-true so a caller that has not wired a repo (e.g. an existing unit test fixture) sees
 *   no new findings
 * @returns every finding, in line order; empty when the doc is sound
 */
export function checkHandoverDoc({
  text,
  resolves,
  configPathExists = () => true,
}: {
  text: string;
  resolves: (args: { token: string }) => boolean;
  configPathExists?: (args: { path: string }) => boolean;
}): readonly DocFinding[] {
  const findings: DocFinding[] = [...checkPortedStandardCitesRuling({ text })];
  text.split("\n").forEach((raw, index) => {
    const line = index + 1;
    for (const match of raw.matchAll(FILE_TOKEN)) {
      const token = match[1]!;
      if (!isSuffixPattern({ token }) && !resolves({ token })) {
        findings.push({ line, message: `references \`${token}\`, which is not a committed file` });
      }
    }
    for (const finding of checkDocumentCounts({ line: raw, lineNumber: line })) {
      findings.push(finding);
    }
    for (const finding of checkProbeConfigPaths({ exists: configPathExists, line: raw, lineNumber: line })) {
      findings.push(finding);
    }
    for (const finding of checkFilteredVitestProbes({ line: raw, lineNumber: line })) {
      findings.push(finding);
    }
    for (const finding of checkBareSubVerbSuccessProbes({ line: raw, lineNumber: line })) {
      findings.push(finding);
    }
    for (const finding of checkWholeSuiteGateProbes({ line: raw, lineNumber: line })) {
      findings.push(finding);
    }
  });
  // The two whole-doc checks above are prepended before the line number of their own mention is known, so a
  // stable sort restores "in line order" — stable, so two findings that already share a line (every per-line
  // check above) keep their existing relative order.
  return findings.toSorted((left, right) => left.line - right.line);
}

/**
 * Every hard-coded scale claim on one line.
 *
 * Split out of the handover check so the repo-doc ratchet can reuse the SAME grammar rather than growing a
 * second one that disagrees with it — two regexes for one rule is how the count claims got out of step with
 * the tree in the first place.
 *
 * @param line the raw line text
 * @param lineNumber the 1-indexed line number, for reporting
 * @returns a finding per count claim on that line
 */
export function checkDocumentCounts({ line, lineNumber }: { line: string; lineNumber: number }): readonly DocFinding[] {
  return [...line.matchAll(COUNT_CLAIM)].map((match) => ({
    line: lineNumber,
    message: `states a count ("${match[0].trim()}") — give the command that produces it instead, because a number goes stale`,
  }));
}

/**
 * One front-matter defect, carrying the KEY whose line the fix touches.
 *
 * The field is structured rather than left for a reader to infer from the prose, because a caller that has the
 * file can then point at the exact line. A gate that says only "a doc looks shipped" sends its reader hunting,
 * and hunting is the friction that gets a gate disabled.
 */
export interface FrontMatterFinding {
  /** The front-matter key to edit, or `undefined` for a parse defect that is not tied to one key. */
  readonly field: "status" | "artifact" | "blockedBy" | "statusSummary" | undefined;
  readonly message: string;
}

/**
 * Findings about the front-matter itself.
 *
 * Separate from the body because these are about whether the BOARD can place the doc, which is a different
 * question from whether the doc is accurate.
 *
 * @param artifact the declared artifact link
 * @param status the declared status
 * @param statusSummary the declared status summary, when there is one
 * @param requireStatusSummary whether a missing/blank `statusSummary:` is a finding — opt-in via
 *   `--require-status-summary`, since existing docs are never retroactively required to carry one
 * @param problems parse problems already found
 * @param unknownDependencies blockedBy slugs no doc on the board claims
 * @returns the findings, each naming the front-matter key its fix touches
 */
export function checkHandoverFrontMatter({
  artifact,
  status,
  statusSummary,
  requireStatusSummary,
  problems,
  unknownDependencies,
}: {
  artifact: string | undefined;
  status: string;
  statusSummary: string | undefined;
  requireStatusSummary: boolean;
  problems: readonly string[];
  unknownDependencies: readonly string[];
}): readonly FrontMatterFinding[] {
  const findings: FrontMatterFinding[] = problems.map((message) => ({ field: undefined, message }));
  if (status === "unknown") {
    findings.push({
      field: "status",
      message: `declares no usable \`status:\` — one of ${KNOWN_STATUSES.join(", ")}`,
    });
  }
  for (const slug of unknownDependencies) {
    findings.push({
      field: "blockedBy",
      message: `blockedBy names \`${slug}\`, which no doc on the board claims — a typo blocks forever`,
    });
  }
  if (artifact === undefined) {
    // A warning rather than a failure. Plenty of real work has no artifact, and refusing would push authors
    // to invent a link; but the owner reads the artifact rather than the doc days later, so its absence is
    // worth seeing every time.
    findings.push({
      field: "artifact",
      message: "has no `artifact:` link — you will be re-reading this doc itself in three days",
    });
  }
  // Prospective only: this never fires unless the caller explicitly asked for the strict check. There is no
  // way to tell a genuinely new/status-changed doc apart from an untouched legacy one from content alone, so
  // enforcement is a discipline the AUTHORING workflow opts into, not a default this function can infer.
  if (requireStatusSummary && (statusSummary === undefined || statusSummary.trim().length === 0)) {
    findings.push({
      field: "statusSummary",
      message:
        "has no `statusSummary:` — say why the CURRENT status is credible: what's blocked, what needs human " +
        "input, what can proceed independently, or (for cancelled/rejected) why the work stopped",
    });
  }
  return findings;
}
