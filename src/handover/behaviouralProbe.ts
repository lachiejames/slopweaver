/**
 * The behavioural-probe gate: a doc that records an OWNER ASK may not be set `done` on a probe that only
 * checks the shape somebody built.
 *
 * ## The defect this exists for
 *
 * Measured in an audit of feedback locked in: of the owner-ask docs
 * set `done` over a window, five failed a live re-check on the very complaint they were written for — and
 * every one of them still had green probes. Their `doneWhen:` asserted that a symbol, a heading or a file
 * existed, which stayed true while the behaviour underneath it went wrong again.
 *
 * The two sharpest cases, both real:
 *
 * - A doc's only probe was `grep -qi 'never blocks on' skills/supervisor/SKILL.md` — a grep for its own
 *   heading. It passed every day for two days while the paragraph BENEATH that heading told every session
 *   reading it something false. A probe cannot catch a lie it is standing inside.
 * - Another doc's probes were `absent:` assertions on symbols a refactor had removed. They passed all
 *   morning while the live progress card the owner had complained about sat frozen.
 *
 * The board already re-evaluates a `done` doc's probes on every read and reports a regression under
 * CONTRADICTION (`boardState.ts`'s `probeStatusContradiction`), so nothing needed building there. What was
 * missing is that almost no probe asked *"does the thing the owner complained about still happen?"* — so a
 * behavioural regression with the shape intact was invisible by construction, and the owner gave the same
 * feedback twice.
 *
 * ## The rule
 *
 * > A doc may not be set `done` without at least one `doneWhen:` probe that would FAIL if its claim were
 * > false — asserted against live state or a live command, never against the presence of a symbol, a
 * > heading, or a file.
 *
 * ## Why the trigger is unconditional, having started as a keyword match
 *
 * The rule originally fired only on a summary matching one of twelve owner-ask phrases ("owner ask", "owner
 * ruling", "owner wants" — {@link OWNER_ASK_MARKERS}). That worked: measured over
 * `$SLOPWEAVER_HOME/handovers`, `done` docs closed with no probe and no waiver fell from 37% before the gate
 * to 15% after it, and 40 honest `probeWaiver:` entries appeared where there had been zero.
 *
 * But the trigger left most of the board out. Of 477 `done` docs, 143 carried a marker, so **334 were
 * outside the rule entirely** — a recurring bug nobody happened to phrase as an owner quote was never asked
 * for proof. Widening the phrase list was rejected as heuristic stacked on heuristic: this class of judgement
 * is not a rule to encode, because a heuristic for it falls to edge cases and builds a worse product. Reproduce the counts
 * with `slopweaver handover lint`, or against the board directly:
 * `grep -lE '^status: done' ~/.slopweaver/handovers/*.md | wc -l`.
 *
 * So the trigger became the one thing that needs no judgement at all — *does this doc carry anything that
 * could fail?* — while WHICH probe to write, and whether a waiver is honest, stays entirely with the author.
 * The framing is that words alone do not prove a PR does what it says, so a mechanical check must enforce it.
 * The mechanism owns the demand; judgement owns the answer.
 *
 * {@link ownerAskMarker} survives because a matched marker still explains WHY to an author reading the
 * refusal — it enriches the message and no longer decides whether there is one.
 *
 * ## The one kind this still does not reach, and why that is not a hole
 *
 * An `ask` row makes no claim. It is a question the owner asked, settled by an ANSWER and a witness
 * (`./askRow.ts`) rather than by anything the repository can be asked to re-run, so "name a probe that would
 * fail if this were false" has no coherent answer for one. Demanding it anyway would be the cry-wolf failure
 * this module's own scope notes warn about: a gate that fires where nothing could ever satisfy it is a gate
 * people learn to override. `doc` rows claim; `ask` rows ask. Only the first is gated.
 *
 * **It refuses by default, and the escape is RECORDED.** The rule fails loudly by default, with an escape
 * hatch. The reasoning bounds the rule: a hard refuse is heavy-handed with diminishing returns, since proving
 * that the owner will not raise the same complaint twice is often genuinely infeasible under the test setup. A loud default with a hatch makes an agent try harder
 * without blocking a landing.
 *
 * So there are two escapes and they are not interchangeable:
 *
 * - **`probeWaiver:` on the doc** is the sanctioned one. The gate stands down and every surface PRINTS the
 *   waiver, so an unsanctioned `done` stays visible on the board rather than passing silently. This is the
 *   hatch the ruling asks for.
 * - **{@link ALLOW_STRUCTURAL_PROBE}** is the one-shot break-glass at `handover finish`, printed loudly, for
 *   the session that needs to close now and record the waiver next. It is not a substitute: it leaves
 *   nothing on the doc, so the message says to write `probeWaiver:` as well.
 *
 * {@link BEHAVIOURAL_PROBE_MODE} additionally allows the whole rule to be demoted to advisory. The SHIPPED
 * default is `refuse`; the switch exists so the posture is one variable rather than a rewrite.
 *
 * ## Which direction this errs, and why that is the safe one
 *
 * Toward NOT refusing. A `command:` probe counts as behavioural unless every command it invokes is a plain
 * file-or-text inspector — so `slopweaver turn status --help | grep -q fresh-visible-session` is behavioural
 * (it runs the verb), and `grep -q 'a heading' skills/<name>/SKILL.md` is not (nothing ran). Anything this cannot
 * resolve statically — a command substitution, an unrecognised tool — is treated as behavioural.
 *
 * That is deliberate. The population this gate must catch is unambiguous: docs with no probes at all, and
 * docs whose whole `doneWhen:` is `present:`/`absent:`/`path:`/`test -f`/`test -s`/a bare grep. A gate that
 * argued with authors about borderline shell would be routed around, and a routed-around gate protects
 * nothing. See {@link INSPECTORS} for what the list is and is not.
 *
 * Pure: no filesystem, no subprocess, no clock. The caller supplies the doc's already-parsed front-matter.
 */

import { stripEnvPrefix, toolName } from "../admit/commandTokens.js";
import { shellSegments } from "../admit/shellSegments.js";
import type { Probe } from "./probe.js";
import type { BoardRowKind } from "./rowKind.js";

/** The break-glass, per this repo's block-by-default shape: one variable, one risk, single-run, logged. */
export const ALLOW_STRUCTURAL_PROBE = "SLOPWEAVER_ALLOW_STRUCTURAL_PROBE";

/** The one switch the owner's ruling flips. See the module header. */
export const BEHAVIOURAL_PROBE_MODE_ENV = "SLOPWEAVER_BEHAVIOURAL_PROBE_MODE";

/**
 * Whether a doc failing the rule is REFUSED or merely reported.
 *
 * `refuse` changes the verb's exit code; `advise` prints exactly the same message and exits as it otherwise
 * would. Deliberately not a per-caller flag: the mode is the rule's posture across every surface at once, and
 * a flag any caller could pass would be the silent opt-out the gate exists to remove.
 */
export type BehaviouralProbeMode = "advise" | "refuse";

/** The shipped default, per the owner's ruling: refuse loudly, with a recorded waiver. */
export const BEHAVIOURAL_PROBE_MODE: BehaviouralProbeMode = "refuse";

/**
 * The mode in force, read from an environment.
 *
 * @param env the environment to read
 * @returns `advise` when {@link BEHAVIOURAL_PROBE_MODE_ENV} says so exactly, else {@link BEHAVIOURAL_PROBE_MODE}
 */
export function behaviouralProbeMode({ env }: { env: NodeJS.ProcessEnv }): BehaviouralProbeMode {
  return env[BEHAVIOURAL_PROBE_MODE_ENV] === "advise" ? "advise" : BEHAVIOURAL_PROBE_MODE;
}

/**
 * The markers that say a doc's summary records something the OWNER asked for, rather than work an agent
 * chose. Matched case-insensitively against the `summary:` field only.
 *
 * The first group is the audit's own list (§ "Method"), reproduced rather than widened: a loose `owner` grep
 * over the same board matched 130 docs, nearly all of them noise ("repo owner", "owned by"), and a gate
 * firing on those is the cried-wolf failure that gets a gate disabled.
 *
 * The second group is the same eight phrases written with the NOUN instead of the pronoun, and it is here
 * because running this gate over the live board found the audit's own rows written that way — the doc it
 * lists as `local-deploy-torn-down-before-owner-inspects` says *"the owner asked for a local deploy"*, and
 * `review-loop-rounds-on-unrequested-scope` says *"the owner asks for backtests ~daily"*. Matching only the pronoun
 * forms would have silently excluded rows the ruling was written about, which is the same
 * looks-like-it-works failure the whole gate exists to remove.
 *
 * Each marker is a pattern anchored at the START of a word, deliberately NOT at the end. The board writes one
 * phrase in every tense — "the owner asked", "the owner asks", "owner wants", "owner wanted" — and an end anchor
 * would need a separate entry per inflection, which is a list that goes stale the first time somebody writes a new
 * one. A leading anchor alone cannot match inside another word (`downloaded` never matches `owner asked`), which is
 * the failure the anchor is actually for. Internal spaces also match a hyphen or an underscore, so `owner-ask` and
 * `owner_ask` read the same as `OWNER ASK`.
 *
 * @internal — the rule is consumed through {@link ownerAskMarker}; the list itself is documentation.
 */
const OWNER_ASK_MARKERS: readonly RegExp[] = [
  // The audit's list.
  /\bowner[\s_-]+ask/i,
  /\bowner[\s_-]+ruling/i,
  /\bhis[\s_-]+ruling/i,
  /\bhis[\s_-]+words/i,
  /\bhe[\s_-]+asked/i,
  /\bhe[\s_-]+ruled/i,
  /\bhe[\s_-]+wants/i,
  /\bhe[\s_-]+told/i,
  // The same phrases with the noun, measured on the live board.
  /\bowner[\s_-]+ruled/i,
  /\bowner[\s_-]+wants/i,
  /\bowner[\s_-]+told/i,
];

/** A hyphen, an underscore or a run of whitespace between a marker's words, read as one space. */
const MARKER_SEPARATOR = /[\s_-]+/u;

/**
 * The tools whose whole job is to read bytes off disk and match text against them.
 *
 * A probe built only from these proves a SHAPE — a file exists, a string is in it — which is precisely the
 * evidence the audit measured as passing while the behaviour underneath it was wrong. It is not a list of
 * banned commands and it is not security-relevant: `sed`, `awk` and `jq` can all shell out in principle, and
 * this makes no attempt to stop them. It is the answer to one narrow question — *did anything actually
 * run?* — and every entry here answers "no".
 *
 * @internal — consumed through {@link isStructuralCommand}; naming it separately is documentation.
 */
const INSPECTORS: ReadonlySet<string> = new Set([
  "[",
  "[[",
  "awk",
  "basename",
  "cat",
  "cut",
  "dirname",
  "echo",
  "egrep",
  "false",
  "fgrep",
  "file",
  "find",
  "grep",
  "head",
  "jq",
  "ls",
  "printf",
  "readlink",
  "realpath",
  "rg",
  "sed",
  "sort",
  "stat",
  "tail",
  "test",
  "tr",
  "true",
  "uniq",
  "wc",
]);

/**
 * Shell builtins that RUN nothing — they move the shell, they do not exercise the product.
 *
 * Separate from {@link INSPECTORS} because they inspect nothing either. Found by running this gate over the
 * live board: `context-hygiene-close-and-respawn`'s only probe is `cd <repo> && grep -rq … && grep -rq …`,
 * which is three greps behind a `cd` — and without this list the leading `cd` made a purely structural probe
 * read as behavioural, exempting the exact doc the rule was written for.
 *
 * @internal — consumed through {@link isStructuralCommand}, alongside {@link INSPECTORS}.
 */
const SHELL_NOOPS: ReadonlySet<string> = new Set([":", "cd", "export", "popd", "pushd", "set"]);

/** A command substitution — `$(…)` or a backtick run — means something this cannot see statically runs. */
const COMMAND_SUBSTITUTION = /\$\(|`/;

/** The tool one shell segment invokes, with any `env …`/`VAR=…` prefix and directory prefix stripped off. */
function segmentTool({ segment }: { segment: string }): string | undefined {
  const words = segment
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  // A leading `!` negates the segment's exit status; the tool that ran is the next token, not the bang.
  const tokens = stripEnvPrefix({ tokens: words[0] === "!" ? words.slice(1) : words });
  const first = tokens[0];
  return first === undefined ? undefined : toolName({ first });
}

/**
 * Whether a shell string only ever INSPECTS — reads a file, matches text — and never runs anything.
 *
 * @param command the raw `command:` probe text
 * @returns true when every segment's tool is one of {@link INSPECTORS} and nothing is substituted in
 */
export function isStructuralCommand({ command }: { command: string }): boolean {
  if (COMMAND_SUBSTITUTION.test(command)) {
    return false;
  }
  const segments = shellSegments({ command });
  const tools = segments
    .map((segment) => segmentTool({ segment: segment.command }))
    .filter((tool): tool is string => tool !== undefined);
  if (tools.length === 0) {
    // Nothing resolvable at all. An empty or unparseable command ran nothing, so it proves nothing — the
    // same answer a bare `test -f` gets, and the loud direction for a probe this cannot read.
    return true;
  }
  return tools.every((tool) => INSPECTORS.has(tool) || SHELL_NOOPS.has(tool));
}

/**
 * Whether a gap actually STOPS a transition, as opposed to merely being reported.
 *
 * A waived gap is printed and does not stop anything — that is the owner's escape hatch. An advisory-mode
 * gap is printed and does not stop anything either. Everything else refuses.
 *
 * @param gap what {@link behaviouralProbeGap} found
 * @param mode the mode in force
 * @returns true when the caller must not proceed
 */
export function behaviouralProbeBlocks({
  gap,
  mode,
}: {
  gap: BehaviouralProbeGap;
  mode: BehaviouralProbeMode;
}): boolean {
  return gap.waiver === undefined && mode === "refuse";
}

/**
 * Whether one probe would FAIL if the owner's complaint recurred — the question the whole gate turns on.
 *
 * `present:`/`absent:`/`path:` are structural by construction: they read a file and match a substring, which
 * is the evidence the audit measured as green while the behaviour was wrong. Only a `command:` probe can
 * run the product, and only when what it runs is not itself an inspector.
 *
 * @param probe the parsed probe
 * @returns true when the probe asserts behaviour rather than shape
 */
export function isBehaviouralProbe({ probe }: { probe: Probe }): boolean {
  return probe.kind === "command" && !isStructuralCommand({ command: probe.command });
}

/**
 * What the gate found: an owner-ask doc with nothing that would fail if the complaint came back.
 *
 * @internal — exported only because it is {@link behaviouralProbeGap}'s return type; callers hand it straight
 *   back to {@link describeBehaviouralProbeGap} and {@link behaviouralProbeBlocks} rather than naming it.
 */
export interface BehaviouralProbeGap {
  /**
   * The owner-ask marker matched in the doc's summary, or `undefined` when it carries none.
   *
   * It no longer decides whether there is a gap — the trigger is unconditional (see the module header). It
   * survives only to sharpen the refusal: a doc quoting the owner gets told which phrase it quoted, which is
   * the difference between "write a probe" and "write a probe, because the owner asked for this".
   */
  readonly marker: string | undefined;
  /** The structural probes the doc does declare — empty when it declares none at all. */
  readonly structural: readonly Probe[];
  /**
   * The doc's recorded `probeWaiver:`, when it has one.
   *
   * Its presence turns the finding from a refusal into a stated exception: the gate reports it and stands
   * down. It is carried here rather than short-circuiting the gap so that a waived doc is still PRINTED —
   * a waiver nobody ever sees again is the silent `done` the whole rule exists to make visible.
   */
  readonly waiver: string | undefined;
}

/**
 * Whether a doc has no behavioural probe to hold its claim to.
 *
 * Status-agnostic on purpose: `handover finish` applies it at the moment of closing a run, when the doc still
 * says `in-progress`, while `handover lint` and `handover check` apply it to a doc that already says `done`.
 * Both are the same transition; only one of them has happened yet.
 *
 * @param summary read only to name the owner-ask phrase in the refusal; it no longer gates whether there is one
 * @param doneWhen the doc's parsed probes
 * @param probeWaiver the doc's recorded waiver, which turns a refusal into a stated exception
 * @param kind an `ask` row asks rather than claims, so there is nothing for a probe to falsify
 * @returns the gap, or `undefined` when the row already has a behavioural probe or is not a claim at all
 */
export function behaviouralProbeGap({
  summary,
  doneWhen,
  probeWaiver,
  kind,
}: {
  summary: string | undefined;
  doneWhen: readonly Probe[];
  probeWaiver: string | undefined;
  kind: BoardRowKind;
}): BehaviouralProbeGap | undefined {
  if (kind !== "doc") {
    return undefined;
  }
  if (doneWhen.some((probe) => isBehaviouralProbe({ probe }))) {
    return undefined;
  }
  return { marker: ownerAskMarker({ summary }), structural: doneWhen, waiver: probeWaiver };
}

/**
 * The owner-ask marker a summary carries, or `undefined`.
 *
 * @param summary the doc's `summary:` field — `undefined` for a doc that declared none, which never matches
 * @returns the first marker present, in {@link OWNER_ASK_MARKERS} order, as its words read lowercased with one space
 *   between them — `OWNER_ASK` and `owner-ask` both read `owner ask`
 */
export function ownerAskMarker({ summary }: { summary: string | undefined }): string | undefined {
  if (summary === undefined) {
    return undefined;
  }
  for (const pattern of OWNER_ASK_MARKERS) {
    const found = pattern.exec(summary);
    if (found !== null) {
      return found[0].toLowerCase().split(MARKER_SEPARATOR).join(" ");
    }
  }
  return undefined;
}

/** How a structural probe reads back to its author, so the refusal names the exact line that does not count. */
function probeLine({ probe }: { probe: Probe }): string {
  switch (probe.kind) {
    case "present":
    case "absent":
      return `${probe.kind}: ${probe.file}#${probe.symbol}`;
    case "path":
      return `path: ${probe.path}`;
    case "command":
      return `command: ${probe.command}`;
  }
}

/**
 * The refusal, as the lines a verb prints — naming the doc, the marker matched, what does not count, and
 * what a behavioural probe would look like instead.
 *
 * A refusal that only says no teaches an author to reach for the break-glass. This one is written so the
 * cheapest way past it is to write the probe, which is the whole point: it costs almost nothing at `done`
 * time, by the session that just proved the fix, and a morning to reconstruct three days later.
 *
 * @param slug the doc's slug, so the message names which doc is being refused
 * @param gap what {@link behaviouralProbeGap} found
 * @param verb the verb refusing, so the break-glass line is one the reader can paste
 * @param mode whether this is a refusal or an advisory — the same text either way, so the two modes cannot
 *   drift into saying different things about one rule
 * @returns the message lines, in print order
 */
export function describeBehaviouralProbeGap({
  slug,
  gap,
  verb,
  mode,
}: {
  slug: string;
  gap: BehaviouralProbeGap;
  verb: string;
  mode: BehaviouralProbeMode;
}): readonly string[] {
  const subject =
    gap.marker === undefined
      ? `${slug} declares no probe that would fail if its claim were false`
      : `${slug} records an owner ask ("${gap.marker}") with no behavioural probe`;
  if (gap.waiver !== undefined) {
    return [
      `${verb}: ${subject} — WAIVED.`,
      `  probeWaiver: ${gap.waiver}`,
      "  a waiver is a first-class answer, not a failed one: saying plainly that no probe can exist here is",
      "  the honest outcome this rule wants, and it is why the rule can afford to apply to every doc.",
      "  stated, not silent: every surface applying the rule prints it. Nothing was refused. Drop the waiver",
      "  the moment a probe becomes writable.",
    ];
  }
  const declared =
    gap.structural.length === 0
      ? ["  it declares no `doneWhen:` probe at all, so nothing re-asks the question after today"]
      : [
          "  these do not count — each one passes while the behaviour underneath it goes wrong:",
          ...gap.structural.map((probe) => `    - ${probeLine({ probe })}`),
        ];
  return [
    `${verb}: ${mode === "advise" ? "ADVISORY — " : ""}${subject}.`,
    "  two honest ways past this, and they are equal — write the probe, or record a waiver saying why one",
    "  cannot exist. What is not allowed is a `done` that nothing can ever contradict.",
    ...declared,
    "  add at least one `doneWhen: - command:` that RUNS what this doc claims and exits non-zero if the",
    "  claim stops being true — a verb, a --dry-run, a test, a read of live state. For example:",
    "    doneWhen:",
    "      - command: \"slopweaver <the verb this doc fixed> --dry-run | grep -q '<the behaviour claimed>'\"",
    "  three worked examples, real docs on the board: skills/handover/SKILL.md" +
      "#the-behavioural-probe--what-donewhen-must-actually-assert",
    "  measured: five owner-ask docs regressed on the exact complaint while every probe stayed green.",
    "  if no such command can exist — the work landed where this checkout cannot see it, or the seam has no",
    '  test lane yet — say so on the doc: `probeWaiver: "<why, in your own words>"`. It stays visible on the',
    "  board instead of passing silently, and it costs you nothing to prefer it over the break-glass below.",
    ...(mode === "advise"
      ? [`  advisory only — ${BEHAVIOURAL_PROBE_MODE_ENV} is set to advise, so nothing was refused`]
      : [`  to close THIS ONCE without recording anything: ${ALLOW_STRUCTURAL_PROBE}=1 <your command>`]),
  ];
}
