/**
 * Plain fakes for a batch lap over one moving base: three members (#7, #8, #9) on `main`, a fake GitHub whose
 * status read-back echoes what was posted, and deps whose merge of member n moves the tip to `m<n>`. Shared by the
 * batch tests that drive `runGithubLap` whole and the ones that call a batch module directly.
 */

import { ResultAsync } from "neverthrow";

import type { GithubLapDeps } from "../cli/commands/github/lapDeps.js";
import type { LapReceipt } from "../cli/commands/github/lapVerdict.js";
import type { CommitStatus } from "../corpus/github/writeStatus.js";
import { errAsync, ok, okAsync } from "../lib/result.js";
import type { GithubLapApi } from "../outbound/github/lapApi.js";
import type { RevertedPath } from "../outbound/github/mergeGuard.js";
import { memoryDoorLedger } from "./doorLedgerFixture.js";
import { ACTIONS_PINNED_SOURCES, ADVANCING_LOCK } from "./lapRunFixture.js";

/**
 * A 40-character sha whose first characters name what it stands for.
 *
 * @param tag the readable prefix, padded with zeros
 * @returns the padded sha
 */
export function sha({ tag }: { tag: string }): string {
  return tag.padEnd(40, "0");
}

export const BASE = sha({ tag: "base" });
export const MEMBERS = [7, 8, 9] as const;
export const HEADS: Readonly<Record<number, string>> = {
  7: sha({ tag: "h7" }),
  8: sha({ tag: "h8" }),
  9: sha({ tag: "h9" }),
};
export const ARGS = ["--repo", "o/r", "--number", "7,8,9"];

/** What one fake batch observed, for the assertions. */
export interface Observed {
  readonly out: string[];
  readonly diagnostic: string[];
  readonly ran: string[];
  readonly checkedOut: string[];
  readonly envs: Readonly<Record<string, string>>[];
  readonly posted: { context: string; state: string; sha: string }[];
  readonly disposed: string[];
  readonly landing: string[];
  readonly receipts: LapReceipt[];
}

/**
 * A fresh observation record.
 *
 * @returns every list empty
 */
export function observe(): Observed {
  return {
    checkedOut: [],
    diagnostic: [],
    disposed: [],
    envs: [],
    landing: [],
    out: [],
    posted: [],
    ran: [],
    receipts: [],
  };
}

/** A plain fake GitHub serving one pull request per member, whose status read-back echoes what was posted. */
// max-lines-exempt: one plain-object fake of the whole GithubLapApi interface, its length that interface's, moved verbatim out of a test file this gate skips
function batchApi({
  observed,
  bases,
  merged,
  closed,
  retargetAt,
  pairedReadDown,
  recordDownAt,
}: {
  observed: Observed;
  /** The member whose REST merge record cannot be read at all. */
  recordDownAt: number | undefined;
  /** Whether the paired REST+GraphQL read fails for a member once it merged; the REST record still reads. */
  pairedReadDown: boolean;
  bases: Readonly<Record<number, string>>;
  /** The members whose merge reached GitHub, which then read `closed` with a merge time. */
  merged: ReadonlySet<number>;
  /** The members closed WITHOUT merging, which read `closed` with no merge time. */
  closed: ReadonlySet<number>;
  /** The member retargeted onto `release` once the lap's lanes have run. */
  retargetAt: number | undefined;
}): GithubLapApi {
  const stored: CommitStatus[] = [];
  return {
    isAdmin: () => ResultAsync.fromSafePromise(Promise.resolve(true)),
    mergeRecord: ({ number }) =>
      number === recordDownAt
        ? errAsync({ kind: "rate-limit", message: "rest rate limited", operation: "test", provider: "github" })
        : okAsync({
            mergedAtIso: merged.has(number) ? "2026-11-11T03:00:00Z" : undefined,
            state: merged.has(number) || closed.has(number) ? "closed" : "open",
          }),
    postStatus: ({ context, state, description, sha: posted }) => {
      observed.posted.push({ context, sha: posted, state });
      const status = { context, description, state };
      stored.unshift(status);
      return ResultAsync.fromSafePromise(Promise.resolve(status));
    },
    protection: () =>
      ResultAsync.fromSafePromise(Promise.resolve({ enforceAdmins: false, kind: "protected" as const })),
    read: ({ number }) =>
      pairedReadDown && merged.has(number)
        ? errAsync({ kind: "rate-limit", message: "graphql rate limited", operation: "test", provider: "github" })
        : ResultAsync.fromSafePromise(
            Promise.resolve({
              baseRef: number === retargetAt && observed.ran.length > 0 ? "release" : bases[number]!,
              baseSha: BASE,
              body: "",
              draft: false,
              headRef: `branch-${String(number)}`,
              headSha: HEADS[number]!,
              mergedAtIso: merged.has(number) ? "2026-11-11T03:00:00Z" : undefined,
              number,
              stack: undefined,
              stackQueue: undefined,
              state: merged.has(number) || closed.has(number) ? "closed" : "open",
              title: "t",
              url: `https://github.com/o/r/pull/${String(number)}`,
            }),
          ),
    requiredSources: () => ResultAsync.fromSafePromise(Promise.resolve(ACTIONS_PINNED_SOURCES)),
    statuses: () => ResultAsync.fromSafePromise(Promise.resolve([...stored])),
  };
}

/** The paths a per-member table names for one member, none when it names that member nothing. */
function pathsOf({ table, number }: { table: Readonly<Record<number, readonly string[]>>; number: number }): string[] {
  return Object.hasOwn(table, number) ? [...table[number]!] : [];
}

/** Every knob of {@link batchDeps} but the home, which the test file mints and removes itself. */
export type BatchDepsOptions = Omit<Parameters<typeof batchDeps>[0], "home">;

/**
 * Fakes for every edge over one moving base: a merge of member n moves the tip to `m<n>`, whose one parent is the
 * tip it landed onto and whose tree is the simulated `t<n>` unless `landedTree` says otherwise.
 *
 * @param home the lap's state home and log directory, minted and removed by the calling test file
 * @param pairedReadDown whether the paired pull-request read fails for a member once it merged
 * @param red the step ids that run red; a retry runs as `<id>.retry`, so it is red only when listed too
 * @param conflictAt the member whose simulated squash conflicts
 * @param landedTree a tree GitHub's squash writes for a member, other than the simulated one
 * @param moved the `base-moved` paths a member's merge reports, the same over its link and over the real tip
 * @param changed the paths a member's own diff changes
 * @param driftAt the member whose `base-moved` paths over the real tip differ from those over its simulated link
 * @param mergeExit the exit a member's merge reports although it DID land — a lost response
 * @param refusedAt the member whose merge is refused, so it exits 1 and the base does not move
 * @param slippedAt the member whose merge fails while another commit lands and it is closed WITHOUT merging
 * @param retargetAt the member retargeted onto another base branch after the lap's lanes ran
 * @param recordDownAt the member whose REST merge record cannot be read at all
 * @param reverts the paths a member's merge reports it restores, over its link and over the real tip alike
 * @returns the deps, observed into `observed`
 */
// max-lines-exempt: one plain-object fake of the whole GithubLapDeps interface, its length that interface's, moved verbatim out of a test file this gate skips
export function batchDeps({
  home,
  observed,
  red = [],
  bases = { 7: "main", 8: "main", 9: "main" },
  conflictAt,
  landedTree = {},
  moved = {},
  changed = {},
  driftAt,
  mergeExit = {},
  refusedAt,
  slippedAt,
  retargetAt,
  pairedReadDown = false,
  recordDownAt,
  reverts = {},
}: {
  home: string;
  reverts?: Readonly<Record<number, readonly RevertedPath[]>>;
  recordDownAt?: number;
  observed: Observed;
  pairedReadDown?: boolean;
  red?: readonly string[];
  bases?: Readonly<Record<number, string>>;
  conflictAt?: number;
  landedTree?: Readonly<Record<number, string>>;
  moved?: Readonly<Record<number, readonly string[]>>;
  changed?: Readonly<Record<number, readonly string[]>>;
  driftAt?: number;
  mergeExit?: Readonly<Record<number, number>>;
  refusedAt?: number;
  slippedAt?: number;
  retargetAt?: number;
}): GithubLapDeps {
  const numberOf = ({ head }: { head: string }): number => MEMBERS.find((number) => HEADS[number] === head)!;
  const commits = new Map<string, { parents: readonly string[]; tree: string }>();
  let tip = BASE;
  const merged = new Set<number>();
  const closed = new Set<number>();
  const disposer =
    ({ name }: { name: string }) =>
    () =>
      Promise.resolve(void observed.disposed.push(name));
  return {
    acquireLock: () => ok({ dispose: disposer({ name: "lock" }), value: ADVANCING_LOCK }),
    ambientEnv: { HOME: "/Users/seat", PATH: "/bin" },
    checkout: ({ sha: at }) => {
      observed.checkedOut.push(at);
      return Promise.resolve(ok({ dispose: disposer({ name: "tree" }), value: "/tree" }));
    },
    cleanTree: () => ok(undefined),
    commitFacts: ({ sha: at }) => ok({ sha: at, ...commits.get(at)! }),
    doorLedger: memoryDoorLedger().port,
    fetchRefs: ({ number }) => Promise.resolve(ok({ baseTip: tip, headSha: HEADS[number]! })),
    hold: ({ args }) => Promise.resolve(void observed.landing.push(`hold #${String(args.number)}`)).then(() => 0),
    home: () => home,
    isAncestor: () => ok(true),
    laneHome: () => ({ dispose: disposer({ name: "lane-home" }), value: "/lane-home" }),
    lapSeatFacts: () => ok({ callerRun: undefined, seat: undefined, seatRunClosed: false }),
    logDir: () => home,
    makeApi: () => batchApi({ bases, closed, merged, observed, pairedReadDown, recordDownAt, retargetAt }),
    memberMergeFacts: ({ base, head }) => {
      const number = numberOf({ head });
      const real = base.startsWith("m");
      const paths = real && driftAt === number ? ["drift.ts"] : pathsOf({ number, table: moved });
      const reverted = Object.hasOwn(reverts, number) ? reverts[number]! : [];
      const headChanged = pathsOf({ number, table: changed });
      return ok({ baseMoved: paths, headChanged, headContainsTip: base === BASE, reverted });
    },
    landingPreconditions: () => Promise.reject(new Error("a batch never checks its landings ahead of the lap")),
    merge: ({ args }) => {
      const number = args.number;
      const ack = args.acknowledge === undefined ? "none" : args.acknowledge.subjects;
      observed.landing.push(`merge #${String(number)} acknowledging ${ack}`);
      if (number === refusedAt) {
        return Promise.resolve(1);
      }
      if (number === slippedAt) {
        const foreign = sha({ tag: `x${String(number)}` });
        commits.set(foreign, { parents: [tip], tree: sha({ tag: "foreign" }) });
        tip = foreign;
        closed.add(number);
        return Promise.resolve(1);
      }
      const landed = sha({ tag: `m${String(number)}` });
      const simulated = sha({ tag: `t${String(number)}` });
      const tree = Object.hasOwn(landedTree, number) ? landedTree[number]! : simulated;
      commits.set(landed, { parents: [tip], tree });
      tip = landed;
      merged.add(number);
      return Promise.resolve(Object.hasOwn(mergeExit, number) ? mergeExit[number]! : 0);
    },
    now: () => new Date("2026-11-11T03:00:00.000Z"),
    out: (line) => observed.out.push(line),
    pid: 4242,
    planSourcesDiffering: () => ok([]),
    readReceipts: () => [],
    release: ({ args }) => Promise.resolve(void observed.landing.push(`release #${String(args.number)}`)).then(() => 0),
    simulateSquash: ({ head }) => {
      const number = numberOf({ head });
      if (number === conflictAt) {
        return ok({ kind: "conflict" as const, paths: ["shared.ts"] });
      }
      return ok({
        commit: sha({ tag: `s${String(number)}` }),
        kind: "clean" as const,
        tree: sha({ tag: `t${String(number)}` }),
      });
    },
    standingHold: () => ({ kind: "clear" }),
    runStep: ({ step, env }) => {
      observed.ran.push(step.id);
      observed.envs.push(env);
      return Promise.resolve({
        context: step.context,
        exitCode: red.includes(step.id) ? 1 : 0,
        id: step.id,
        wallMs: 1000,
      });
    },
    startStore: () => Promise.resolve(ok({ dispose: disposer({ name: "store" }), value: {} })),
    token: () => "token",
    toolCaches: {},
    wait: () => Promise.resolve(),
    writeDiagnostic: (line) => observed.diagnostic.push(line),
    writeReceipt: ({ receipt }) => observed.receipts.push(receipt),
  };
}

/**
 * The posted states on one member's head, in posting order.
 *
 * @returns each state posted on that head
 */
export function statesOn({ observed, number }: { observed: Observed; number: number }): string[] {
  return observed.posted.filter((status) => status.sha === HEADS[number]).map((status) => status.state);
}
