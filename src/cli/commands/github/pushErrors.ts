/**
 * The push and guard half of {@link GithubVerbErrors}: a base-freshness refusal and its remedy, a pre-push hook
 * that could not run or did not pass, and a remote that did not report what a push plan needs. Composed into
 * the one factory by `./errors.ts`; import that, not this. The push door's own refusals — a dirty working tree,
 * proof output in the head, a refusing gate — are `../../../admit/githubPushErrors.ts`.
 */
import type {
  GithubBaseFreshnessRefusedError,
  GithubFactRefusedError,
  GithubPrePushFailedError,
  GithubReadFailedError,
} from "./errors.js";

/** The factory methods for pushing and its guards, composed into `GithubVerbErrors`. */
export const githubPushErrorFactories = {
  forkHead: ({ head }: { head: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message: `${head} is a different-owner fork head`,
    subject: head,
  }),
  freshnessRefused: ({
    subject,
    detail,
    remedy,
    pairing,
  }: {
    subject: string;
    detail: string;
    remedy: readonly string[];
    pairing: string;
  }): GithubBaseFreshnessRefusedError => {
    const reasons = [
      `refused: ${subject}: ${detail}`,
      ...remedy,
      `accept with --acknowledge ${subject}${pairing}, or every finding with --acknowledge-all --reason "…"`,
    ];
    return { code: "BASE_FRESHNESS_REFUSED", message: reasons.join("; "), reasons, subject };
  },
  freshnessUnpaired: ({ subject, detail }: { subject: string; detail: string }): GithubBaseFreshnessRefusedError => {
    const reasons = [
      `refused: ${subject}: ${detail}`,
      `--acknowledge ${subject} must be paired with --reason "…" naming which deliberate re-land this is`,
    ];
    return { code: "BASE_FRESHNESS_REFUSED", message: reasons.join("; "), reasons, subject };
  },
  freshnessWarned: ({
    refusal,
    warning,
  }: {
    refusal: GithubBaseFreshnessRefusedError;
    warning: readonly string[];
  }): GithubBaseFreshnessRefusedError => {
    const reasons = [...refusal.reasons, ...warning];
    return { code: "BASE_FRESHNESS_REFUSED", message: reasons.join("; "), reasons, subject: refusal.subject };
  },
  hookExited: ({ hook, status }: { hook: string; status: number }): GithubPrePushFailedError => ({
    code: "PRE_PUSH_FAILED",
    hook,
    message: `${hook} exited ${String(status)}`,
  }),
  hookKilled: ({ hook, signal }: { hook: string; signal: string }): GithubPrePushFailedError => ({
    code: "PRE_PUSH_FAILED",
    hook,
    message: `${hook} was killed by ${signal} before it reached a verdict`,
  }),
  hookRunnerMissing: ({ hook }: { hook: string }): GithubPrePushFailedError => ({
    code: "PRE_PUSH_FAILED",
    hook,
    message:
      `${hook} exited 0 but printed "Can't find lefthook in PATH", so no gate ran and nothing was sent. ` +
      "The checkout has no node_modules for the hook to find lefthook in: run `yarn install` there, then push again.",
  }),
  hookTimedOut: ({ hook, timeoutMs }: { hook: string; timeoutMs: number }): GithubPrePushFailedError => ({
    code: "PRE_PUSH_FAILED",
    hook,
    message:
      `${hook} was still running after ${String(Math.round(timeoutMs / 60_000))} minutes, so it was stopped before ` +
      "it reached a verdict; nothing was sent. Look above for a prompt it was waiting on.",
  }),
  hookUnlocated: ({ cause }: { cause: string }): GithubPrePushFailedError => ({
    code: "PRE_PUSH_FAILED",
    hook: undefined,
    message: `could not locate the pre-push hook: ${cause}`,
  }),
  hookUnrunnable: ({ hook, cause }: { hook: string; cause: string }): GithubPrePushFailedError => ({
    code: "PRE_PUSH_FAILED",
    hook,
    message: `${hook} could not be run: ${cause}`,
  }),
  pushDefaultBranch: ({ defaultBranch }: { defaultBranch: string }): GithubFactRefusedError => ({
    code: "FACT_REFUSED",
    message: `the checked-out branch is the remote default (${defaultBranch}); this verb pushes pull-request branches only`,
    subject: defaultBranch,
  }),
  remoteDefaultUnreported: (): GithubReadFailedError => ({
    code: "READ_FAILED",
    message: "the remote did not report its default branch",
    subject: "HEAD",
  }),
  remoteShaInvalid: ({ ref }: { ref: string }): GithubReadFailedError => ({
    code: "READ_FAILED",
    message: `the remote reported an invalid SHA for ${ref}`,
    subject: ref,
  }),
} as const;
