/**
 * The effectful half of `plans usage` (`./planUsage.ts` is the pure one): read, for every registered destination,
 * what this machine already recorded about it, and hand the evidence to the projection.
 *
 * ## LOCAL reads only, by construction
 *
 * {@link PlanUsageReadDeps} holds no live reader: no Codex app-server, no model host's SDK, no fetch. Its one connection
 * is the install's own store, local always: a non-loopback store URL is refused with no hatch. The Claude half
 * reads the snapshot and probe records `claude gauge` and `claude watch` filed; the Codex half reads each store's own
 * rollout logs, its `auth.json` SHAPE and stamp (never a value), and the live-read observation the fleet's routing
 * read last filed. `../codex/fleetRead.ts`'s `readCodexFleetSnapshot` is deliberately NOT reused: even with its live
 * reader stubbed, it files sign-in observations and a fleet-cap record, and this read files no record of its own.
 *
 * Two writes it can still cause belong to the store's migration, not to this read, and every reader of the same door
 * causes them too: selecting the store sheds an upgraded home's retired Storage
 * address and key copies (`../store/config.ts`'s `storeUrlSelection`), exactly as `plans list` does; and the sign-in
 * port's read imports a pre-store `codex-signin/<alias>.json` into its row once (`../codex/signInPort.ts`), the same
 * record moved, exactly as the `codex-plan-signed-out` monitor's read does.
 *
 * The register is read with `readStoredPlanRegister`, which imports no legacy `plans.json`; an install with no stored
 * register has no registered destinations, so its report is empty.
 *
 * ## One failure, one row
 *
 * A register that cannot be read fails the whole report — there is nothing to say a row about. Every other read fails
 * only the rows it feeds: an unreadable snapshot is that plan's `unavailable`, a probe or sign-in store outage leaves
 * that model host's sign-ins `unknown`, and the other rows still render.
 *
 * ## What it does not close: a store whose files are another account's
 *
 * A rollout event names no account, and `auth.json` is read where Codex reads it, so evidence is attributed to a plan
 * by WHERE it was found: the registered store directory, symlinks in it followed exactly as Codex follows them for
 * that `CODEX_HOME` — a home whose sessions moved to another volume still reads (`../codex/rolloutWalk.ts`), and a
 * linked `auth.json` IS the sign-in that store runs on. Two REGISTERED stores resolving to one sessions folder are
 * caught and neither row is measured (`sessionsRootSharers`). A store whose `sessions/` or `auth.json`
 * is linked to an account the register does not hold is not: nothing local tells that account's evidence from the
 * store's own, because for Codex it is the store's own. Reaching it takes the owner re-pointing a registered store's
 * files, the configuration this read reports on, rather than any input from outside the machine.
 *
 * The same holds for what was recorded BEFORE a re-point. A Claude snapshot and probe are keyed by alias and the store
 * path as registered, and a Codex live read by that path and `auth.json`'s stamp; a store re-pointed under an
 * unchanged path keeps its last record until the next `claude gauge` or live read replaces it, and every row shows
 * that record's own instant beside it. This read reports what was recorded, never a fresh measurement.
 *
 * One more, inside a file the scan COULD read: a rollout line that does not parse is passed over, not counted in
 * `filesUnreadable`, so a newer file holding only a broken line leaves an older file's reading the newest one, shown
 * with its own older instant. Counting it would flag healthy stores: the scan reads each file's tail
 * from a byte offset, so that slice's first line is routinely cut, and a file Codex is still writing ends in a line
 * it has not finished. Telling either from a corrupt line needs a line-boundary-aware tail read, which this does not
 * have.
 */
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

import { parseIsoMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import type { ClaudePlanProbeRecord } from "../claude/planProbeRecord.js";
import { claudePlanProbesPort } from "../claude/planProbes.js";
import type { ClaudePlanUsageSnapshot } from "../claude/planUsageSnapshot.js";
import { readClaudePlanUsageSnapshot } from "../claude/planUsageSnapshotStore.js";
import { readCodexAuth } from "../codex/auth.js";
import { type CodexGaugeScan, scanCodexGauge } from "../codex/gaugeScan.js";
import { readCodexAuthStamp } from "../codex/signInAuthStamp.js";
import { type CodexSignInAliasRead, codexSignInPort } from "../codex/signInPort.js";

import { planUsageReport, wantsWeeklyReading } from "./planUsage.js";
import type {
  CodexPlanUsageEvidence,
  CodexStoreFiles,
  CodexStoreState,
  PlanUsageEvidence,
  PlanUsageRead,
  PlanUsageReport,
} from "./planUsageTypes.js";
import { readStoredPlanRegister } from "./storePort.js";
import { productionPlanRegisterSeams } from "./storeRows.js";
import type { RegisteredPlan } from "./types.js";

/** The local readers the report is built from. A seam each, so a test drives the read without a store or a home. */
export interface PlanUsageReadDeps {
  /** The stored register's rows, empty when nothing is registered, or why it could not be read. */
  readonly readRegister: (request: { readonly home: string }) => Promise<Result<readonly RegisteredPlan[], string>>;
  /** Every Claude plan's last probe record. */
  readonly readClaudeProbes: (request: {
    readonly home: string;
  }) => Promise<Result<readonly ClaudePlanProbeRecord[], string>>;
  /** One Claude plan's last weekly snapshot, `undefined` when none was recorded. */
  readonly readClaudeSnapshot: (request: {
    readonly alias: string;
    readonly home: string;
  }) => Result<ClaudePlanUsageSnapshot | undefined, string>;
  /** What the store holds for each Codex alias's last live read, in the order asked. */
  readonly readCodexSignIns: (request: {
    readonly aliases: readonly string[];
    readonly home: string;
  }) => Promise<Result<readonly CodexSignInAliasRead[], string>>;
  /** One Codex store's own files: whether it exists, its `auth.json` shape and stamp. */
  readonly readCodexFiles: (request: { readonly codexHome: string }) => CodexStoreFiles;
  /** One Codex store's newest rollout reading (`undefined` when no log holds one), and how many files it could not read. */
  readonly scanCodex: (request: {
    readonly codexHome: string;
    readonly nowMs: number;
  }) => Pick<CodexGaugeScan, "filesUnreadable" | "gauge">;
  /** The folder a Codex store's `sessions/` really is, symlinks resolved — the path as given when it cannot be. */
  readonly resolveSessionsRoot: (request: { readonly codexHome: string }) => string;
}

/**
 * For each Codex alias, the other registered aliases whose `sessions/` resolves to the same folder. The rollout scan
 * follows a symlinked `sessions/` by design (`../codex/rolloutWalk.ts`), so two stores can read one folder, and a
 * reading in it then cannot be told to be either plan's. Pure.
 *
 * @param roots each Codex plan's alias and its resolved sessions folder
 * @returns each alias's sharers, empty for a store that reads its own folder
 */
export function sessionsRootSharers({
  roots,
}: {
  roots: readonly { readonly alias: string; readonly root: string }[];
}): ReadonlyMap<string, readonly string[]> {
  return new Map(
    roots.map((one) => [
      one.alias,
      roots.filter((other) => other.alias !== one.alias && other.root === one.root).map((other) => other.alias),
    ]),
  );
}

/**
 * One Codex row's rollout evidence: never scanned for a row with no weekly number, `shared` when another registered
 * store reads the same sessions folder, otherwise the scan of its own store.
 *
 * @param sharedWith the other aliases reading this store's sessions folder
 * @param scanFromMs the instant bounding the scan's look-back
 * @returns the gauge evidence
 */
function codexGaugeEvidence({
  deps,
  plan,
  scanFromMs,
  sharedWith,
}: {
  deps: PlanUsageReadDeps;
  plan: RegisteredPlan;
  scanFromMs: number;
  sharedWith: readonly string[];
}): CodexPlanUsageEvidence["gauge"] {
  if (!wantsWeeklyReading({ plan })) {
    return { kind: "not-scanned" };
  }
  if (sharedWith.length > 0) {
    return { kind: "shared", sharedWith };
  }
  const scan = deps.scanCodex({ codexHome: plan.storeDir, nowMs: scanFromMs });
  return { filesUnreadable: scan.filesUnreadable, gauge: scan.gauge, kind: "scanned" };
}

/**
 * A shared read's per-row answer: the one record for `alias`, or the read's own failure for every row it feeds.
 *
 * @returns that row's evidence
 */
function sharedRead<T extends { readonly alias: string }>({
  alias,
  read,
}: {
  alias: string;
  read: Result<readonly T[], string>;
}): PlanUsageRead<T | undefined> {
  if (read.isErr()) {
    return { kind: "unreadable", reason: read.error };
  }
  return { kind: "read", value: read.value.find((one) => one.alias === alias) };
}

/**
 * Read every registered destination's recorded evidence and project the report.
 *
 * The clock is read twice. The first instant only bounds the rollout scan's look-back; the report instant is read
 * AFTER every read has returned, because the Codex scan alone takes seconds (`PLAN_USAGE_INTERVAL_MS`'s measurement,
 * `desktop/src/planUsageTray.ts`) and a reset passing during it must not leave its old percentage `measured`.
 *
 * @param deps the local readers
 * @param home the state home whose register and records are read
 * @param nowIso the wall clock, read once to bound the scan and once to stamp the report
 * @returns the report, or why the register could not be read
 */
export async function readPlanUsageReport({
  deps,
  home,
  nowIso,
}: {
  deps: PlanUsageReadDeps;
  home: string;
  nowIso: () => string;
}): Promise<Result<PlanUsageReport>> {
  const scanFromMs = parseIsoMs({ tsIso: nowIso() })!;
  const register = await deps.readRegister({ home });
  if (register.isErr()) {
    return err([register.error]);
  }
  const plans = register.value;
  const claude = plans.filter((plan) => plan.provider === "claude");
  const codex = plans.filter((plan) => plan.provider === "codex");
  const probes = claude.length === 0 ? ok([]) : await deps.readClaudeProbes({ home });
  const signIns =
    codex.length === 0 ? ok([]) : await deps.readCodexSignIns({ aliases: codex.map((plan) => plan.alias), home });
  const sharers = sessionsRootSharers({
    roots: codex.map((plan) => ({ alias: plan.alias, root: deps.resolveSessionsRoot({ codexHome: plan.storeDir }) })),
  });
  const evidence = plans.map((plan): PlanUsageEvidence => {
    if (plan.provider === "claude") {
      const snapshot = deps.readClaudeSnapshot({ alias: plan.alias, home });
      return {
        plan,
        probe: sharedRead({ alias: plan.alias, read: probes }),
        modelHost: "claude",
        snapshot: snapshot.isErr()
          ? { kind: "unreadable", reason: snapshot.error }
          : { kind: "read", value: snapshot.value },
      };
    }
    const filed = sharedRead({ alias: plan.alias, read: signIns });
    let signIn: PlanUsageRead<CodexSignInAliasRead> = { kind: "read", value: { alias: plan.alias, kind: "absent" } };
    if (filed.kind === "unreadable") {
      signIn = filed;
    } else if (filed.value !== undefined) {
      signIn = { kind: "read", value: filed.value };
    }
    return {
      files: deps.readCodexFiles({ codexHome: plan.storeDir }),
      gauge: codexGaugeEvidence({ deps, plan, scanFromMs, sharedWith: sharers.get(plan.alias)! }),
      plan,
      modelHost: "codex",
      signIn,
    };
  });
  return ok(planUsageReport({ evidence, observedAtIso: nowIso() }));
}

/**
 * Whether one path can be read. `existsSync`, and a stat behind a bare `catch`, answer "not there" for a path that
 * cannot be searched, loops or is denied as well as for one that is absent, so this asks for the error itself: only
 * `ENOENT`/`ENOTDIR` is `missing`, and every other failure is `unreadable`, naming its code.
 *
 * @param path the file or directory
 * @param access the access it must grant, beyond existing — read for a file, read and search for a directory
 * @param what how the reason names the path
 * @returns the path's state, with the error code when it could not be read
 */
function readPathState({ access, path, what }: { access: number; path: string; what: string }): CodexStoreState {
  try {
    statSync(path);
    accessSync(path, access);
    return { kind: "present" };
  } catch (error) {
    let code = "an error with no code";
    if (error instanceof Error && "code" in error && typeof error.code === "string") {
      code = error.code;
    }
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { kind: "missing" };
    }
    return { kind: "unreadable", reason: `${what} could not be read (${code})` };
  }
}

/**
 * Whether a Codex store's directory can be read: `unreadable` when it stats but cannot be listed and entered, since
 * its `auth.json` reading absent proves nothing then.
 *
 * @param codexHome the store directory
 * @returns the store's state
 */
export function readCodexStoreState({ codexHome }: { codexHome: string }): CodexStoreState {
  return readPathState({ access: constants.R_OK | constants.X_OK, path: codexHome, what: "the store directory" });
}

/**
 * Whether a Codex store's `auth.json` is there to read — `missing` only when the filesystem says no such file.
 *
 * @param codexHome the store directory
 * @returns the file's state
 */
export function readCodexAuthFileState({ codexHome }: { codexHome: string }): CodexStoreState {
  return readPathState({ access: constants.R_OK, path: join(codexHome, "auth.json"), what: "auth.json" });
}

/**
 * The real local readers: the stored register, the Claude records, and each Codex store's own files.
 *
 * @returns the production dependencies for {@link readPlanUsageReport}
 */
export function productionPlanUsageReadDeps(): PlanUsageReadDeps {
  const probes = claudePlanProbesPort();
  const signIns = codexSignInPort();
  return {
    readClaudeProbes: async ({ home }) => (await probes.read({ home })).mapErr((error) => error.message),
    readClaudeSnapshot: ({ alias, home }) =>
      readClaudePlanUsageSnapshot({ alias, home }).mapErr((error) => error.message),
    readCodexFiles: ({ codexHome }) => ({
      auth: readCodexAuth({ codexHome }),
      authFile: readCodexAuthFileState({ codexHome }),
      authStamp: readCodexAuthStamp({ codexHome }),
      store: readCodexStoreState({ codexHome }),
    }),
    readCodexSignIns: async ({ aliases, home }) =>
      (await signIns.read({ aliases, home })).mapErr((error) => error.message),
    readRegister: async ({ home }) =>
      (await readStoredPlanRegister({ home, seams: productionPlanRegisterSeams() }))
        .map((snapshot) => {
          if (snapshot === undefined) {
            return [];
          }
          return snapshot.plans;
        })
        .mapErr((error) => error.message),
    resolveSessionsRoot: ({ codexHome }) => {
      const sessions = join(codexHome, "sessions");
      try {
        return realpathSync(sessions);
      } catch {
        // Unresolvable (absent, looping, denied): compared as given, so it shares a folder only with the same path.
        return sessions;
      }
    },
    scanCodex: ({ codexHome, nowMs }) => scanCodexGauge({ codexHome, nowMs }),
  };
}
