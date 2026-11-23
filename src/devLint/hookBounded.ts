/**
 * The gate that keeps "every registered hook call is bounded by US" true of the NEXT entry, not only of the
 * ones standing today.
 *
 * ## The hole this closes
 *
 * `hooks/lib/bounded-run.sh` bounds a step a shim chose to bound, so coverage was a convention: a hook was
 * bounded where somebody had remembered to bound it, and `docs/hooks/registered-and-bounded.md` carried a paragraph explicitly
 * writing one entry off as uncovered. MEASURED (`slopweaver perf`) over the
 * `hook_cancelled` records two live seats wrote — the attachment type Claude Code writes when a hook did
 * not run to completion, carrying `timedOut`, `timeoutMs` and the command verbatim:
 *
 * ```bash
 * grep -h '"hook_cancelled"' ~/.claude/projects/*​/<session>.jsonl
 * ```
 *
 * `scripts/plugin-mirror-sync.sh` ended at 60158/60238/60079 ms against its declared 60000 with no `stderr`
 * at all — a `SessionStart` entry is a bare command with no shell in front of it, so nothing ever sourced a
 * bound. Adding `scripts/hook.sh` in front of every entry fixes that once; this gate is what stops the
 * eleventh entry being registered without it, which is exactly how the first five got there.
 *
 * ## The criterion, not a count
 *
 * Over every entry in every manifest `HOOK_MANIFESTS` names (`../canon/hookManifests.ts` — the shared
 * `hooks/hooks.json` and the Codex-only `hooks/codex-hooks.json`), four properties, each its own finding so a failure names which
 * one broke:
 *
 * 1. **It declares a `timeout`.** The harness default is 600 seconds; a hung hook is what an
 *    absent one costs (`src/__tests__/unit/context/hookTimeouts.test.ts` holds the ceilings, which stay
 *    that file's business — this gate reads presence, not size).
 * 2. **Its command routes through the one entry point.** The command's FIRST word, quotes stripped, ends
 *    in `scripts/hook.sh` — after a leading `SLOPWEAVER_HOOK_GIVE_UP=0|2`, the one prefix that can carry no work — with no
 *    command substitution anywhere in the command and no operator glued into that word, since the shell
 *    acts on both before the entry point can arm anything.
 * 3. **The timeout it passes as an argument equals the declared one.** The entry point takes the declared
 *    timeout as argv, because `hooks.json` is static text with no way to read its own field — so the
 *    duplication is real, and a drift between the two is a bound computed against a ceiling that is not
 *    there. This is the property the gate exists for; the other three are the shape around it.
 * 4. **The declared timeout leaves room for the ladder.** Under
 *    `HOOK_ENVELOPE_MIN_DECLARED_SECONDS` there is no room for a TERM, an escalation, a KILL and the runway
 *    the release needs before the harness fires, and `hook_envelope_term_at` answers empty — a hook that would run unbounded while
 *    looking wrapped.
 *
 * It does NOT prove the target is bounded INTERNALLY, and cannot: whether `scripts/pretooluse.sh` spends
 * its own budget correctly is behaviour, and `src/__tests__/subprocess/admit/hookBudget.test.ts` is what
 * settles that by wedging the shipped scripts and timing the release.
 *
 * Pure core / effectful shell: {@link hookBoundedFindings} takes the manifest text and the floor and
 * returns findings; {@link runHookBounded} reads the files and renders.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HOOK_MANIFESTS } from "../canon/hookManifests.js";
import { repoRootOf } from "../lib/gitRepo.js";
import { isRecord } from "../lib/parsers.js";

import { lintDeclarationFor } from "./refusal/registry.js";
import { gateOutcome, lintGateRefusal } from "./refusal/render.js";

/** The shell library the floor below is declared in, read rather than restated so the two cannot drift. */
const BOUNDED_RUN = "hooks/lib/bounded-run.sh";

/** The one entry point every command must route through, as a path suffix. */
const ENTRY_POINT_SUFFIX = "scripts/hook.sh";

/** One broken property, named so a reader knows which of the four it is. */
export interface HookBoundedFinding {
  /** The event the entry is registered under, e.g. `PreToolUse`. */
  readonly event: string;
  /** What is wrong, in one sentence a reader can act on. */
  readonly line: string;
}

/**
 * The minimum declared timeout `hooks/lib/bounded-run.sh` will arm an envelope for.
 *
 * Read out of the shell rather than restated here: the shell is what runs in production, so a constant
 * copied into TypeScript is a second source of truth that can be edited alone.
 *
 * @param text the contents of `hooks/lib/bounded-run.sh`
 * @returns the floor in seconds, or `undefined` when the declaration is not there to read
 */
export function envelopeMinDeclaredSeconds({ text }: { text: string }): number | undefined {
  const match = /^HOOK_ENVELOPE_MIN_DECLARED_SECONDS=(\d+)$/mu.exec(text);
  if (match?.[1] === undefined) {
    return undefined;
  }
  return Number(match[1]);
}

/** One registered entry, flattened out of the manifest's event → matcher → hooks nesting. */
interface Entry {
  readonly event: string;
  readonly command: string;
  readonly timeout: unknown;
}

/*
 * Every entry registered under ONE event, flattened out of its matcher groups.
 *
 * Split from the walk below because the three nested loops scored 17 against the cognitive-complexity
 * ceiling of 12, and the split is where the seam already was: one event's matchers in, that event's
 * entries out, `undefined` for a shape this does not read.
 */
function entriesUnder({ event, matchers }: { event: string; matchers: unknown }): Entry[] | undefined {
  if (!Array.isArray(matchers)) {
    return undefined;
  }
  const entries: Entry[] = [];
  for (const matcher of matchers) {
    if (!isRecord(matcher) || !Array.isArray(matcher["hooks"])) {
      return undefined;
    }
    for (const hook of matcher["hooks"]) {
      if (!isRecord(hook) || typeof hook["command"] !== "string") {
        return undefined;
      }
      entries.push({ command: hook["command"], event, timeout: hook["timeout"] });
    }
  }
  return entries;
}

/*
 * Flatten the manifest into one list of entries.
 *
 * Answers `undefined` rather than an empty list when the shape is not what this reads, so a caller can tell
 * "no entry broke a rule" from "nothing was checked" — a manifest this could not walk is an input the gate
 * never SAW, which is a fact to report and not a policy refusal to render.
 */
function entriesOf({ text }: { text: string }): readonly Entry[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed["hooks"])) {
    return undefined;
  }
  const entries: Entry[] = [];
  for (const [event, matchers] of Object.entries(parsed["hooks"])) {
    const under = entriesUnder({ event, matchers });
    if (under === undefined) {
      return undefined;
    }
    for (const one of under) {
      entries.push(one);
    }
  }
  return entries;
}

/*
 * The ONE leading assignment the entry point may carry: the door-gated row's `SLOPWEAVER_HOOK_GIVE_UP`, with a
 * value `scripts/hook.sh` knows. The shell acts on a prefix before `scripts/hook.sh` arms anything, so the
 * name is pinned as well as the value — `X=$(slow)` runs work in front of the bound, and so does an
 * innocent-looking `BASH_ENV=1`, which makes bash source a file named `1` before the script's first line.
 */
const LITERAL_ASSIGNMENT = /^SLOPWEAVER_HOOK_GIVE_UP=[02]$/u;

/*
 * A `$(…)`, backtick or process substitution ANYWHERE in the command: the shell expands the entry point's
 * path and every argument after it before `scripts/hook.sh` starts, so any of these is unbounded work in
 * front of the bound. `${…}` parameter expansion,
 * which every shipped path is built from, forks nothing.
 */
const COMMAND_SUBSTITUTION = /\$\(|`|[<>]\(/u;

/*
 * A control operator or redirection inside the entry point's own word: `true;slow;/p/scripts/hook.sh` has
 * no whitespace, ends in the right suffix, and runs `slow` first. One AFTER the call — the shipped
 * `>/dev/null 2>&1 || true` — runs once the bound has ended, so only this word is read for it.
 */
const OPERATOR_IN_ENTRY_WORD = /[;&|<>]/u;

/*
 * The first two words of a command after the one permitted assignment, with surrounding double quotes
 * stripped.
 *
 * Every command in the manifest opens with a quoted absolute path built out of `${PLUGIN_DATA…}`
 * substitutions, and the argument after it is the declared timeout this gate compares. Splitting on
 * whitespace is enough because neither of those two tokens can contain one: a path with a space would not
 * survive `hooks.json`'s own quoting either.
 */
function headOf({ command }: { command: string }): { readonly target: string; readonly declared: string } {
  const all = command.trim().split(/\s+/u);
  const firstNonAssignment = all.findIndex((word) => !LITERAL_ASSIGNMENT.test(word));
  const words = firstNonAssignment === -1 ? [] : all.slice(firstNonAssignment);
  // A command with fewer than two words has no target and no declared timeout to compare, and reading the
  // absent one as an empty string is the honest answer: both properties then fail and name themselves.
  const unquote = ({ word }: { word: string | undefined }): string => {
    if (word === undefined) {
      return "";
    }
    return word.replaceAll('"', "");
  };
  return { declared: unquote({ word: words[1] }), target: unquote({ word: words[0] }) };
}

/*
 * Every property broken by ONE entry. Split out of the fold so each of the four reads as its own sentence
 * rather than as a branch of a condition.
 */
function findingsForEntry({ entry, floorSeconds }: { entry: Entry; floorSeconds: number }): HookBoundedFinding[] {
  const found: HookBoundedFinding[] = [];
  const { target, declared } = headOf({ command: entry.command });
  if (!target.endsWith(ENTRY_POINT_SUFFIX)) {
    found.push({
      event: entry.event,
      line: `${entry.event}: the command runs \`${target}\` directly, so nothing in front of it sources a bound`,
    });
  } else if (COMMAND_SUBSTITUTION.test(entry.command) || OPERATOR_IN_ENTRY_WORD.test(target)) {
    found.push({
      event: entry.event,
      line:
        `${entry.event}: the command runs a command substitution or chains a command into \`${target}\`, ` +
        `which the shell does before scripts/hook.sh can source a bound`,
    });
  }
  if (typeof entry.timeout !== "number") {
    found.push({
      event: entry.event,
      line: `${entry.event}: the entry declares no \`timeout\`, so the harness's own default of 600 seconds applies`,
    });
    return found;
  }
  if (entry.timeout < floorSeconds) {
    found.push({
      event: entry.event,
      line:
        `${entry.event}: a declared timeout of ${String(entry.timeout)}s leaves no room for the ladder, ` +
        `which needs ${String(floorSeconds)}s`,
    });
  }
  if (target.endsWith(ENTRY_POINT_SUFFIX) && declared !== String(entry.timeout)) {
    found.push({
      event: entry.event,
      line:
        `${entry.event}: the entry point is passed \`${declared}\` while the entry declares ` +
        `${String(entry.timeout)}, so the bound is computed against a ceiling that is not there`,
    });
  }
  return found;
}

/**
 * Every entry in the manifest that is not bounded by construction.
 *
 * @param manifestText the contents of `hooks/hooks.json`
 * @param floorSeconds the shortest declared timeout the ladder fits inside
 * @returns one finding per broken property, or `undefined` when the manifest could not be walked at all
 */
export function hookBoundedFindings({
  manifestText,
  floorSeconds,
}: {
  manifestText: string;
  floorSeconds: number;
}): readonly HookBoundedFinding[] | undefined {
  const entries = entriesOf({ text: manifestText });
  if (entries === undefined) {
    return undefined;
  }
  return entries.flatMap((entry) => findingsForEntry({ entry, floorSeconds }));
}

/**
 * Judge every hook manifest a host reads, prefixing each finding with its manifest.
 *
 * @param root the checkout root
 * @param floorSeconds the envelope's minimum declared timeout
 * @returns the findings and the entry count, or `undefined` once a manifest could not be judged — printed here
 */
function judgeManifests({
  root,
  floorSeconds,
}: {
  root: string;
  floorSeconds: number;
}): { readonly entries: number; readonly findings: readonly HookBoundedFinding[] } | undefined {
  const findings: HookBoundedFinding[] = [];
  let entries = 0;
  for (const manifest of HOOK_MANIFESTS) {
    let manifestText: string;
    try {
      manifestText = readFileSync(join(root, manifest), "utf8");
    } catch (error: unknown) {
      // devlint: not-a-refusal -- a manifest the gate could not read is one whose entries it never checked,
      // so this reports the missing reading rather than claiming a rule caught something
      process.stderr.write(`  hook-bounded: cannot read the hook manifest ${manifest}: ${String(error)}\n`);
      return undefined;
    }
    const found = hookBoundedFindings({ floorSeconds, manifestText });
    if (found === undefined) {
      // devlint: not-a-refusal -- the manifest parsed to a shape this gate does not read, so no entry was
      // ever judged; reporting that is honest where four policy lines would not be
      process.stderr.write(`  hook-bounded: ${manifest} is not the event → matcher → hooks shape this reads\n`);
      return undefined;
    }
    for (const finding of found) {
      findings.push({ ...finding, line: `${manifest}: ${finding.line}` });
    }
    entries += entriesOf({ text: manifestText })!.length;
  }
  return { entries, findings };
}

/**
 * Fail when a registered hook can run without the envelope.
 *
 * @returns 0 when every entry is bounded by construction, else 1
 */
export function runHookBounded(): number {
  const root = repoRootOf({ importMetaUrl: import.meta.url });
  let boundedRunText: string;
  try {
    boundedRunText = readFileSync(join(root, BOUNDED_RUN), "utf8");
  } catch (error: unknown) {
    // devlint: not-a-refusal -- the floor's source could not be read, so no entry was ever judged
    process.stderr.write(`  hook-bounded: cannot read ${BOUNDED_RUN}: ${String(error)}\n`);
    return 1;
  }

  const floorSeconds = envelopeMinDeclaredSeconds({ text: boundedRunText });
  if (floorSeconds === undefined) {
    // devlint: not-a-refusal -- the floor the fourth property is judged against is not there to read, so
    // the gate has no criterion rather than a broken one
    process.stderr.write(`  hook-bounded: ${BOUNDED_RUN} declares no HOOK_ENVELOPE_MIN_DECLARED_SECONDS\n`);
    return 1;
  }

  const judged = judgeManifests({ floorSeconds, root });
  if (judged === undefined) {
    return 1;
  }
  const { entries, findings } = judged;

  if (gateOutcome({ refused: findings.length, unseen: 0 }) === "clean") {
    process.stdout.write(
      `hook-bounded: clean (${String(entries)} registered entry(s) across ${String(HOOK_MANIFESTS.length)} ` +
        `manifest(s), every one wrapped by ${ENTRY_POINT_SUFFIX})\n`,
    );
    return 0;
  }

  for (const finding of findings) {
    process.stderr.write(`  ${finding.line}\n`);
  }
  process.stderr.write(
    `${lintGateRefusal({
      declaration: lintDeclarationFor({ id: "hook-bounded" }),
      detail: `${String(findings.length)} unbounded registration(s)`,
    })}\n`,
  );
  return 1;
}
