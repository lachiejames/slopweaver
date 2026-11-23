/**
 * Why `checkout sync`'s fast-forward did not complete — one typed union, so only a genuine divergence ever
 * reads "needs a human".
 *
 * Measured: every failed `git merge --ff-only` used to print "the branch has diverged and needs a
 * human", including a merge that failed only because another git process held `.git/index.lock`, on a trunk
 * with no local commits at all. The variants below are told apart by re-measuring the refs after the
 * failure (`classifyFailedFastForward`, `src/checkouts/sync.ts`), never by the bare exit.
 */

/** HEAD could not be read, before or after the fast-forward. */
export interface CheckoutHeadUnreadableError {
  readonly code: "HEAD_UNREADABLE";
  readonly message: string;
  readonly when: "after" | "before";
}

/** Both the branch and its upstream carry commits the other lacks: the one case a human must resolve. */
export interface CheckoutDivergedError {
  readonly code: "DIVERGED";
  readonly message: string;
  readonly upstream: string;
}

/** The merge failed and the ahead/behind count taken afterwards could not be read either. */
export interface CheckoutDriftUnreadableError {
  readonly code: "DRIFT_UNREADABLE";
  readonly message: string;
  readonly upstream: string;
}

/** Every attempt failed while the branch stayed a clean fast-forward of its upstream: transient, not divergent. */
export interface CheckoutFastForwardBusyError {
  readonly attempts: number;
  readonly code: "FAST_FORWARD_BUSY";
  readonly message: string;
  readonly upstream: string;
}

/** Every way a `checkout sync` fast-forward can fail. */
export type CheckoutSyncError =
  CheckoutDivergedError | CheckoutDriftUnreadableError | CheckoutFastForwardBusyError | CheckoutHeadUnreadableError;

export const CheckoutSyncErrors = {
  diverged: ({ upstream }: { upstream: string }): CheckoutDivergedError => ({
    code: "DIVERGED",
    message: `\`git merge --ff-only ${upstream}\` refused — the branch has diverged and needs a human`,
    upstream,
  }),
  driftUnreadable: ({ upstream }: { upstream: string }): CheckoutDriftUnreadableError => ({
    code: "DRIFT_UNREADABLE",
    message: `\`git merge --ff-only ${upstream}\` failed and the branch's drift from it could not be read, so whether it diverged is unknown — re-run \`slopweaver checkout sync\``,
    upstream,
  }),
  fastForwardBusy: ({ attempts, upstream }: { attempts: number; upstream: string }): CheckoutFastForwardBusyError => ({
    attempts,
    code: "FAST_FORWARD_BUSY",
    message: `\`git merge --ff-only ${upstream}\` failed ${String(attempts)} time(s) while the branch is still a clean fast-forward of it — another git process may be holding a lock in this checkout; re-run \`slopweaver checkout sync\``,
    upstream,
  }),
  headUnreadable: ({ when }: { when: "after" | "before" }): CheckoutHeadUnreadableError => ({
    code: "HEAD_UNREADABLE",
    message: when === "before" ? "HEAD could not be read" : "HEAD could not be read after the fast-forward",
    when,
  }),
} as const;
