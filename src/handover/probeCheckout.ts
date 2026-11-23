/**
 * WHICH TREE a doc's probes are answered against — the doc's `repo:`, or the linked worktree the session
 * running the verb is standing in.
 *
 * ## The defect this exists for
 *
 * A doc's `repo:` names the MAIN checkout, and every lifecycle verb resolved its probes there. So
 * `handover finish --probe` ran the doc's `command:` probes — in practice `yarn validate` — in a checkout no
 * session owns, and inherited whatever machine-local state was sitting in it. MEASURED on a row named
 * `finish-probe-runs-in-the-main-checkout-and-inherits-its-dirt`:
 *
 * - `register-hygiene` anchors on the module it loaded, so from the main checkout it reads `currentBranch:
 *   main` and every board doc naming that repo counts as relevant to the push — 62 blocking findings about
 *   OTHER sessions' docs. Reproduce both halves with:
 *   `yarn --cwd <main> tsx <main>/src/devLint/registerHygiene.entry.ts` (exit 1, 62 findings) against
 *   `yarn tsx src/devLint/registerHygiene.entry.ts` in a linked worktree (exit 0, the same 62 printed as
 *   advisory, "a different repo/branch than this push").
 * - `coverage-ratchet` reads `coverage/coverage-summary.json`, which is gitignored, per-checkout, and left
 *   behind by whichever partial `vitest` last ran in that tree. The main checkout held one reporting 1.03%
 *   branches against a 66% floor; the worktree had no `coverage/` at all, so the measured half correctly
 *   SKIPPED. Reproduce with `tsx src/devLint/coverageRatchet.entry.ts --summary-only` in each.
 *
 * Neither is a defect in the work being finished, and neither is fixable from the session that trips it —
 * so the row was forced through with `SLOPWEAVER_ALLOW_UNREVIEWED=1` naming both, which is exactly the
 * "probe proved nothing, so the gate got waived" outcome a probe exists to prevent.
 *
 * ## What it substitutes, and what it deliberately does not
 *
 * The substitution fires for the SINGLE-DOC lifecycle verbs only ({@link ../cli/commands/handover/lifecycleRunCore}),
 * because those probe the run THIS session holds and the work under it lives in this session's worktree —
 * a `present:` probe for a symbol this run is adding fails in the main checkout until it lands, which is
 * the same wrongness pointing the other way.
 *
 * `handover list`/`run` ({@link ../cli/commands/handover/probeSweep}'s `probeStates`) and the `register-hygiene`
 * gate are left resolving against `doc.repo`, on purpose: they probe EVERY doc on the board, including other
 * sessions' rows, and this session's feature branch is the wrong tree to answer those from. A board reading
 * every row off one session's branch would report about work that branch simply has not merged yet.
 *
 * Pure core / effectful shell: {@link classifyProbeCheckout} decides from facts and a comparison seam, so
 * the rule is testable without a git repository; {@link probeCheckout} is the thin edge that reads git.
 */

import { runningCheckoutRoot } from "#lib/gitRepo.js";
import { sameDirectory } from "#lib/sameDirectory.js";
import { mainCheckoutRoot } from "../worktree/shell.js";

/** Why a probe resolved where it did — the two answers, so a caller can say which tree it read. */
type ProbeCheckoutKind = "doc-repo" | "session-worktree";

/** The tree one doc's probes resolve against, and why. */
export interface ProbeCheckout {
  /** The directory `present:`/`absent:`/`path:` targets resolve against and `command:` probes run in. */
  readonly dir: string;
  /** Which of the two it is. */
  readonly kind: ProbeCheckoutKind;
}

/**
 * Decide which tree a doc's probes resolve against. Pure — every filesystem and git answer is an argument.
 *
 * The session's own worktree wins on exactly one shape: the caller is standing in a linked worktree whose
 * MAIN checkout is the doc's `repo:`. Every other shape falls back to `repo:` unchanged, and each falls back
 * because there is no positive evidence the caller holds a worktree of that repository — never because the
 * answer was merely unknown.
 *
 * `cwdRoot` is LAZY, and that is the rule rather than a style choice: `git rev-parse --show-toplevel` prints
 * `fatal: not a git repository` on a cwd outside one, and this decision is reached on every lifecycle verb.
 * Reading it eagerly would put a git error on the terminal of every verb legitimately run from outside a
 * checkout — a message about a case that is not one, which is the noise `../worktree/shell`'s own
 * `mainCheckoutRoot` already discards its stderr to avoid.
 *
 * @param cwdRoot the top level of the checkout the caller stands in, read only once the caller is known to be
 *   in a repository at all
 * @param cwdMainCheckout the main checkout of the repository the caller stands in, or `undefined` when the
 *   caller is not in one
 * @param samePlace how two directory paths are compared — injected so the rule is testable over literals
 * @returns the tree to resolve against, and which of the two it is
 */
export function classifyProbeCheckout({
  docRepo,
  cwdRoot,
  cwdMainCheckout,
  samePlace,
}: {
  docRepo: string;
  cwdRoot: () => string;
  cwdMainCheckout: string | undefined;
  samePlace: (args: { left: string; right: string }) => boolean;
}): ProbeCheckout {
  if (cwdMainCheckout === undefined) {
    return { dir: docRepo, kind: "doc-repo" };
  }
  if (!samePlace({ left: cwdMainCheckout, right: docRepo })) {
    return { dir: docRepo, kind: "doc-repo" };
  }
  const root = cwdRoot();
  // Standing in the doc's repo ITSELF. Substituting here would be a no-op that still claimed a worktree, and
  // a session legitimately running a verb from the main checkout must keep reading the tree it named.
  if (samePlace({ left: root, right: docRepo })) {
    return { dir: docRepo, kind: "doc-repo" };
  }
  return { dir: root, kind: "session-worktree" };
}

/**
 * {@link classifyProbeCheckout} against the real git and filesystem.
 *
 * @param cwd the directory the verb is running from; defaults to the process's own
 * @returns the tree this invocation's probes resolve against
 */
export function probeCheckout({ docRepo, cwd = process.cwd() }: { docRepo: string; cwd?: string }): ProbeCheckout {
  return classifyProbeCheckout({
    cwdMainCheckout: mainCheckoutRoot({ cwd }),
    cwdRoot: () => runningCheckoutRoot({ cwd }),
    docRepo,
    samePlace: sameDirectory,
  });
}

/**
 * The one line a verb prints when it moved a doc's probes off the tree the doc names.
 *
 * Silence here would be the worse half of the original defect wearing the other face: a probe that passes
 * against a tree the reader did not expect proves nothing they can check. Nothing is printed for the
 * unchanged case — a verb that says where it read on every single invocation is noise.
 *
 * `said` is the once-per-process ledger, and it is the rule rather than a nicety: a verb evaluates its probes
 * more than once per invocation, and MEASURED on the `handover ask` that parked this very run, the line
 * printed THREE times in one command. It is mutated here rather than by the caller so the "say it once"
 * decision lives with the sentence it governs, and a test drives it by passing its own set.
 *
 * @param checkout the resolved checkout
 * @param docRepo the doc's `repo:`, named so the reader sees which tree was NOT used
 * @param said lines already printed by this process, added to when this call returns one
 * @returns the line to print, or `undefined` when the doc's own repo was used or the line has been said
 */
export function probeCheckoutNotice({
  checkout,
  docRepo,
  said = SAID,
}: {
  checkout: ProbeCheckout;
  docRepo: string;
  said?: Set<string>;
}): string | undefined {
  if (checkout.kind === "doc-repo") {
    return undefined;
  }
  const line = `  probes resolve against this session's worktree ${checkout.dir}, not the main checkout ${docRepo}`;
  if (said.has(line)) {
    return undefined;
  }
  said.add(line);
  return line;
}

/** The default {@link probeCheckoutNotice} ledger: one process, one saying of each line. */
const SAID = new Set<string>();
