/**
 * The labels the `dev gate`'s kind-label check judges, read LIVE from GitHub in CI rather than from the event that
 * started the run.
 *
 * WHY LIVE. `slopweaver github stack push` creates a pull request and only then adds its kind label, because
 * GitHub's create call takes no labels. So the `opened` event that starts the body gate always carries an empty
 * label list, and judging that payload failed `KIND_LABEL_MISSING` on every pushed pull request — a red run the
 * `labeled` rerun replaced moments later, which still held GitHub's rollup on the head at FAILURE until every leg
 * ended. The gate step runs after checkout and the dependency install, which is long after the label lands, so a
 * read made there sees the label the event could not carry.
 *
 * The race is NARROWED, not closed: nothing orders the label before the read. A push whose create-to-label window
 * outlasts the job's setup, or a setup made fast enough to beat it, still reads no label, and that run still ends
 * red exactly as before; the `labeled` rerun is still what clears it. Nothing here weakens the check: a pull
 * request with no kind label reads an empty list and fails.
 *
 * Fail closed: a pull-request run whose context is incomplete, or whose one read fails, is its own named red —
 * never a fallback to the event's labels and never a retry loop. A local run (no `PR_NUMBER`) reads nothing and the
 * kind-label check is skipped, as it always was; an ambient `GITHUB_TOKEN` alone never makes a local run go to the
 * network.
 *
 * The token is read once from the step's environment and handed to the client as its auth; nothing here prints it,
 * puts it on a command line or writes it anywhere.
 */
import { parseRepositorySlug } from "../config.js";
import { issueLabelsOnceVia } from "../corpus/github/labels.js";
import { makeGithubWriteCtx } from "../corpus/github/writeCtx.js";
import type { IngestError } from "../lib/ingestError.js";
import { err, errAsync, ok, okAsync, type Result, type ResultAsync } from "../lib/result.js";
import { githubWritePrivacy } from "../outbound/github/writePrivacy.js";

/** The pull-request run is missing, or carries a malformed, piece of what the live read needs. */
export interface PrLabelContextInvalidError {
  readonly code: "PR_LABEL_CONTEXT_INVALID";
  readonly message: string;
}

/** The one live read of the pull request's labels failed. */
export interface PrLabelsReadFailedError {
  readonly code: "PR_LABELS_READ_FAILED";
  readonly message: string;
  /** The HTTP status GitHub answered, when the failure carried one. */
  readonly status: number | undefined;
}

/** Why the gate could not learn the pull request's labels. */
export type DevGatePrLabelsError = PrLabelContextInvalidError | PrLabelsReadFailedError;

/** The factories for {@link DevGatePrLabelsError}. */
export const DevGatePrLabelsErrors = {
  contextInvalid: ({ problem }: { problem: string }): PrLabelContextInvalidError => ({
    code: "PR_LABEL_CONTEXT_INVALID",
    message: `PR_LABEL_CONTEXT_INVALID: the pull request's labels cannot be read live — ${problem}`,
  }),
  readFailed: ({ cause }: { cause: IngestError }): PrLabelsReadFailedError => {
    const answered = cause.status === undefined ? `failed (${cause.kind})` : `answered ${String(cause.status)}`;
    return {
      code: "PR_LABELS_READ_FAILED",
      message: `PR_LABELS_READ_FAILED: the live read of the pull request's labels (${cause.operation}) ${answered}; re-run the job`,
      status: cause.status,
    };
  },
} as const;

/** Where a pull request's labels are read from: nowhere on a local run, or GitHub for one pull request. */
type PrLabelContext =
  | { readonly kind: "local" }
  | {
      readonly kind: "pull-request";
      readonly token: string;
      readonly owner: string;
      readonly repo: string;
      readonly number: number;
    };

/** The one live read, injected so the contract is tested with a plain fake rather than the network. */
export type ReadPrLabels = (input: {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}) => ResultAsync<readonly string[], IngestError>;

/** A variable's value when it holds more than whitespace, otherwise undefined. */
function present({ value }: { value: string | undefined }): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }
  return value;
}

/**
 * Decide, from the step's environment, whether this run reads labels and from which pull request. `PR_NUMBER`
 * decides the mode: unset is a local run; SET, blank included, it must be a positive whole number, with an
 * `owner/repo` in `PR_REPOSITORY` and a `GITHUB_TOKEN`, and any of them missing or malformed is its own named
 * error, never a local run or an empty label list — a blank number in CI fails closed.
 *
 * @param env the step's environment
 * @returns the context, or what is missing from it
 */
function prLabelContextFromEnv({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): Result<PrLabelContext, PrLabelContextInvalidError> {
  const rawNumber = env["PR_NUMBER"];
  if (rawNumber === undefined) {
    return ok({ kind: "local" });
  }
  const digits = rawNumber.trim();
  const number = Number(digits);
  if (!/^[1-9][0-9]*$/.test(digits) || !Number.isSafeInteger(number)) {
    return err(DevGatePrLabelsErrors.contextInvalid({ problem: `$PR_NUMBER is not a pull request number` }));
  }
  const slug = present({ value: env["PR_REPOSITORY"] });
  const repository = slug === undefined ? undefined : parseRepositorySlug({ slug });
  if (repository === undefined || repository.isErr()) {
    return err(DevGatePrLabelsErrors.contextInvalid({ problem: "$PR_REPOSITORY is not an owner/repo" }));
  }
  const token = present({ value: env["GITHUB_TOKEN"] });
  if (token === undefined) {
    return err(DevGatePrLabelsErrors.contextInvalid({ problem: "$GITHUB_TOKEN is not set on the gate step" }));
  }
  return ok({ kind: "pull-request", number, owner: repository.value.owner, repo: repository.value.repo, token });
}

/**
 * The labels the kind-label check judges: undefined on a local run, so the check is skipped; the pull request's
 * CURRENT labels in CI, an empty list included, which the check then judges.
 *
 * @param env the step's environment
 * @param read the one live read
 * @returns the labels, undefined locally, or why they could not be learned
 */
export function labelsForDevGate({
  env,
  read,
}: {
  env: Readonly<Record<string, string | undefined>>;
  read: ReadPrLabels;
}): ResultAsync<readonly string[] | undefined, DevGatePrLabelsError> {
  const context = prLabelContextFromEnv({ env });
  if (context.isErr()) {
    return errAsync(context.error);
  }
  if (context.value.kind === "local") {
    return okAsync(undefined);
  }
  const { token, owner, repo, number } = context.value;
  return read({ number, owner, repo, token }).mapErr((cause) => DevGatePrLabelsErrors.readFailed({ cause }));
}

/**
 * The production read: one `issues.get` through the GitHub write lane's client, whose SDK retries are off, under
 * `retryMode: "never"`. A GET is never judged by the lane's outbound privacy check, which judges only a write.
 *
 * @param home the state home the lane's client is built against
 * @returns the read {@link labelsForDevGate} takes
 */
export function githubPrLabelsReader({ home }: { home: string }): ReadPrLabels {
  return ({ token, owner, repo, number }) =>
    issueLabelsOnceVia({
      ctx: makeGithubWriteCtx({ privacy: githubWritePrivacy({ home }), token }),
      input: { number, owner, repo },
    }).map((state) => state.labels);
}
