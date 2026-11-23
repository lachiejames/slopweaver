/**
 * What `slopweaver github lap` JUDGES, as pure functions: whether a pull request may be lapped at all, whether a
 * head may land on the lap it already earned, the receipt it keeps, the hold it reads and the door request. The
 * lock's shape and staleness are `./lapLockShape.ts`'s; the statuses it posts are `./lapStatuses.ts`'s; the plan
 * and the lanes' environment are `./lapCore.ts`'s.
 *
 * A context pinned to an app is a NOTE, not a refusal: GitHub's own protection never counts a status this token
 * posts then, but `github merge --admin` judges the head's contexts by name and lands through the administrator
 * bypass — the one route a requirement pinned to hosted Actions leaves while Actions is off.
 */

import type { DoorRequest } from "../../../admit/types.js";
import { planCannotProtectNote } from "../../../corpus/github/protectionRead.js";
import type { BranchProtection } from "../../../corpus/github/write.js";
import type { CommitStatus } from "../../../corpus/github/writeStatus.js";
import { parseMergeHolds } from "../../../outbound/github/mergeHold.js";
import { type GithubLapArgs, LAP_CONTEXTS, type LapStep } from "./lapCore.js";
import type { LapStepOutcome } from "./lapStatuses.js";

/** Everything the preflight decides from, read before any lane runs. */
export interface LapPreflightFacts {
  readonly prState: string;
  readonly baseRef: string;
  readonly isAdmin: boolean;
  /** Which of the three answers the base's protection read gave: protected, unprotected, or not protectable on its plan. */
  readonly protection: BranchProtection["kind"];
  readonly enforceAdmins: boolean | undefined;
  /** The base branch's required contexts and each one's pinned app, `undefined` for any source. */
  readonly required: readonly { readonly context: string; readonly appId: number | undefined }[];
  /** Whether the pull request's head already contains the freshly fetched base tip. */
  readonly headContainsBase: boolean;
  readonly baseTip: string;
  readonly headSha: string;
  /** Every `LAP_PLAN_SOURCES` file that reads differently in this checkout than at the head. */
  readonly planSourcesDiffering: readonly string[];
}

/** The preflight's verdict: refusals stop the lap, notes are printed beside a lap that runs. */
export interface LapPreflightVerdict {
  readonly refusals: readonly string[];
  readonly notes: readonly string[];
}

/** Refusals about the pull request, the token and the base's protection. */
function standingRefusals({ facts }: { facts: LapPreflightFacts }): readonly string[] {
  const refusals: string[] = [];
  if (facts.prState !== "open") {
    refusals.push(`the pull request is ${facts.prState}, so there is nothing to lap`);
  }
  if (!facts.isAdmin) {
    refusals.push("this token is not an administrator of the repository, so the lap's statuses could never land it");
  }
  if (facts.enforceAdmins === true) {
    refusals.push(
      `${facts.baseRef}'s protection enforces itself on administrators, so the bypass the lap lands through is closed`,
    );
  }
  const unpostable = facts.required.filter(({ context }) => !LAP_CONTEXTS.includes(context));
  return [
    ...refusals,
    ...unpostable.map(({ context }) => `${facts.baseRef} requires "${context}", which a lap never posts`),
  ];
}

/** Refusals about which tree the lap would test and which plan it would run over it. */
function treeRefusals({ facts }: { facts: LapPreflightFacts }): readonly string[] {
  const refusals: string[] = [];
  const head = facts.headSha.slice(0, 10);
  if (!facts.headContainsBase) {
    refusals.push(
      `the head ${head} does not contain ${facts.baseRef}'s tip ${facts.baseTip.slice(0, 10)}: ` +
        "rebase it and push, so the tree the lap tests is the tree that lands",
    );
  }
  const differing = facts.planSourcesDiffering;
  if (differing.length > 0) {
    const verb = differing.length === 1 ? "differs" : "differ";
    refusals.push(
      `this checkout's ${differing.join(" and ")} ${verb} from the head ${head}'s, so the lap would run a plan the head ` +
        "does not declare: run it from a checkout whose CI model matches the head's",
    );
  }
  return refusals;
}

/**
 * Judge whether a lap on this pull request could end in a landing, before spending an hour finding out.
 *
 * @returns every refusal and every note, each a complete sentence
 */
export function lapPreflightVerdict({ facts }: { facts: LapPreflightFacts }): LapPreflightVerdict {
  const pinned = facts.required.filter((source) => source.appId !== undefined);
  const pinnedNotes =
    pinned.length === 0
      ? []
      : [
          `${pinned.map((source) => `"${source.context}"`).join(" and ")} ${pinned.length === 1 ? "is" : "are"} pinned to app ` +
            `${String(pinned[0]!.appId)}, so GitHub itself will not count the lap's statuses; the landing is the administrator bypass`,
        ];
  const planNotes =
    facts.protection === "plan-unavailable"
      ? [`${planCannotProtectNote({ branch: facts.baseRef })}: the lap has no required contexts to satisfy`]
      : [];
  return {
    notes: [...planNotes, ...pinnedNotes],
    refusals: [...standingRefusals({ facts }), ...treeRefusals({ facts })],
  };
}

/**
 * Why a head may NOT be landed on the lap it already earned, `--land-only`'s whole check: each context a lap
 * posts must read, as GitHub's latest for it, a lap's green over the base tip as it stands now. A green over an
 * older base proves nothing about the merge, and any other poster's green is not a lap's. MEASURED: a
 * pull request went green twice in a row, 35m each, and both merges were refused on gates no lane measures
 * (`codex-loop-incomplete`, then `baseline-bump-unwitnessed`), so landing again cost a third full lap.
 *
 * @param statuses GitHub's combined status for the head, the latest per context
 * @param baseTip the base branch's tip as just fetched
 * @returns one line per context that has not earned the landing; empty when both have
 */
export function landOnlyFindings({
  statuses,
  baseTip,
}: {
  statuses: readonly CommitStatus[];
  baseTip: string;
}): readonly string[] {
  const over = ` over base ${baseTip.slice(0, 10)}`;
  return LAP_CONTEXTS.flatMap((context) => {
    const latest = statuses.find((status) => status.context === context);
    if (latest === undefined) {
      return [`"${context}" carries no status on this head`];
    }
    const { description } = latest;
    const lapGreen =
      latest.state === "success" &&
      description !== null &&
      description.startsWith("local lap: ") &&
      description.includes(over);
    return lapGreen
      ? []
      : [`"${context}" reads ${latest.state} (${JSON.stringify(description)}), not a lap's green${over}`];
  });
}

/** One lap's durable receipt, rewritten before the first step and after every step. */
export interface LapReceipt {
  readonly subject: string;
  readonly baseTip: string;
  readonly headSha: string;
  readonly startedIso: string;
  /** `running` until the last step returns; a receipt left `running` is a lap that died. */
  readonly phase: "running" | "finished";
  readonly plan: readonly {
    readonly id: string;
    readonly argv: readonly string[];
    readonly directory: string | undefined;
  }[];
  readonly environmentKeys: readonly string[];
  readonly outcomes: readonly LapStepOutcome[];
  /**
   * A batch lap's members in landing order, each with the simulated squash it was tested as — `headSha` above is
   * then the last member's simulated commit, never a pull request's head. Absent for one pull request.
   */
  readonly batch?: readonly {
    readonly number: number;
    readonly headSha: string;
    readonly tree: string;
    readonly commit: string;
  }[];
}

/** The part of a receipt `--land-only` reads back: where the lap ran, whether it finished, and each step's exit. */
export interface LapReceiptEvidence {
  readonly headSha: string;
  readonly baseTip: string;
  readonly phase: string;
  /** Each planned step as `lapStepKey` spells it, in order. */
  readonly plan: readonly string[];
  readonly outcomes: readonly { readonly id: string; readonly exitCode: number }[];
}

/**
 * One planned step as a comparable string: its id, its command and its directory, so a step whose command changed
 * under an unchanged id is a different step.
 *
 * @returns the step's id, argv and directory as one JSON array
 */
export function lapStepKey({
  id,
  argv,
  directory,
}: {
  id: string;
  argv: readonly string[];
  directory?: string | undefined;
}): string {
  return JSON.stringify([id, argv, directory]);
}

/**
 * Whether a lap THIS machine ran earned the head: a finished receipt at exactly this head and base, over the plan
 * this checkout runs (every step's id, command and directory), with exactly one green outcome per step, in plan
 * order. A status
 * description is text any status poster can write, so it says only that a lap claims a green; the receipt under
 * this home is what says one ran.
 *
 * @param plan the steps `lapPlan()` runs now, in order
 * @returns no finding when one receipt earns it, else the one line saying none does
 */
export function landOnlyReceiptFindings({
  receipts,
  headSha,
  baseTip,
  plan,
}: {
  receipts: readonly LapReceiptEvidence[];
  headSha: string;
  baseTip: string;
  plan: readonly { readonly id: string; readonly argv: readonly string[]; readonly directory: string | undefined }[];
}): readonly string[] {
  const keys = plan.map((step) => lapStepKey(step));
  const earned = receipts.some(
    (receipt) =>
      receipt.phase === "finished" &&
      receipt.headSha === headSha &&
      receipt.baseTip === baseTip &&
      receipt.plan.length === keys.length &&
      receipt.plan.every((key, at) => key === keys[at]) &&
      receipt.outcomes.length === plan.length &&
      plan.every((step, at) => {
        const outcome = receipt.outcomes[at];
        return outcome !== undefined && outcome.id === step.id && outcome.exitCode === 0;
      }),
  );
  if (earned) {
    return [];
  }
  return [
    `no finished lap receipt on this machine shows all ${String(plan.length)} steps green at head ${headSha.slice(0, 10)} over base ${baseTip.slice(0, 10)}`,
  ];
}

/**
 * The receipt for a lap at one moment.
 *
 * @param env the lanes' environment; only its KEYS are kept, since its values hold the store's URLs
 * @returns the record written beside the lap's logs
 */
export function lapReceipt({
  subject,
  refs,
  startedIso,
  plan,
  env,
  outcomes,
  phase,
  batch,
}: {
  subject: string;
  refs: { readonly baseTip: string; readonly headSha: string };
  startedIso: string;
  plan: readonly LapStep[];
  env: Readonly<Record<string, string>>;
  outcomes: readonly LapStepOutcome[];
  phase: LapReceipt["phase"];
  /** A batch lap's members, absent for one pull request. */
  batch?: LapReceipt["batch"];
}): LapReceipt {
  const receipt: LapReceipt = {
    baseTip: refs.baseTip,
    environmentKeys: Object.keys(env).toSorted(),
    headSha: refs.headSha,
    outcomes: [...outcomes],
    phase,
    plan: plan.map((step) => ({ argv: step.argv, directory: step.directory, id: step.id })),
    startedIso,
    subject,
  };
  return batch === undefined ? receipt : { ...receipt, batch };
}

/**
 * The door request for posting a lap's statuses on one head commit.
 *
 * @param args the parsed invocation
 * @param headSha the commit the statuses are posted on
 * @param home the state home whose door records the write
 * @returns the exact external-write request the door admits
 */
export function lapDoorRequest({
  args,
  headSha,
  home,
}: {
  args: GithubLapArgs;
  headSha: string;
  home: string;
}): DoorRequest {
  return {
    action: { kind: "verb", noun: "github", verb: "lap" },
    artifact: { id: `${args.owner}/${args.repo}#${String(args.number)}@${headSha}` },
    meta: { createsWorkItem: false, effect: "external-write", home, requiresApproval: false },
  };
}

/**
 * Every plan source whose bytes in this checkout differ from the same path at the head, a path present on only
 * one side included. Compared byte for byte rather than through `git diff`, which honours an `assume-unchanged`
 * or `skip-worktree` bit and so reports an edited `ci.yml` carrying one as unchanged.
 *
 * @param sources the paths whose copies must match, relative to the checkout root
 * @param readLocal this checkout's working-tree bytes for a path, or `undefined` when no file is there
 * @param readAtHead the head commit's bytes for a path, or `undefined` when the head has no such path
 * @returns each differing path, in `sources` order
 */
export function differingPlanSources({
  sources,
  readLocal,
  readAtHead,
}: {
  sources: readonly string[];
  readLocal: (path: string) => Uint8Array | undefined;
  readAtHead: (path: string) => Uint8Array | undefined;
}): readonly string[] {
  return sources.filter((path) => {
    const local = readLocal(path);
    const head = readAtHead(path);
    if (local === undefined || head === undefined) {
      return local !== head;
    }
    return !Buffer.from(local).equals(Buffer.from(head));
  });
}

/**
 * Who already holds the repository a lap is about to land in, matching its slug case-insensitively: GitHub reads
 * `Acme/Widget` and `acme/widget` as one repository while the hold store compares the text exactly, so an exact
 * match would let a lap of `acme/widget` land under `Acme/Widget`'s standing hold.
 *
 * @param holds every hold the state home keeps
 * @param slug the `owner/repo` the lap was invoked on, in whatever case the caller typed
 * @returns the standing hold's holder, or `undefined` when nothing holds that repository
 */
export function standingHolderOf({
  holds,
  slug,
}: {
  holds: readonly { readonly repo: string; readonly holder: string }[];
  slug: string;
}): string | undefined {
  const wanted = slug.toLowerCase();
  return holds.find((hold) => hold.repo.toLowerCase() === wanted)?.holder;
}

/**
 * Whether a plan source is present in the checkout under EXACTLY the name git records, each component matched
 * byte for byte against its directory's listing. A case-insensitive filesystem opens `CI.yml` for a lookup of
 * `ci.yml`, so a lookup alone would read a case-renamed file as the same path.
 *
 * @param relative the source's path from the checkout root, `/`-separated as git names it
 * @param entriesOf the names one directory holds, `""` for the root, or `undefined` when it is absent
 * @returns true only when every component appears verbatim in its parent's listing
 */
export function presentUnderExactName({
  relative,
  entriesOf,
}: {
  relative: string;
  entriesOf: (dir: string) => readonly string[] | undefined;
}): boolean {
  let dir = "";
  for (const component of relative.split("/")) {
    const entries = entriesOf(dir);
    if (entries === undefined || !entries.includes(component)) {
      return false;
    }
    dir = dir === "" ? component : `${dir}/${component}`;
  }
  return true;
}

/** What a lap read of the hold store found before it would take a hold of its own. */
export type StandingHold =
  | { readonly kind: "clear" }
  | { readonly kind: "held"; readonly holder: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly why: string };

/**
 * The lap's FAIL-CLOSED reading of the hold document. The shared store's own read is tolerant (an unreadable or
 * undecodable document is "nothing held", which `github merge` relies on), so a lap reading through it would
 * take, merge under and then release a hold over one it could not see. Here a document
 * that is not a hold document, or carries any entry no hold verb can decode, is `unreadable` and never `clear`.
 *
 * @param raw the parsed document; the caller answers a missing file `clear` before ever calling this
 * @param path the document's path, named in the refusal
 * @param slug the `owner/repo` the lap was invoked on, in whatever case the caller typed
 * @returns whether the repository is clear, held and by whom, or unreadable and why
 */
export function standingHoldOf({ raw, path, slug }: { raw: unknown; path: string; slug: string }): StandingHold {
  const entries = typeof raw === "object" && raw !== null && "holds" in raw ? raw.holds : undefined;
  if (!Array.isArray(entries)) {
    return { kind: "unreadable", path, why: "it is not a hold document" };
  }
  const holds = parseMergeHolds({ raw });
  if (holds.length !== entries.length) {
    return { kind: "unreadable", path, why: "it carries an entry no hold verb can decode" };
  }
  const holder = standingHolderOf({ holds, slug });
  if (holder === undefined) {
    return { kind: "clear" };
  }
  return { holder, kind: "held" };
}
