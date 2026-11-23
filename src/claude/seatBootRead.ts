/**
 * The effectful edge of `./seatBoot.ts`: read what each live session in the pinned chair was booted on.
 *
 * Local and read-only, and nothing else: `ps eww` and `ps ww` per session, whose difference is the environment
 * carrying the two boot variables; `lsof` for descriptor 3, only when those declare it; `ps -o lstart=` once those
 * finish, binding the read to the session's own process; and one `stat` per plan token, so a descriptor matches a
 * plan by device and inode. None reaches a provider and none writes. The chair's
 * sessions come from `../supervisor/chairRead.ts`, the same pinned-workspace walk the chair gate takes, without
 * its transcript read.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

import { readProcessStarts } from "../fleet/processStarts.js";
import { readPinnedChairSessionIds } from "../supervisor/chairRead.js";
import { readBoundChairSessionIds } from "../supervisor/chairRecords.js";
import type { ClaudeAccount } from "./contracts.js";
import {
  bindBootToProcess,
  chairPlanVerdict,
  type GaugeChair,
  type PlanTokenIdentity,
  parseBootEnv,
  parseLsofFile,
  planForSeatBoot,
  type SeatBootPlan,
} from "./seatBoot.js";
import { SETUP_TOKEN_FD, setupTokenPath } from "./seatToken.js";

/** How long one process read may block. One local snapshot — quick, or broken. */
const READ_TIMEOUT_MS = 10_000;

/** More stdout than one process's `ps eww` line carries, so a read never dies of ENOBUFS. */
const MAX_BUFFER = 1024 * 1024;

/** One read-only process listing's stdout, or why it could not be taken. */
export type ProcessRead = (args: {
  binary: "lsof" | "ps";
  args: readonly string[];
}) => { readonly text: string } | { readonly why: string };

/** What every listing runs under, so `lstart` prints exactly as Claude Code's registry records `procStart`. */
const LISTING_ENV = { LC_ALL: "C", TZ: "UTC" } as const;

/*
 * One read-only process listing's stdout, or why it could not be taken — a missing binary, a pid that exited, a
 * process owned by someone else. The caller reports the reason; it never becomes a plan. It runs under
 * LISTING_ENV, which changes how `ps` prints a time and nothing about the environment it reads off another process.
 * Measured: `TZ=UTC LC_ALL=C ps -o lstart= -p <pid>` equalled `procStart` in 12 of 12 live
 * `~/.claude/sessions/*.json` files.
 */
function readOnly({
  binary,
  args,
}: {
  binary: "lsof" | "ps";
  args: readonly string[];
}): { readonly text: string } | { readonly why: string } {
  try {
    return {
      text: execFileSync(binary, [...args], {
        encoding: "utf8",
        env: { ...process.env, ...LISTING_ENV },
        maxBuffer: MAX_BUFFER,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: READ_TIMEOUT_MS,
      }),
    };
  } catch (error: unknown) {
    return { why: `\`${binary}\` could not read it (${error instanceof Error ? error.message : String(error)})` };
  }
}

/**
 * Identify each configured plan's setup token file, so a descriptor is matched to a plan by the file it IS rather
 * than the string it was reached by. A plan with no token file carries neither field; one whose token exists but
 * cannot be `stat`ed carries why, so no descriptor is matched past it.
 *
 * @param accounts the configured plans
 * @returns one entry per plan, carrying its token file's device and inode, or why they could not be read
 */
export function planTokenIdentities({
  accounts,
}: {
  accounts: readonly ClaudeAccount[];
}): readonly PlanTokenIdentity[] {
  return accounts.map((account) => {
    try {
      const stat = statSync(setupTokenPath({ storeDir: account.storeDir }), { bigint: true });
      return { alias: account.alias, identity: { dev: stat.dev.toString(), ino: stat.ino.toString() } };
    } catch (error: unknown) {
      // No file is no token, so it cannot be the descriptor's; any other failure leaves the owner unproven.
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return { alias: account.alias };
      }
      return { alias: account.alias, unread: error instanceof Error ? error.message : String(error) };
    }
  });
}

/**
 * Read which plan one live process was booted on.
 *
 * @param accounts the configured plans
 * @param planTokens each plan's setup token file, identified
 * @param pid the live Claude Code process
 * @param read the read-only `ps`/`lsof` listing, injected so the decisions over its text are testable
 * @returns the plan, or why it could not be said
 */
export function readSeatBoot({
  accounts,
  planTokens,
  pid,
  read,
}: {
  accounts: readonly ClaudeAccount[];
  planTokens: readonly PlanTokenIdentity[];
  pid: number;
  read: ProcessRead;
}): SeatBootPlan {
  const ps = read({ args: ["eww", "-o", "command=", "-p", String(pid)], binary: "ps" });
  if ("why" in ps) {
    return { kind: "unresolved", why: `its environment was not read: ${ps.why}` };
  }
  const command = read({ args: ["ww", "-o", "command=", "-p", String(pid)], binary: "ps" });
  if ("why" in command) {
    return { kind: "unresolved", why: `its command line was not read: ${command.why}` };
  }
  const env = parseBootEnv({ commandLine: command.text, psLine: ps.text });
  if (env === undefined) {
    return { kind: "unresolved", why: "its environment is not visible to `ps`, so what it booted on cannot be read" };
  }
  if (env.tokenFd === undefined) {
    return planForSeatBoot({ accounts, env, planTokens });
  }
  const fd = String(SETUP_TOKEN_FD);
  const listing = read({ args: ["-a", "-p", String(pid), "-d", fd, "-FDin"], binary: "lsof" });
  if ("why" in listing) {
    return planForSeatBoot({
      accounts,
      env,
      planTokens,
      tokenFileUnread: `descriptor ${fd} was not read: ${listing.why}`,
    });
  }
  const tokenFile = parseLsofFile({ text: listing.text });
  return planForSeatBoot({ accounts, env, planTokens, ...(tokenFile === undefined ? {} : { tokenFile }) });
}

/**
 * Read the plan each of the given live sessions is spending, off its boot credential.
 *
 * The sessions are the caller's own snapshot of the chair, so a caller that has already read the pinned workspace
 * — `supervisor tick-record`, through the chair gate — judges the sessions it read, never a second discovery.
 *
 * @param accounts the configured plans, paused ones included: a chair booted on a paused plan is still on it
 * @param sessions the live Claude Code sessions to read, in the order to report them, each with the process start
 *   its registry file records — a plan is kept only when the pid still holds that process once the read is done
 * @param read the read-only `ps`/`lsof` listing, injected only by tests
 * @returns each session's plan and the mark they earn together
 */
export function readChairPlansForSessions({
  accounts,
  sessions,
  read = readOnly,
}: {
  accounts: readonly ClaudeAccount[];
  sessions: readonly { readonly sessionId: string; readonly pid: number; readonly procStart?: string }[];
  read?: ProcessRead;
}): GaugeChair {
  const planTokens = planTokenIdentities({ accounts });
  return chairPlanVerdict({
    sessions: sessions.map(({ sessionId, pid, procStart }) => {
      const booted = readSeatBoot({ accounts, pid, planTokens, read });
      const observedStart = read({ args: ["-o", "lstart=", "-p", String(pid)], binary: "ps" });
      return { pid, plan: bindBootToProcess({ observedStart, plan: booted, procStart }), sessionId };
    }),
  });
}

/**
 * Read the plan each chair session among the given pids is spending — the caller already holds the chair's pids,
 * so this binds them to the registry and the process table and reads no workspace again.
 *
 * @param accounts the configured plans, paused ones included
 * @param claudeHome the resolved `~/.claude`, where Claude Code registers its live sessions
 * @param pids the chair's pids, from the caller's own read of the pinned workspace
 * @returns each session's plan and the mark they earn together, or why the sessions could not be named
 */
export function readChairPlansForPids({
  accounts,
  claudeHome,
  pids,
}: {
  accounts: readonly ClaudeAccount[];
  claudeHome: string;
  pids: readonly number[];
}): GaugeChair {
  const registry = readBoundChairSessionIds({ claudeHome, pids, readStarts: readProcessStarts });
  if (registry.kind === "unresolved") {
    return chairPlanVerdict({ sessions: [], unread: registry.why });
  }
  return readChairPlansForSessions({ accounts, sessions: registry.sessions });
}

/**
 * Read the plan every live session in the pinned chair is spending.
 *
 * @param accounts the configured plans
 * @param claudeHome the resolved `~/.claude`, where Claude Code registers its live sessions
 * @param home the Slopweaver home whose supervisor pin names the chair's host
 * @returns each session's plan and the mark they earn together, or why the chair itself could not be read
 */
export async function readChairPlans({
  accounts,
  claudeHome,
  home,
}: {
  accounts: readonly ClaudeAccount[];
  claudeHome: string;
  home: string;
}): Promise<GaugeChair> {
  const read = await readPinnedChairSessionIds({ claudeHome, home });
  if (read.kind === "unresolved") {
    return chairPlanVerdict({ sessions: [], unread: read.why });
  }
  return readChairPlansForSessions({ accounts, sessions: read.sessions });
}
