/**
 * `slopweaver handover lint` — the supervisor's own repair pass over a hand-authored doc.
 *
 * A handover doc is hand-written straight into `$SLOPWEAVER_HOME/handovers`; there is no code path that
 * writes one, so nothing has ever defaulted a missing `artifact:` at write time. `register-hygiene` then finds
 * it later, in the pre-push hook of whichever session pushes NEXT — see {@link ../../../devLint/registerHygiene}
 * — which is too late to be useful to the doc's own author and blocks a stranger's unrelated work instead.
 *
 * This is the tool to run right after hand-writing or hand-editing a doc, before that doc ever reaches a push:
 * it defaults `artifact: null` in place with `--fix`, and refuses — never guesses — when a doc's front-matter
 * is not clean enough to trust a splice into (see {@link ../../../handover/frontmatter}).
 *
 * It is also where a HAND EDIT to `status: done` is caught. Nothing in this repository writes that line — a
 * doc is set done by opening it in an editor — so `handover finish` cannot be the only place the
 * behavioural-probe gate stands; see {@link ../../../handover/behaviouralProbe} for the rule and the audit
 * that produced it. That check is reported, never fixed: `--fix` will not invent a probe, because a probe
 * nobody chose is exactly the shape-not-behaviour assertion the rule exists to refuse.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";

import { writeFileAtomic } from "#lib/writeAtomic.js";

import { declaredMainCheckoutPaths } from "../../../admit/declaredMainCheckouts.js";
import { slopweaverHome } from "../../../config.js";
import {
  ALLOW_STRUCTURAL_PROBE,
  type BehaviouralProbeMode,
  behaviouralProbeBlocks,
  behaviouralProbeGap,
  behaviouralProbeMode,
  describeBehaviouralProbeGap,
} from "../../../handover/behaviouralProbe.js";
import { describeMainCheckoutEntries, mainCheckoutEntries } from "../../../handover/childStanding.js";
import { parseHandoverDoc } from "../../../handover/doc.js";
import { ensureArtifactDefault } from "../../../handover/frontmatter.js";
import { scanBoard } from "../../../handover/store.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { booleanFlagsOf, type FlagSpec, parseFlags, stringFlagsOf } from "../../parseFlags.js";
import { withBoardRowLock } from "./boardRowLock.js";
import { resolveHandoverDir } from "./commandSupport.js";
import { mirrorAfterWrite } from "./mirrorAfterWrite.js";

/** How many argv entries precede a verb's own arguments. Four: `[node, cli, noun, verb, …]`. */
const VERB_ARG_OFFSET = 4;

/** The flags `handover lint` accepts. */
const LINT_FLAGS: FlagSpec = { boolean: ["fix"], string: ["doc", "dir", "home"] };

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_LINT_FLAG_NAMES: readonly string[] = [
  ...stringFlagsOf({ spec: LINT_FLAGS }),
  ...booleanFlagsOf({ spec: LINT_FLAGS }),
]
  .map((name) => `--${name}`)
  .toSorted();

const LINT_USAGE =
  "usage: slopweaver handover lint [--doc <path>] [--fix] [--dir <path>] [--home <dir>]\n" +
  "\n" +
  "Checks every doc's front-matter for a missing `artifact:` link — the hand-authoring safety net for\n" +
  "the register-hygiene gate a missing one reddens on every push, run BEFORE that doc ever reaches one.\n" +
  "It also REFUSES a `status: done` doc whose summary records an owner ask while no `doneWhen:` probe\n" +
  "would fail if the owner's complaint recurred — see the behavioural-probe rule in skills/handover/SKILL.md —\n" +
  "and a doc that tells its reader to `cd` into a main checkout `profile.json` declares.\n" +
  "`--doc` checks a single file; omitted, every doc under the handovers directory is checked.\n" +
  "\n" +
  "--fix  write `artifact: null` into each doc missing the key, in place. A doc whose front-matter\n" +
  "       cannot be parsed cleanly is refused and reported, never guessed at or partially rewritten.";

/**
 * Parse `handover lint` flags through the shared parser, so the help-truth ratchet can guard this verb like
 * any other.
 *
 * @param rest the argv after the noun and verb
 * @returns the parsed flags, or the errors
 */
export function parseHandoverLintArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ args: rest, spec: LINT_FLAGS });
}

/** One doc's lint outcome. */
export interface LintOutcome {
  readonly path: string;
  readonly kind:
    "sound" | "fixed" | "needsFix" | "refused" | "unreadable" | "unprobed" | "advisory" | "entersMainCheckout";
  readonly detail: string | undefined;
  /** The text to write, when the caller asked for `--fix` and there is a real change to apply. */
  readonly write: string | undefined;
}

/**
 * Decide what to do about one doc — pure, no filesystem. The caller (see {@link lintDoc}) is the only thing
 * that ever writes `write` back to disk, which is what keeps this branch matrix testable without one.
 *
 * @param path the doc's path, for the outcome's own record only
 * @param text the doc's raw text
 * @param fix whether the caller wants the fix actually applied
 * @returns the outcome, including the text to write when `fix` asked for one
 */
export function decideLint({ path, text, fix }: { path: string; text: string; fix: boolean }): LintOutcome {
  const applied = ensureArtifactDefault({ path, text });
  if (applied.isErr()) {
    return { detail: applied.error.message, kind: "refused", path, write: undefined };
  }
  if (!applied.value.changed) {
    return { detail: undefined, kind: "sound", path, write: undefined };
  }
  if (!fix) {
    return {
      detail: "missing `artifact:` — pass --fix to default it to `artifact: null`",
      kind: "needsFix",
      path,
      write: undefined,
    };
  }
  return { detail: "defaulted to `artifact: null`", kind: "fixed", path, write: applied.value.text };
}

/**
 * The behavioural-probe outcome for one doc, or none when the rule does not apply to it — pure, no filesystem.
 *
 * Scoped to `status: done` because that is the transition the owner ruled on. A doc still in flight is not
 * being refused anything yet; `handover finish` is what asks it the same question at the moment it closes.
 *
 * @param path the doc's path, for the outcome's own record only
 * @param text the doc's raw text
 * @param structuralAllowed the resolved break-glass — the same one `handover finish` reads, so the message's
 *   escape line is true at every surface that prints it rather than at one of them
 * @param mode whether the rule refuses (a `unprobed` outcome, which fails the run) or only advises (`advisory`,
 *   which is printed and does not change the exit code)
 * @returns the outcome, or `undefined` when the doc is not `done`, carries no owner-ask marker, already
 *   declares a behavioural probe, or the break-glass is set
 */
export function decideBehaviouralProbe({
  path,
  text,
  structuralAllowed,
  mode,
}: {
  path: string;
  text: string;
  structuralAllowed: boolean;
  mode: BehaviouralProbeMode;
}): LintOutcome | undefined {
  if (structuralAllowed) {
    return undefined;
  }
  const doc = parseHandoverDoc({ path, text });
  if (doc.status !== "done") {
    return undefined;
  }
  const gap = behaviouralProbeGap({
    doneWhen: doc.doneWhen,
    kind: doc.kind,
    probeWaiver: doc.probeWaiver,
    summary: doc.summary,
  });
  if (gap === undefined) {
    return undefined;
  }
  return {
    detail: describeBehaviouralProbeGap({ gap, mode, slug: doc.slug, verb: "handover lint" }).join("\n"),
    // A waived doc is REPORTED and does not fail the run. Reporting it is the point: the owner's hatch is an
    // exception on the record, and one nobody ever sees again is the silent `done` this rule exists to end.
    kind: behaviouralProbeBlocks({ gap, mode }) ? "unprobed" : "advisory",
    path,
    write: undefined,
  };
}

/**
 * The main-checkout-entry outcome for one doc, or none when it instructs no such thing — pure, no filesystem.
 *
 * Applies at EVERY status, unlike the behavioural-probe rule: a doc is dangerous while it is `ready` and
 * about to be handed to a child, not when it closes. Reported as a refusal rather than fixed, because the
 * repair is a judgement — state the command's output inline, or find a route that works from a worktree —
 * and `--fix` inventing either would be the shape-not-behaviour guess this verb already refuses to make.
 *
 * @param path the doc's path, for the outcome's own record only
 * @param text the doc's raw text
 * @param declared the declared main checkouts; empty finds nothing, the fail-open direction
 * @param home the home directory a leading `~` in the doc expands against
 * @returns the outcome, or `undefined` when the doc sends its reader nowhere protected
 */
export function decideMainCheckoutEntry({
  path,
  text,
  declared,
  home,
}: {
  path: string;
  text: string;
  declared: readonly string[];
  home: string;
}): LintOutcome | undefined {
  const entries = mainCheckoutEntries({ declared, home, text });
  if (entries.length === 0) {
    return undefined;
  }
  return {
    detail: describeMainCheckoutEntries({ entries }).join("\n"),
    kind: "entersMainCheckout",
    path,
    write: undefined,
  };
}

/** What one doc's lint is judged by, beside its path and text. */
interface LintJudgement {
  readonly fix: boolean;
  readonly structuralAllowed: boolean;
  readonly mode: BehaviouralProbeMode;
  readonly declared: readonly string[];
  readonly home: string;
}

/**
 * Lint one doc. Without `--fix` this judges the text the scan read and writes nothing. With it, the doc is re-read,
 * judged and its fix written atomically inside the row's one lock (`./boardRowLock.ts`), so a fix is never computed
 * from a scan another row writer has since overtaken, and never written over that writer's edit.
 */
function lintDoc({
  path,
  text,
  judgement,
}: {
  path: string;
  text: string;
  judgement: LintJudgement;
}): readonly LintOutcome[] {
  if (!judgement.fix) {
    return lintText({ judgement, path, target: undefined, text });
  }
  const locked = withBoardRowLock({
    path,
    write: ({ target }): readonly LintOutcome[] => {
      let fresh: string;
      try {
        fresh = readFileSync(target, "utf8");
      } catch (cause: unknown) {
        return [{ detail: `could not read it to fix: ${String(cause)}`, kind: "refused", path, write: undefined }];
      }
      return lintText({ judgement, path, target, text: fresh });
    },
  });
  if (locked.isErr()) {
    return [{ detail: locked.error.message, kind: "refused", path, write: undefined }];
  }
  return locked.value;
}

/** Lint one doc's text, writing the fix to `target` when {@link decideLint} asked for one and a target is given. */
function lintText({
  path,
  text,
  judgement,
  target,
}: {
  path: string;
  text: string;
  judgement: LintJudgement;
  target: string | undefined;
}): readonly LintOutcome[] {
  const { fix, structuralAllowed, mode, declared, home } = judgement;
  const trailing = [
    decideBehaviouralProbe({ mode, path, structuralAllowed, text }),
    decideMainCheckoutEntry({ declared, home, path, text }),
  ].filter((outcome): outcome is LintOutcome => outcome !== undefined);
  const outcome = decideLint({ fix, path, text });
  if (outcome.write === undefined || target === undefined) {
    return [outcome, ...trailing];
  }
  try {
    writeFileAtomic({ contents: outcome.write, path: target });
  } catch (cause) {
    return [
      { detail: `could not write the fix: ${String(cause)}`, kind: "refused", path, write: undefined },
      ...trailing,
    ];
  }
  return [outcome, ...trailing];
}

/** Every doc's raw text under a directory, paired with its path — read fresh, not through the parsed board. */
function docsUnder({ handoverDir }: { handoverDir: string }): {
  readonly readable: readonly { readonly path: string; readonly text: string }[];
  readonly unreadable: readonly string[];
} {
  const scan = scanBoard({ handoverDir });
  if (scan.isErr()) {
    return { readable: [], unreadable: [scan.error.message] };
  }
  const readable: { path: string; text: string }[] = [];
  const unreadable: string[] = [...scan.value.unreadable];
  for (const doc of scan.value.docs) {
    try {
      readable.push({ path: doc.path, text: readFileSync(doc.path, "utf8") });
    } catch {
      unreadable.push(doc.path);
    }
  }
  return { readable, unreadable };
}

/**
 * Mirror every document `--fix` rewrote into `board_row`.
 *
 * @param outcomes every outcome of this run; only a `fixed` one was written
 * @param home the state home whose board and store apply
 * @returns true when the verb must fail because a mirror did
 */
async function mirrorFixed({ outcomes, home }: { outcomes: readonly LintOutcome[]; home: string }): Promise<boolean> {
  let failed = false;
  for (const outcome of outcomes) {
    if (outcome.kind === "fixed" && outcome.write !== undefined) {
      failed = (await mirrorAfterWrite({ home, path: outcome.path, verb: "lint" })) || failed;
    }
  }
  return failed;
}

/** Print every outcome, and decide the exit code — clean or fully fixed is the only way out at zero. */
function report({ outcomes, unreadable }: { outcomes: readonly LintOutcome[]; unreadable: readonly string[] }): number {
  const actionable = outcomes.filter((outcome) => outcome.kind !== "sound");
  const docCount = new Set(outcomes.map((outcome) => outcome.path)).size;
  if (actionable.length === 0 && unreadable.length === 0) {
    logger.out({ line: `handover lint: ${String(docCount)} doc(s), all sound` });
    return EXIT_OK;
  }
  for (const outcome of actionable) {
    // Every non-`sound` outcome sets `detail` — see `decideLint`'s branches — so this is an honest assertion,
    // not a guess: only `sound` (filtered out of `actionable` above) ever leaves it unset.
    logger.error({ msg: `  ${outcome.path}  (${outcome.kind}) ${outcome.detail!}` });
  }
  for (const name of unreadable) {
    logger.error({ msg: `  ${name}  (unreadable)` });
  }
  const stillBroken = outcomes.some(
    (outcome) =>
      outcome.kind === "needsFix" ||
      outcome.kind === "refused" ||
      outcome.kind === "unprobed" ||
      outcome.kind === "entersMainCheckout",
  );
  return stillBroken || unreadable.length > 0 ? EXIT_ERROR : EXIT_OK;
}

/**
 * Lint (and optionally fix) one doc, or every doc under a handovers directory.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runHandoverLint(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: LINT_USAGE });
    return EXIT_OK;
  }
  const parsed = parseHandoverLintArgs({ rest });
  if (parsed.isErr()) {
    parsed.error.forEach((error) => {
      logger.error({ msg: error });
    });
    logger.error({ msg: LINT_USAGE });
    return EXIT_USAGE;
  }
  const fix = parsed.value.values["fix"] === true;
  const structuralAllowed = process.env[ALLOW_STRUCTURAL_PROBE] === "1";
  const mode = behaviouralProbeMode({ env: process.env });
  const declared = declaredMainCheckoutPaths();
  const judgement: LintJudgement = { declared, fix, home: homedir(), mode, structuralAllowed };
  const home = typeof parsed.value.values["home"] === "string" ? parsed.value.values["home"] : slopweaverHome();
  const docFlag = parsed.value.values["doc"];
  const singleDoc = typeof docFlag === "string" ? docFlag : undefined;
  if (singleDoc !== undefined) {
    let text: string;
    try {
      text = readFileSync(singleDoc, "utf8");
    } catch {
      logger.error({ msg: `handover lint: cannot read ${singleDoc}` });
      return EXIT_ERROR;
    }
    const outcomes = lintDoc({ judgement, path: singleDoc, text });
    const code = report({ outcomes, unreadable: [] });
    return (await mirrorFixed({ home, outcomes })) ? EXIT_ERROR : code;
  }
  const dir = typeof parsed.value.values["dir"] === "string" ? parsed.value.values["dir"] : undefined;
  const handoverDir = resolveHandoverDir({ dir, home });
  const { readable, unreadable } = docsUnder({ handoverDir });
  const outcomes = readable.flatMap(({ path, text }) => lintDoc({ judgement, path, text }));
  const code = report({ outcomes, unreadable });
  return (await mirrorFixed({ home, outcomes })) ? EXIT_ERROR : code;
}

export const handoverLintCommand = defineCommand({ run: runHandoverLint });
