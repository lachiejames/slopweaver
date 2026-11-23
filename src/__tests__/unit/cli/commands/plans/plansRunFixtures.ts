/**
 * Shared seams for the `plans` verb tests: a register row, a snapshot, and deps that journal every write.
 *
 * The register's file edge is a plain function passed in, not a mock (`.claude/rules/testing.md`).
 */
import type { PlansDeps } from "../../../../../cli/commands/plans/run.js";
import type { ReadCodexAccountsLive } from "../../../../../codex/accountLive.js";
import { err, ok, type Result } from "../../../../../lib/result.js";
import { PlanRegisterErrors } from "../../../../../plans/errors.js";
import type { PlanPaidThrough } from "../../../../../plans/lapse.js";
import { DEFAULT_THRESHOLDS } from "../../../../../plans/thresholds.js";
import type { PlanMutation, PlanRegisterSnapshot, RegisteredPlan } from "../../../../../plans/types.js";
import { liveReaderFrom } from "../../../../codexLiveFake.js";

export const NOW = "2026-09-22T11:00:00.000Z";

/**
 * One registered row, with only the fields a case cares about spelled.
 *
 * @returns the row, defaulting to a Claude weekly-window plan at a 100% limit
 */
export const row = (over: Partial<RegisteredPlan> = {}): RegisteredPlan => ({
  alias: "plan-one",
  allowance: { kind: "weekly-window" },
  provider: "claude",
  usageLimitPercent: 100,
  storeDir: "/s/one",
  ...over,
});

/**
 * A snapshot carrying the given rows, with the raw document the register would have published.
 *
 * @returns the snapshot
 */
export const snapshotOf = ({
  diagnostics = [],
  plans,
  revision = 1,
  source = "registered",
}: {
  diagnostics?: PlanRegisterSnapshot["diagnostics"];
  plans: readonly RegisteredPlan[];
  revision?: number | null;
  source?: PlanRegisterSnapshot["source"];
}): PlanRegisterSnapshot => ({
  diagnostics,
  document: { rows: plans.map((plan) => ({ ...plan })), version: 1 },
  plans,
  revision,
  source,
  thresholds: DEFAULT_THRESHOLDS,
});

/** What one run recorded: every line written, and every mutation the register was asked for. */
export interface Recording {
  readonly out: string[];
  readonly diagnostics: string[];
  readonly mutations: PlanMutation[];
  readonly homes: (string | undefined)[];
  readonly ensured: string[];
  /** The revision each write was pinned to, `undefined` for one judged by the write alone. */
  readonly judged: (number | null | undefined)[];
  /** Every Codex store whose sign-in was asked for its paid-through date. */
  readonly paidThroughReads: string[];
}

/**
 * Seams that answer every read with one snapshot and journal every write instead of performing it.
 *
 * @returns the deps
 */
export const recordingDeps = ({
  ensure = ok("created"),
  paidThrough = {},
  read = snapshotOf({ plans: [row()] }),
  readLive = liveReaderFrom(),
  recording,
  resolved = {},
}: {
  ensure?: Result<"created" | "existed", string>;
  /** What each Codex store's sign-in states; a store absent here answers `unread`, as one with no sign-in file does. */
  paidThrough?: Readonly<Record<string, PlanPaidThrough>>;
  read?: PlanRegisterSnapshot;
  readLive?: ReadCodexAccountsLive;
  recording: Recording;
  /** The directory each store path names on disk; a path absent here resolves to nothing, as an absent store does. */
  resolved?: Readonly<Record<string, string>>;
}): PlansDeps => ({
  ensureStoreDir: ({ storeDir }) => {
    recording.ensured.push(storeDir);
    return ensure;
  },
  nowIso: () => NOW,
  readLive,
  readPaidThrough: ({ codexHome }) => {
    recording.paidThroughReads.push(codexHome);
    const stated = paidThrough[codexHome];
    if (stated === undefined) {
      return { kind: "unread", reason: "no sign-in file" };
    }
    return stated;
  },
  readRegister: async ({ home }) => {
    recording.homes.push(home);
    return ok(read);
  },
  resolveStore: ({ storeDir }) => resolved[storeDir],
  writeDiagnostic: (line) => {
    recording.diagnostics.push(line);
  },
  writeOut: (line) => {
    recording.out.push(line);
  },
  writeRegister: async ({ home, judgedAtRevision, mutation }) => {
    recording.homes.push(home);
    recording.judged.push(judgedAtRevision);
    recording.mutations.push(mutation);
    return ok(read);
  },
});

/**
 * A fresh empty recording.
 *
 * @returns the recording
 */
export const fresh = (): Recording => ({
  diagnostics: [],
  ensured: [],
  homes: [],
  judged: [],
  mutations: [],
  out: [],
  paidThroughReads: [],
});

/** The thresholds block `plans list` opens with on a register naming none: both providers, every field a default. */
export const DEFAULT_THRESHOLD_LINES = [
  "claude thresholds:",
  "  alert-at-percent                75% (default)",
  "  acceptance-at-percent           90% (default)",
  "  route-at-percent                95% (default)",
  "  spend-out-at-percent            100% (default)",
  "  spend-out-before-reset-minutes  300 min (default)",
  "  balanced-spread-percent         10% (default)",
  "  drifting-spread-percent         15% (default)",
  "codex thresholds:",
  "  alert-at-percent  75% (default)",
  "  pause-at-percent  99% (default)",
];

/** The register `plans sync-accounts` reads: four Codex stores in each sign-in state, and a Claude row it skips. */
export const SYNC_CODEX_ROWS = [
  row({ alias: "codex-a", provider: "codex", storeDir: "/s/a" }),
  row({ alias: "codex-b", email: "old@example.com", provider: "codex", storeDir: "/s/b" }),
  row({ alias: "codex-c", email: "same@example.com", provider: "codex", storeDir: "/s/c" }),
  row({ alias: "codex-d", provider: "codex", storeDir: "/s/d" }),
  row({ alias: "plan-one", provider: "claude", storeDir: "/s/one" }),
];

/** A signed-in answer for one store, carrying only what `sync-accounts` reads. */
const signedIn = ({ codexHome, email }: { codexHome: string; email: string }) =>
  ({
    accountId: `acct-${email}`,
    codexHome,
    email,
    gauges: [],
    kind: "signed-in",
    ordinaryUsageAllowed: undefined,
    planType: "pro",
    readAtIso: NOW,
    resetCreditsAvailable: 0,
  }) as const;

/** The live read over {@link SYNC_CODEX_ROWS}: a new address, an unchanged one, a first one, and a signed-out store. */
export const SYNC_READ_LIVE: ReadCodexAccountsLive = liveReaderFrom({
  byHome: {
    "/s/a": signedIn({ codexHome: "/s/a", email: "a@example.com" }),
    "/s/b": signedIn({ codexHome: "/s/b", email: "new@example.com" }),
    "/s/c": signedIn({ codexHome: "/s/c", email: "same@example.com" }),
    "/s/d": { codexHome: "/s/d", kind: "signed-out", readAtIso: NOW },
  },
});

/**
 * Deps over {@link SYNC_CODEX_ROWS} whose register refuses the `codex-a` change, as one repointed mid-read, and lands
 * every other.
 *
 * @returns the deps, journalling each write they are asked for
 */
export const codexARefusedDeps = ({ recording }: { recording: Recording }): PlansDeps => ({
  ...recordingDeps({ read: snapshotOf({ plans: SYNC_CODEX_ROWS }), readLive: SYNC_READ_LIVE, recording }),
  writeRegister: async ({ mutation }) => {
    recording.mutations.push(mutation);
    if (mutation.kind === "record-email" && mutation.alias === "codex-a") {
      return err(
        PlanRegisterErrors.mutationConflict({ conflict: "`codex-a` now names /s/z, not the /s/a that was read" }),
      );
    }
    return ok(snapshotOf({ plans: SYNC_CODEX_ROWS }));
  },
});

/** A pinned Claude row with an address, and a Codex row with none, for the aligned `plans list` table. */
export const ALIGNED_ROWS_SNAPSHOT = snapshotOf({
  plans: [
    row({ email: "first@example.com", pinned: true }),
    row({ alias: "codex-ambient", provider: "codex", storeDir: "/x/ambient" }),
  ],
});

/** A Codex sign-in stating its paid-through date, synthetic. */
export const STATED_PAID_THROUGH = {
  kind: "stated",
  lastCheckedIso: "2026-01-20T10:11:12+00:00",
  paidThroughIso: "2026-02-02T03:04:05+00:00",
} as const;

/** A Claude row and a Codex row at `/x/ambient` whose recorded lapse names another instant than its sign-in states. */
export const PAID_THROUGH_SNAPSHOT = snapshotOf({
  plans: [
    row({ email: "first@example.com" }),
    row({ alias: "codex-ambient", lapsesAtIso: "2026-03-01T00:00:00Z", provider: "codex", storeDir: "/x/ambient" }),
  ],
});

/** An open Claude row, and a second one paused because its subscription lapsed. */
export const PAUSED_ROW_SNAPSHOT = snapshotOf({
  plans: [
    row({ email: "first@example.com" }),
    row({
      alias: "plan-two",
      email: "second@example.com",
      paused: { reason: "the subscription lapsed", sinceIso: NOW },
      storeDir: "/s/two",
    }),
  ],
});

/** A register whose published row carries a field no version here declares. */
export const FUTURE_FIELD_SNAPSHOT: PlanRegisterSnapshot = {
  diagnostics: [],
  document: {
    rows: [{ alias: "plan-one", futureField: "keep me", provider: "claude", storeDir: "/s/one" }],
    version: 1,
  },
  plans: [row()],
  revision: 1,
  source: "registered",
  thresholds: DEFAULT_THRESHOLDS,
};
