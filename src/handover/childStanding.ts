/**
 * The doc-side half of "a child must never work in the shared main checkout".
 *
 * The guards in `src/admit/` refuse the write; this refuses the INSTRUCTION. Measured
 * (`child-must-not-touch-the-main-checkout`): step 1 of the doc handed to ten spawned children told each of
 * them to `cd` into a shared main checkout and run a verb that resolves only there, because the package that
 * defines it lives on that checkout's long-lived branch and not on the base a worktree forks from. Nine
 * children came back out; one did all its work there, renamed the checkout's trunk branch to its own feature
 * name and committed on top. Two children independently reported the step as the reason.
 *
 * So the instruction that produced the incident was, read literally, correct — and that is the point. A doc
 * that hands a child a worktree and then hands it a command only reachable outside one has told the child to
 * leave, and no amount of care inside the child recovers from an instruction it is obeying. Catching it at
 * `handover lint` puts the refusal in front of the doc's AUTHOR, before any child is spawned.
 *
 * Scoped to FENCED CODE BLOCKS, deliberately and not as a simplification. A doc that RECOUNTS this incident
 * has to be able to name the instruction that caused it — this doc's own summary quotes `cd ~/dev/acme-admin`
 * in prose — and a rule that refuses the retrospective along with the instruction teaches authors to write
 * the history vaguely. What a child actually obeys is a command it can copy out of a fence, so that is what
 * is checked. A `cd` written as prose narration is left alone by construction.
 *
 * Pure: the caller reads the declared checkouts and the home directory and passes them in, so the rule is
 * testable against literal text rather than against the machine it runs on.
 */
import { resolve } from "node:path";

import { isUnderWorktrees } from "../worktree/location.js";

/**
 * One line of a doc that tells its reader to enter a protected main checkout.
 *
 * @internal the shape {@link mainCheckoutEntries} returns and {@link describeMainCheckoutEntries} reads —
 *   exported only because both of those are.
 */
export interface MainCheckoutEntry {
  /** The doc's 1-indexed line number. */
  readonly line: number;
  /** The literal `cd` target as written, before expansion. */
  readonly target: string;
  /** The declared main checkout it resolves into. */
  readonly checkout: string;
}

/**
 * Every `cd` target on one line, unwrapped from the quoting and markdown a doc writes them in.
 *
 * Deliberately regex-shallow, matching the static classifiers in `src/admit/`: it reads literal targets and
 * leaves anything built from an expansion alone. A doc that hides the path behind a shell variable is not
 * the failure this exists for — the failure is a plainly written `cd` an author and a child both read as
 * sanctioned.
 */
function cdTargets({ line }: { line: string }): readonly string[] {
  return [...line.matchAll(/(?:^|[\s`;&|(])cd\s+(["'`]?)([~/][^\s"'`;&|)]*)\1/g)].map((match) => match[2]!);
}

/**
 * Expand a leading `~` against a home directory. Everything else is returned resolved but unchanged.
 */
function expand({ target, home }: { target: string; home: string }): string {
  const bareTilde = target === "~";
  const underTilde = target.startsWith("~/");
  let expanded: string;
  if (bareTilde) {
    expanded = home;
  } else if (underTilde) {
    expanded = `${home}/${target.slice(2)}`;
  } else {
    expanded = target;
  }
  return resolve(expanded);
}

/**
 * Whether a resolved path enters a checkout rather than one of its own worktrees.
 *
 * A worktree lives UNDER the main checkout's directory (`<checkout>/.claude/worktrees.noindex/<slug>`, or
 * the `worktrees` alias a doc may still spell), so a plain prefix test would refuse the very instruction this
 * rule wants docs to give. The worktrees directory is therefore an explicit hole in the prefix, not an
 * accident of path shape.
 */
function entersCheckout({ path, checkout }: { path: string; checkout: string }): boolean {
  if (path !== checkout && !path.startsWith(`${checkout}/`)) {
    return false;
  }
  return !isUnderWorktrees({ checkout, path });
}

/**
 * Every line in a doc that instructs its reader into a declared main checkout.
 *
 * @param text the doc's raw markdown
 * @param declared the declared main checkouts, canonical absolute paths — an empty list finds nothing, which
 *   is the fail-open direction every main-checkout check in this repository takes
 * @param home the home directory a leading `~` expands against
 * @returns one entry per offending fenced line, in document order
 */
export function mainCheckoutEntries({
  text,
  declared,
  home,
}: {
  text: string;
  declared: readonly string[];
  home: string;
}): readonly MainCheckoutEntry[] {
  const entries: MainCheckoutEntry[] = [];
  let fenced = false;
  for (const [index, line] of text.split("\n").entries()) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) {
      continue;
    }
    for (const target of cdTargets({ line })) {
      const path = expand({ home, target });
      const checkout = declared.find((candidate) => entersCheckout({ checkout: candidate, path }));
      if (checkout !== undefined) {
        entries.push({ checkout, line: index + 1, target });
      }
    }
  }
  return entries;
}

/**
 * The refusal a doc gets when it tells a child to enter a main checkout.
 *
 * @param entries the offending lines
 * @returns the message lines, in order
 */
export function describeMainCheckoutEntries({ entries }: { entries: readonly MainCheckoutEntry[] }): readonly string[] {
  return [
    "runs a command that `cd`s into a declared main checkout — a doc that hands a child a worktree must not",
    "also hand it a command that only works outside one:",
    ...entries.map((entry) => `    line ${String(entry.line)}: cd ${entry.target}  →  ${entry.checkout}`),
    "  state what that command produces inline in the doc, or find a route that works from the worktree.",
  ];
}
