/**
 * The admission callback both `codex plan` and `codex review` ask before a pass is routed — the CLI shell's
 * half of the duplicate-pass gate, whose pure decision is `../../../codex/passAdmission.ts`.
 */
import type { ExactPassKey } from "../../../codex/duplicate.js";
import {
  ALLOW_DUPLICATE_CODEX_PASS_ENV,
  admitCodexPass,
  duplicateHatchOpen,
  type PassAdmission,
  reportAdmission,
} from "../../../codex/passAdmission.js";

/**
 * Ask admission whether a pass may run, at the moment it is about to.
 *
 * Asked when the pass's own turn comes rather than before the fan-out, which is the whole point for a
 * review: a property queued behind three others asks when its slot opens, so it sees any record those three
 * published while it was waiting. Asked before routing, the scratch workspace, the snapshot and the model
 * turn (`./passRoute.ts`), so a refusal costs nothing — not even a fleet read.
 *
 * A zero-parameter callback, so the shape carries no argument order to get wrong.
 */
export type PassAdmit = () => PassAdmission;

/**
 * The admission callback a pass asks when it starts — reading the ledger fresh each time.
 *
 * A CLOSURE over the roots rather than a precomputed decision, because `fanOutReview` runs properties
 * concurrently and a property that waited for a slot must see what finished while it waited.
 *
 * **The KEY is a thunk too, and that is a correction.** It was a value computed before the pass started, and
 * a Codex review pointed out what that means for a plan pass: the key names a HEAD, another process can
 * advance the branch between the capture and the admission, and the closure then refuses the pass at the NEW
 * HEAD using the OLD one's record — a pass that has never run, refused for being a duplicate of a different
 * commit. Building the key when admission is asked closes it. The review arm passes a constant thunk, and
 * correctly so: a review is keyed to a diff that was frozen before any of this.
 *
 * @param keyAt builds the pass's exact key AT admission time, or returns undefined when it cannot be keyed
 * @param orchestrationRoot `$SLOPWEAVER_HOME/orchestration`
 * @param repoRoot the checkout whose records count
 * @returns a zero-argument callback returning the admission decision
 */
export function admitFor({
  keyAt,
  orchestrationRoot,
  repoRoot,
}: {
  keyAt: () => ExactPassKey | undefined;
  orchestrationRoot: string;
  repoRoot: string;
}): PassAdmit {
  return () => {
    const admission = admitCodexPass({
      hatchOpen: duplicateHatchOpen({ env: process.env[ALLOW_DUPLICATE_CODEX_PASS_ENV], flag: false }),
      key: keyAt(),
      orchestrationRoot,
      repoRoot,
    });
    // An `unchecked` admission is reported HERE, at the moment it is made, and that is not tidiness. It does
    // not refuse, so nothing downstream ever sees it: `passRoute.ts` returns `refused` only for a duplicate,
    // and `reportInvocations` only reports refusals — so a Codex review found the module header promising a
    // loud stderr warning that no production path emitted. Logging belongs in this CLI shell rather than in
    // `orchestrate.ts`, which stays quiet by design.
    if (admission.kind === "unchecked") {
      reportAdmission({ admission });
    }
    return admission;
  };
}
