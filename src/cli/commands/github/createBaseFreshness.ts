/**
 * The creation door's two BASE gates, called from `./stackPushGates.ts` and split out purely to keep that
 * file under the repository's line-count ceiling — there is no other reason these live separately.
 *
 * Both ask about the same two refs and neither can substitute for the other. Freshness asks whether the base
 * moved past this head, by ancestry. Already-landed asks whether this head is already ON the base, by patch
 * id — the question a squash merge makes invisible to ancestry.
 */
import type { Result } from "../../../lib/result.js";
import type { PrTarget } from "../../../outbound/github/types.js";
import { printAlreadyLandedPermit } from "./alreadyLandedPermit.js";
import {
  type AlreadyLanded,
  type BaseFreshness,
  type BaseFreshnessAcknowledgement,
  printBaseFreshnessPermit,
  type QueueGate,
} from "./baseFreshnessCore.js";
import type { GithubVerbResult } from "./errors.js";
import { pushStandingDir } from "./pushCore.js";
import type { ReadQueueGate } from "./queueGateRun.js";

/** The remote both base gates measure against: a creation that named none measures `origin`. */
function measuredRemote({ args }: { args: { readonly remote?: string | undefined } }): string {
  const named = args.remote;
  if (named === undefined) {
    return "origin";
  }
  return named;
}

/**
 * Measure, print and gate base freshness — opportunistic, so a structurally-absent checkout or transport
 * SKIPS rather than refuses. Called BEFORE the token and the API write preflight, matching
 * `stackPushSend.ts`'s documented ordering — a synchronous `git fetch` between a pooled GET and the create
 * POST is what kills the socket, so nothing may open a client first.
 *
 * The base's merge queue is read AFTER that synchronous measurement and only when it answers `base-moved`,
 * which keeps both halves of that ordering: the `git fetch` has already finished when the first pooled
 * connection opens, and no write client exists yet. Creation refuses a base-moved head for the same reason
 * `push` did, and stops for the same reason — the queue tests the merged result on the tip, so the refusal
 * would charge a rebase and a whole gate lap for nothing. MEASURED live: the base moved between
 * a branch's own `github push` and the `stack push` that opened its pull request, so fixing only the push
 * door would leave the class standing one verb along.
 *
 * @param args the creation-side fields freshness needs: `cwd`, `remote` and the acknowledgement
 * @param target the pull request's routing fields
 * @param deps `measureBaseFreshness`, `cwd`, `out` and the optional queue read
 * @param home the state home holding the GitHub credential the queue read needs
 * @returns whether the caller must refuse
 */
async function createBaseFreshnessRefused({
  args,
  target,
  deps,
  home,
}: {
  args: {
    readonly cwd?: string | undefined;
    readonly remote?: string | undefined;
    readonly baseFreshnessAcknowledgement: BaseFreshnessAcknowledgement;
  };
  target: PrTarget;
  deps: {
    readonly cwd: () => string;
    readonly measureBaseFreshness: (args: {
      cwd: string;
      remote: string;
      target: PrTarget;
    }) => GithubVerbResult<BaseFreshness>;
    readonly out: (args: { line: string }) => void;
    readonly readQueueGate?: ReadQueueGate | undefined;
  };
  home: string;
}): Promise<boolean> {
  const freshness = deps.measureBaseFreshness({
    cwd: pushStandingDir({ args, deps }),
    remote: measuredRemote({ args }),
    target,
  });
  const moved = freshness.isOk() && freshness.value.kind === "base-moved";
  let queueGate: QueueGate | undefined;
  if (moved && deps.readQueueGate !== undefined) {
    queueGate = await deps.readQueueGate({ branch: target.base, home, repo: `${target.owner}/${target.repo}` });
  }
  return printBaseFreshnessPermit({
    acknowledgement: args.baseFreshnessAcknowledgement,
    measurement: freshness,
    out: deps.out,
    queueGate,
  });
}

/**
 * Measure, print and gate whether the head's work is already on the base — opportunistic in exactly the same
 * way freshness is, so a checkout, remote or git answer that is absent SKIPS rather than refuses.
 *
 * @param args the creation-side fields this needs: `cwd`, `remote` and the acknowledgement
 * @param target the pull request's routing fields, whose `base` is measured against
 * @param deps `measureAlreadyLanded`, `cwd` and `out`, the exact edges `StackPushGateDeps` declares
 * @returns whether the caller must refuse
 */
function createAlreadyLandedRefused({
  args,
  target,
  deps,
}: {
  args: {
    readonly cwd?: string | undefined;
    readonly remote?: string | undefined;
    readonly baseFreshnessAcknowledgement: BaseFreshnessAcknowledgement;
  };
  target: PrTarget;
  deps: {
    readonly cwd: () => string;
    readonly measureAlreadyLanded: (args: { cwd: string; remote: string; target: PrTarget }) => Result<AlreadyLanded>;
    readonly out: (args: { line: string }) => void;
  };
}): boolean {
  const measured = deps.measureAlreadyLanded({
    cwd: pushStandingDir({ args, deps }),
    remote: measuredRemote({ args }),
    target,
  });
  // An unreadable measurement is not a refusal here, for the reason `alreadyLandedRun.ts` states: this check
  // fails OPEN, always. Only a POSITIVE answer — every commit already patch-identical to the base — gates.
  if (measured.isErr()) {
    deps.out({ line: `already-landed check SKIPPED: ${measured.error.join("; ")}` });
    return false;
  }
  return printAlreadyLandedPermit({
    acknowledgement: args.baseFreshnessAcknowledgement,
    measurement: measured.value,
    out: deps.out,
  });
}

/**
 * Both base gates, in the one order they must run in, so the creation door calls one thing rather than two.
 *
 * Freshness first, deliberately: a base that has moved makes the already-landed answer describe a comparison
 * the caller did not ask for, and telling someone their branch is stale is more actionable than telling them
 * it duplicates a base they were about to rebase off anyway.
 *
 * @param args the creation-side fields both gates need: `cwd`, `remote` and the acknowledgement
 * @param target the pull request's routing fields
 * @param deps both measurements, `cwd`, `out` and the optional queue read
 * @param home the state home holding the GitHub credential the queue read needs
 * @returns whether the caller must refuse
 */
export async function createBaseGatesRefused({
  args,
  target,
  deps,
  home,
}: {
  args: {
    readonly cwd?: string | undefined;
    readonly remote?: string | undefined;
    readonly baseFreshnessAcknowledgement: BaseFreshnessAcknowledgement;
  };
  target: PrTarget;
  deps: {
    readonly cwd: () => string;
    readonly measureAlreadyLanded: (args: { cwd: string; remote: string; target: PrTarget }) => Result<AlreadyLanded>;
    readonly measureBaseFreshness: (args: {
      cwd: string;
      remote: string;
      target: PrTarget;
    }) => GithubVerbResult<BaseFreshness>;
    readonly out: (args: { line: string }) => void;
    readonly readQueueGate?: ReadQueueGate | undefined;
  };
  home: string;
}): Promise<boolean> {
  if (await createBaseFreshnessRefused({ args, deps, home, target })) {
    return true;
  }
  return createAlreadyLandedRefused({ args, deps, target });
}
