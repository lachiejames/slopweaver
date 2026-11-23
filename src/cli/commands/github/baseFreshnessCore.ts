/**
 * The pure decisions behind base-freshness enforcement on `github push` and `github stack push`.
 *
 * Scope is deliberately narrow: this measures the local head against the remote's DEFAULT branch tip, never
 * an existing pull request's actual base — resolving "this branch's real open PR and its real base" is a
 * materially bigger problem, explicitly deferred. Refuses loudly on `base-moved` or an unmeasurable result,
 * with an escape hatch: `--acknowledge base-moved` / `--acknowledge base-unmeasurable`, or
 * `--acknowledge-all --reason "..."` — the exact idiom `github merge` already uses, chosen over an
 * unescapable hard block because the owner's standing principle is "fail hard and loudly, but always leave
 * an explicit escape hatch."
 *
 * A measured `base-moved` includes a shallow clone's false negative (`git merge-base --is-ancestor` honors
 * the shallow boundary and can report "not an ancestor" even when the real history says otherwise) — that is
 * exactly why this is escapable rather than a dead end.
 *
 * ## The queue relaxation
 *
 * A `base-moved` refusal costs the author a rebase and a whole `yarn validate` lap, and on a base with a
 * native merge queue that lap is racing a race it need not win: the queue tests the MERGED result against
 * the tip plus everything ahead of it, so the local lap was never what protected the base. Measured
 * across three consecutive laps: three different innocent files timing out under fleet load, every one
 * green alone, while the base advanced under each of them.
 *
 * So a `base-moved` head is PERMITTED, without an acknowledgement, when both hold: the base branch has a
 * merge queue that requires at least one status-check context (an empty set means the queue merges on
 * arrival without testing anything — see `RequiredCheckContexts` in `../../../live/github/branchProtection.js`),
 * and the base has advanced no further than {@link QUEUE_GATED_BASE_DRIFT} commits past this head. Both
 * halves are positive evidence: with the queue unread, or the drift unmeasured, the refusal stands exactly
 * as it did, so nothing here can relax a gate by failing to look.
 *
 * ## The staleness advisory is not a gate and never becomes one
 *
 * {@link behindBaseAdvisory} prints how far behind its base the worktree is, above every verdict this file
 * renders. It is the owner's ruling on the stale-tree class and is deliberately the CHEAP half:
 * visibility in the output an agent already reads, never a block. Everything about the refusal above it is
 * unchanged — see that function's own header for why it lives on the printer rather than on the permit.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { RevertedPath } from "../../../outbound/github/mergeGuard.js";
import { type BaseMovedLane, baseMovedRemedy } from "../../../outbound/github/mergeHold.js";
import { type GithubBaseFreshnessRefusedError, GithubVerbErrors, type GithubVerbResult } from "./errors.js";

/** The acknowledgement subject naming a base that has moved since the local head was cut. */
export const BASE_MOVED_ACK = "base-moved";
/** The acknowledgement subject naming a base freshness check this tool could not run to completion. */
export const BASE_UNMEASURABLE_ACK = "base-unmeasurable";
/**
 * The acknowledgement subject naming a head whose every commit is already patch-identical to the base.
 *
 * Unlike the two above, this one REQUIRES `--reason`. There are exactly three shapes that are patch-identical
 * to the base by design — a revert of a revert, a re-land after a bad merge was backed out, and a forward
 * cherry-pick of a landed fix onto a release branch — and which of the three this is decides whether a
 * reviewer should be worried. A bare acknowledgement would record that the author saw the refusal and nothing
 * about why they were right to pass it.
 */
export const ALREADY_LANDED_ACK = "already-landed";

/** What the caller accepted, parsed from `--acknowledge`/`--acknowledge-all`/`--reason`. */
export interface BaseFreshnessAcknowledgement {
  readonly acknowledge: readonly string[];
  readonly acknowledgeAll: boolean;
  readonly reason: string | undefined;
}

/** One base-freshness measurement's outcome. */
export type BaseFreshness =
  | {
      readonly kind: "fresh";
      readonly baseBranch: string;
      readonly baseSha: string;
      readonly headSha: string;
      /** The Git remote `baseBranch` was fetched from — the measurement is the only thing that knows it, and
       *  {@link behindBaseLines} names `<remote>/<baseBranch>` rather than assuming `origin`. */
      readonly remote: string;
      /** Paths whose content on head is one base's own history once held. See `revertedFilesWarning` below
       *  — this is printed, never gated, so it never needs an acknowledgement. */
      readonly reverted: readonly RevertedPath[];
    }
  | {
      readonly kind: "base-moved";
      readonly baseBranch: string;
      readonly baseSha: string;
      readonly headSha: string;
      /** The Git remote `baseBranch` was fetched from. See the `fresh` arm's own note. */
      readonly remote: string;
      readonly reverted: readonly RevertedPath[];
      /**
       * How many commits the base carries that this head does not — the drift the queue relaxation is
       * bounded by. `undefined` when the count could not be taken, which keeps the refusal standing rather
       * than relaxing it: an unmeasured drift is never inside a bound.
       */
      readonly behindBy: number | undefined;
    }
  /** The check structurally could not run — no checkout, no Git transport, a different-owner fork head. Not
   * a failure: this is the explicitly supported token-only path, so it is never itself a refusal subject. */
  | { readonly kind: "skipped"; readonly why: string };

/**
 * What the base branch's native merge queue gates on, when a caller could read one.
 *
 * `contexts` empty is a real state rather than a missing read: a queue whose branch requires no status
 * check merges an entry on arrival without testing the merged result, so it protects nothing and cannot
 * stand in for the lap it would be excusing.
 */
export interface QueueGate {
  readonly branch: string;
  /** The queue's own page on GitHub, printed as the evidence behind an accepted `base-moved`. */
  readonly url: string;
  readonly contexts: readonly string[];
}

/**
 * How far the base may have advanced past a head before the queue relaxation stops applying.
 *
 * It bounds how STALE a local lap may be, and is never a safety property: the queue is what makes any drift
 * safe at all. So the failure mode to size against is a bound so TIGHT it refuses an ordinary cycle and
 * charges the rebase-and-revalidate lap this whole relaxation exists to remove.
 *
 * MEASURED over 400 consecutive commits on `origin/main`, by rolling window:
 * 30 min held at most 5, 1 h at most 6 (p95 5), 90 min at most 9, 2 h at most 11 (p95 8), 3 h at most 15,
 * 6 h at most 24. Re-measure any window, in seconds, with:
 *
 *   git log origin/main -400 --format=%ct | sort -n | awk -v w=10800 '{t[NR]=$1} END{for(i=1;i<=NR;i++){j=i; while(j<=NR && t[j]-t[i]<=w) j++; if(j-i>m) m=j-i} print m}'
 *
 * 16 clears the 3-hour worst case of 15, so a lap that took three hours at the busiest cadence this tree has
 * seen still lands, while a base half a day past the head (6 h worst case 24) is still refused.
 *
 * **The first draft was 8, and this branch's own pull request is why it is not.** 8 was sized off the
 * 30-minute window alone, on the assumption that a lap is the only thing that elapses. Measured live while
 * landing this: the gate lap ran 688 s, and by the time the creation door checked, the base was **7**
 * commits past the head — one short of refusing the fix for the very race it removes. A cycle is a gate lap
 * PLUS a push PLUS a create, and it is the cycle that has to fit under the bound.
 */
export const QUEUE_GATED_BASE_DRIFT = 16;

/** Whether the queue relaxation applies to one `base-moved` measurement, and why when it does not. */
export type QueueRelaxation =
  | { readonly kind: "accepted"; readonly lines: readonly string[] }
  | { readonly kind: "not-applicable"; readonly why: string };

/**
 * Decide whether a `base-moved` head is permitted anyway because the base's merge queue already tests it.
 *
 * Every arm below is a POSITIVE check. An absent queue read, an absent required-context set and an
 * unmeasured drift each answer `not-applicable`, so the ordinary refusal stands whenever this could not
 * establish that the queue is doing the work.
 *
 * @param freshness the `base-moved` measurement, already narrowed by the caller
 * @param queueGate what the base branch's queue gates on, or `undefined` when it could not be read
 * @returns the accepted lines, or why the relaxation does not apply to this measurement
 */
export function queueGatedBaseMoved({
  freshness,
  queueGate,
}: {
  freshness: Extract<BaseFreshness, { readonly kind: "base-moved" }>;
  queueGate: QueueGate | undefined;
}): QueueRelaxation {
  if (queueGate === undefined) {
    return { kind: "not-applicable", why: "the base branch's merge queue could not be read" };
  }
  if (queueGate.contexts.length === 0) {
    return {
      kind: "not-applicable",
      why:
        `${queueGate.branch}'s queue requires NO status-check contexts, so it would merge an entry on ` +
        "arrival without testing the merged result",
    };
  }
  if (freshness.behindBy === undefined) {
    return { kind: "not-applicable", why: "how far the base has advanced past this head could not be counted" };
  }
  if (freshness.behindBy > QUEUE_GATED_BASE_DRIFT) {
    return {
      kind: "not-applicable",
      why:
        `${queueGate.branch} is ${String(freshness.behindBy)} commits past this head, beyond the ` +
        `${String(QUEUE_GATED_BASE_DRIFT)}-commit bound a queue-gated base is accepted within`,
    };
  }
  return {
    kind: "accepted",
    lines: [
      `base freshness: base-moved ACCEPTED — ${queueGate.branch} is ${String(freshness.behindBy)} commit(s) ` +
        `past ${freshness.headSha} (bound ${String(QUEUE_GATED_BASE_DRIFT)}), and its merge queue gates on ` +
        `${queueGate.contexts.join(", ")}, so the merged result is tested against the tip before it lands`,
      `do NOT rebase and rerun the gate for this: land it with \`slopweaver github enqueue\` — ${queueGate.url}`,
    ],
  };
}

/**
 * Whether a head's own commits are already on the base, measured by PATCH ID rather than by ancestry.
 *
 * Ancestry cannot see this at all: a squash merge rewrites the branch's work under a new SHA, so a branch
 * whose every line is already on `main` still reports as unmerged. A patch id names the change rather than the
 * commit, which is why it answers a question `merge-base --is-ancestor` structurally cannot.
 *
 * There is no `unmeasurable` arm on purpose. An answer this check could not compute is `skipped`, never a
 * refusal — `gitAncestry.ts` states the rule for the whole family, and a shallow clone or an unfetched base
 * makes the answer WRONG rather than absent. A gate that refuses on its own inability is a gate that strands
 * the caller.
 */
export type AlreadyLanded =
  | { readonly kind: "landed"; readonly baseBranch: string; readonly headBranch: string }
  | { readonly kind: "not-landed" }
  | { readonly kind: "skipped"; readonly why: string };

/** The lines to print for one permitted (or acknowledged) invocation. */
export interface BaseFreshnessPermit {
  readonly lines: readonly string[];
}

/** One declared string-or-boolean flag value, or `undefined`. */
function stringValue({
  values,
  name,
}: {
  values: Readonly<Record<string, string | boolean>>;
  name: string;
}): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

/**
 * The local branch a same-repository `PrTarget.head` names, or why it names a fork head instead.
 *
 * A bare head is implicitly the base repository's own branch. A qualified `owner:branch` head is still
 * same-repository when its owner matches (case-insensitively — GitHub owner/repo names are), and a
 * different-owner fork otherwise — a real, currently-supported address form this check is never applied to.
 *
 * @param head the target's `head`, bare or `owner:branch`
 * @param owner the target's base-repository owner
 * @returns the local branch name, or why this head cannot be measured locally
 */
export function sameRepoLocalHeadBranch({ head, owner }: { head: string; owner: string }): GithubVerbResult<string> {
  const colon = head.indexOf(":");
  if (colon === -1) {
    return ok(head);
  }
  const headOwner = head.slice(0, colon);
  if (headOwner.toLowerCase() !== owner.toLowerCase()) {
    return err(GithubVerbErrors.forkHead({ head }));
  }
  return ok(head.slice(colon + 1));
}

/**
 * Parse `--acknowledge`/`--acknowledge-all`/`--reason` from a verb's already-parsed flag values.
 *
 * @param values the raw parsed flag values
 * @param errors usage errors to append to
 * @param enabled whether these flags are accepted at this call site (`false` for `pr update`, which this
 *   escape hatch does not apply to)
 * @returns the parsed acknowledgement
 */
export function baseFreshnessAcknowledgementFrom({
  values,
  errors,
  enabled,
}: {
  readonly values: Readonly<Record<string, string | boolean>>;
  readonly errors: string[];
  readonly enabled: boolean;
}): BaseFreshnessAcknowledgement {
  const acknowledgeAll = values["acknowledge-all"] === true;
  const raw = stringValue({ name: "acknowledge", values });
  const acknowledge =
    raw === undefined
      ? []
      : raw
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
  const reason = stringValue({ name: "reason", values });
  if (!enabled && (acknowledge.length > 0 || acknowledgeAll)) {
    errors.push("--acknowledge/--acknowledge-all/--reason are not accepted here — freshness is only checked on create");
  }
  if (acknowledgeAll && (reason === undefined || reason.trim().length === 0)) {
    errors.push('--acknowledge-all must be paired with --reason "…" explaining why every finding is accepted');
  }
  return { acknowledge, acknowledgeAll, reason };
}

/**
 * The manual remedy printed on an unmeasurable refusal — never an automatic rebase. A `base-moved` refusal
 * prints {@link baseMovedRemedy} instead, because "rebase and retry" is the losing lap of a serial landing.
 */
const UNMEASURABLE_REMEDY = ["remedy: rebase onto the current base, rerun the full gate, and retry"];

/**
 * Whether one acknowledgement subject was accepted, and the line to print either way.
 *
 * @returns ok with the acknowledged lines when the subject was accepted, or err with the refusal
 */
export function acknowledgedLines({
  acknowledgement,
  subject,
  detail,
  remedy,
  requireReason = false,
}: {
  acknowledgement: BaseFreshnessAcknowledgement;
  subject: string;
  detail: string;
  remedy: readonly string[];
  requireReason?: boolean;
}): Result<BaseFreshnessPermit, GithubBaseFreshnessRefusedError> {
  const reason = acknowledgement.reason === undefined ? undefined : acknowledgement.reason.trim();
  if (acknowledgement.acknowledgeAll) {
    return ok({
      lines: [`ACKNOWLEDGED (${subject}): ${detail}`, `acknowledged ALL findings — reason: ${acknowledgement.reason!}`],
    });
  }
  if (acknowledgement.acknowledge.includes(subject)) {
    if (requireReason && (reason === undefined || reason.length === 0)) {
      return err(GithubVerbErrors.freshnessUnpaired({ detail, subject }));
    }
    const named = requireReason ? [`reason: ${reason!}`] : [];
    return ok({ lines: [`ACKNOWLEDGED (${subject}): ${detail}`, ...named] });
  }
  const pairing = requireReason ? ` --reason "…"` : "";
  return err(GithubVerbErrors.freshnessRefused({ detail, pairing, remedy, subject }));
}

/**
 * The lines warning about reverted files, or none — printed unconditionally, never gated behind an
 * acknowledgement.
 *
 * A `git reset --soft base` squash can leave the branch's own tree unchanged for a file base modified after
 * the fork, so its ancestry still reads `fresh` — this is exactly the CASE the ancestry check cannot see (see
 * `mergeGuard.ts`'s header for the incident). Printed here, at `push` time, so the author sees it before CI
 * runs on the reverted content — the actual gate lives in `slopweaver github merge`'s `reverts-main` finding,
 * not here, so this never needs its own `--acknowledge` subject.
 *
 * The wording states the MEASUREMENT and names the commit, for the reason `revertsMainFindings` gives at
 * length: the fork-point sentence this used to print is not what the caller measures, and on a cleanly
 * rebased branch it is false.
 *
 * @param reverted the paths, each with the base commit whose content it restores
 * @returns the warning lines, or an empty list when nothing was reverted
 */
function revertedFilesWarning({ reverted }: { reverted: readonly RevertedPath[] }): readonly string[] {
  if (reverted.length === 0) {
    return [];
  }
  return [
    `WARNING: ${String(reverted.length)} file(s) carry content the base branch's own history once held and ` +
      "its tip no longer does, so merging restores the older version — either a deliberate revert or the " +
      "signature of a squash onto a moved base. Confirm with `slopweaver github merge` before this lands:",
    ...reverted.map((entry) => `  ${entry.path} (restores ${entry.restoresBaseCommit})`),
  ];
}

/**
 * The full verdict: whether this invocation may proceed, and the lines to print either way.
 *
 * @param acknowledgement what the caller accepted
 * @param measurement the base-freshness measurement, or why it could not be taken
 * @param lane the hold standing over the push's repository, when the caller could read one — decides which
 *   `base-moved` remedy is printed; absent, the remedy still names the queue, with the repository unfilled
 * @param queueGate what the base branch's merge queue gates on, when the caller could read one — absent, a
 *   `base-moved` refuses exactly as it always did
 * @returns ok with the lines to print when this may proceed, or err with the refusal
 */
export function baseFreshnessPermit({
  acknowledgement,
  measurement,
  lane,
  queueGate,
}: {
  acknowledgement: BaseFreshnessAcknowledgement;
  measurement: GithubVerbResult<BaseFreshness>;
  lane?: BaseMovedLane | undefined;
  queueGate?: QueueGate | undefined;
}): Result<BaseFreshnessPermit, GithubBaseFreshnessRefusedError> {
  if (measurement.isErr()) {
    return acknowledgedLines({
      acknowledgement,
      detail: `base freshness could not be measured: ${measurement.error.message}`,
      remedy: UNMEASURABLE_REMEDY,
      subject: BASE_UNMEASURABLE_ACK,
    });
  }
  const freshness = measurement.value;
  if (freshness.kind === "skipped") {
    return ok({ lines: [`base freshness SKIPPED: ${freshness.why}`] });
  }
  const warning = revertedFilesWarning({ reverted: freshness.reverted });
  if (freshness.kind === "fresh") {
    return ok({
      lines: [
        `base freshness: current — ${freshness.baseBranch}@${freshness.baseSha} is an ancestor of ${freshness.headSha}`,
        ...warning,
      ],
    });
  }
  const relaxation = queueGatedBaseMoved({ freshness, queueGate });
  if (relaxation.kind === "accepted") {
    return ok({ lines: [...relaxation.lines, ...warning] });
  }
  const permit = acknowledgedLines({
    acknowledgement,
    detail:
      `${freshness.baseBranch} has moved to ${freshness.baseSha}, which is not an ancestor of the checked head ` +
      `${freshness.headSha} — your diff and any CI run were computed against a base that has since advanced ` +
      "(or this is a shallow clone's false negative)",
    remedy: [`the merge queue does not excuse this: ${relaxation.why}`, ...baseMovedRemedy({ lane })],
    subject: BASE_MOVED_ACK,
  });
  return permit.isOk()
    ? ok({ lines: [...permit.value.lines, ...warning] })
    : err(GithubVerbErrors.freshnessWarned({ refusal: permit.error, warning }));
}

/**
 * The glyph the staleness advisory opens with — the bare warn character this repository's own CLI surfaces
 * already use (`src/handover/render.ts`, `src/handover/collide.ts`), never the emoji-presentation form,
 * which belongs to the Slack and artifact surfaces.
 */
const BEHIND_BASE_GLYPH = "⚠";

/**
 * The one advisory line saying how far behind its base a worktree is, or nothing at all when it is not
 * behind — the shared renderer every verb that can answer the question prints, so the wording an agent
 * greps for is identical wherever it appears.
 *
 * ADVISORY ONLY, and that is the whole point (owner ruling): a session runs a worktree its base
 * has moved dozens of commits past and nothing tells it, so it reports a defect that landed hours ago from
 * reading its own stale tree. A hard block hinders more than it helps, so the answer is
 * visibility instead, in the output the agent is already reading. So no caller may branch on this, and
 * no exit code may turn on it.
 *
 * Nothing is printed at zero, and nothing is printed when the count is absent. A behind-count that could not
 * be taken is silence rather than a guess, for the same reason the count is never gated on: an invented
 * number here is exactly the guessing this line exists to remove.
 *
 * @param behindBy how many commits the base carries that this head does not, or `undefined` when it could
 *   not be counted
 * @returns the single advisory line, or an empty list
 */
export function behindBaseAdvisory({
  behindBy,
  baseBranch,
  remote,
}: {
  behindBy: number | undefined;
  baseBranch: string;
  remote: string;
}): readonly string[] {
  if (behindBy === undefined || behindBy <= 0) {
    return [];
  }
  const commits = behindBy === 1 ? "1 commit" : `${String(behindBy)} commits`;
  return [`${BEHIND_BASE_GLYPH} this branch is ${commits} behind ${remote}/${baseBranch}`];
}

/**
 * The staleness advisory for one base-freshness measurement.
 *
 * Only the `base-moved` arm can be behind anything. `fresh` means the fetched base tip IS an ancestor of the
 * head, so `head..base` is empty by definition — zero commits behind, no line, and no second git call to
 * establish a number the ancestry answer already fixes. A `skipped` or unmeasurable result says nothing,
 * because it measured nothing.
 *
 * It deliberately overlaps the queue relaxation's own accepted line, which already states the same drift in
 * its own words ({@link queueGatedBaseMoved}). An indicator suppressed on one arm is one an agent has to
 * reason about rather than grep for, and consistency is what the owner asked for.
 *
 * @param measurement the base-freshness measurement, or why it could not be taken
 * @returns the single advisory line, or an empty list
 */
export function behindBaseLines({ measurement }: { measurement: GithubVerbResult<BaseFreshness> }): readonly string[] {
  if (measurement.isErr()) {
    return [];
  }
  const freshness = measurement.value;
  if (freshness.kind !== "base-moved") {
    return [];
  }
  return behindBaseAdvisory({
    baseBranch: freshness.baseBranch,
    behindBy: freshness.behindBy,
    remote: freshness.remote,
  });
}

/**
 * Print a base-freshness permit's lines and report whether the caller must refuse — the shared shape both
 * `push` and `stack push` gate on, so neither call site repeats the print-then-check pattern.
 *
 * The staleness advisory is printed FIRST, above the permit's own verdict, on every arm and in both
 * directions. It rides here rather than inside {@link baseFreshnessPermit} precisely because this function's
 * return value is the refusal signal and that one's `isErr()` IS the refusal: an advisory that cannot reach
 * either makes "never change an exit code on the strength of it" structural rather than something a reader
 * has to check.
 *
 * @param acknowledgement what the caller accepted
 * @param measurement the base-freshness measurement, or why it could not be taken
 * @param lane the hold standing over the push's repository, when the caller could read one
 * @param queueGate what the base branch's merge queue gates on, when the caller could read one
 * @param out where to print each line
 * @returns `true` when the caller must refuse, `false` when it may proceed
 */
export function printBaseFreshnessPermit({
  acknowledgement,
  measurement,
  lane,
  queueGate,
  out,
}: {
  acknowledgement: BaseFreshnessAcknowledgement;
  measurement: GithubVerbResult<BaseFreshness>;
  lane?: BaseMovedLane | undefined;
  queueGate?: QueueGate | undefined;
  out: (args: { line: string }) => void;
}): boolean {
  const permit = baseFreshnessPermit({ acknowledgement, lane, measurement, queueGate });
  for (const line of behindBaseLines({ measurement })) {
    out({ line });
  }
  for (const line of permit.isOk() ? permit.value.lines : permit.error.reasons) {
    out({ line });
  }
  return permit.isErr();
}
