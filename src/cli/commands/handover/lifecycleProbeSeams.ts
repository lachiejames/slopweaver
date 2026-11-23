/**
 * The probe evaluator a run-lifecycle verb hands `runContext` — which tree a doc's probes are read against, and
 * whether shell-backed probes may run at all. Split out of `./lifecycleRunCore.ts`, whose flag parsing and
 * ownership guards never touch a probe.
 */

import { commandProbeRunner } from "../../../handover/commandProbe.js";
import type { HandoverDoc } from "../../../handover/doc.js";
import { repoProbeSeams } from "../../../handover/evaluate.js";
import { evaluateProbes, outputProbes, type ProbeResult } from "../../../handover/probe.js";
import { type ProbeCheckout, probeCheckout, probeCheckoutNotice } from "../../../handover/probeCheckout.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";

/**
 * Read `--probed-tree`: which tree a caller proved before asking — the seat's own worktree, or the doc's repo.
 *
 * @param text the flag's value, absent when not given
 * @returns the tree, `undefined` when not given, or why the value is refused
 */
export function parseProbedTree({
  text,
}: {
  text: string | undefined;
}): Result<ProbeCheckout["kind"] | undefined, string> {
  if (text === undefined || text === "session-worktree" || text === "doc-repo") {
    return ok(text);
  }
  return err(`--probed-tree must be session-worktree or doc-repo, not "${text}"`);
}

/**
 * Build the probe evaluator for one invocation. `--probe` is what admits shell-backed probes.
 *
 * `provedTree` binds the probes to the tree a caller proved: `handover wake` classifies the tree and proves the
 * merge in it before it asks finish, and a path retargeted between that and this classification would have the
 * probes read a tree nobody proved. On a mismatch every probe reads not-evaluated, which
 * finish counts as residue and refuses — decided on the very classification the probes would have used.
 *
 * @param runCommands whether `--probe` was passed, admitting the probes that shell out
 * @param provedTree `--probed-tree`, the tree the caller proved; absent, any tree is read
 * @returns the evaluator that reads one doc's `doneWhen` and `outputs` probes
 */
export function lifecycleProbeSeams({
  provedTree,
  runCommands,
}: {
  provedTree?: ProbeCheckout["kind"] | undefined;
  runCommands: boolean;
}): (args: { doc: HandoverDoc }) => readonly ProbeResult[] {
  return ({ doc }) => {
    const probes = [...doc.doneWhen, ...outputProbes({ outputs: doc.outputs })];
    if (doc.repo === undefined) {
      // NOT an empty set. Returning `[]` made a doc with probes and no `repo:` look like a doc with nothing to
      // satisfy, so `finish` computed an empty residue and closed the run having evaluated nothing. Every probe
      // is reported as not-evaluated instead, which `residueOf` counts as residue and `finish` refuses.
      return probes.map((probe) => ({
        note: "the doc declares no `repo:`, so nothing could be resolved against it",
        outcome: "not-evaluated" as const,
        probe,
      }));
    }
    // The tree, not the doc's `repo:` — see {@link ../../../handover/probeCheckout} for the measured defect.
    // A lifecycle verb probes the ONE run this session holds, and that run's work lives in this session's
    // worktree, so the main checkout is both the wrong tree to read the work from and a tree whose
    // machine-local dirt this session cannot fix.
    const checkout = probeCheckout({ docRepo: doc.repo });
    if (provedTree !== undefined && checkout.kind !== provedTree) {
      return probes.map((probe) => ({
        note: `the caller proved the ${provedTree} tree, but these probes would read ${checkout.dir} (${checkout.kind})`,
        outcome: "not-evaluated" as const,
        probe,
      }));
    }
    const notice = probeCheckoutNotice({ checkout, docRepo: doc.repo });
    if (notice !== undefined) {
      logger.out({ line: notice });
    }
    return evaluateProbes({
      probes,
      seams: repoProbeSeams({
        repo: checkout.dir,
        runCommand: runCommands ? commandProbeRunner({ repo: checkout.dir }) : undefined,
      }),
    });
  };
}
