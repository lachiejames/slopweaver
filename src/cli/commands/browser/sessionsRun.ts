/**
 * `slopweaver browser sessions` — every interaction session this home holds, with who opened it, whether that
 * opener is still alive, whether a Playwright daemon still holds its tab, its page, its age, and what the
 * next `machine reap` will do with it.
 *
 * A reader could not tell which of the Chrome windows agents had left open were safe to
 * close. So what can be closed is never a guess here — the listing runs the SAME judgement the reap runs
 * (`../../../browser/sessionReap.ts`) over the same readings, and prints its verdict beside each row. Age is
 * printed for the owner to read and decides nothing.
 */
import { type InteractionSession, type SessionOwner, sessionIsLive } from "../../../browser/interactionSession.js";
import {
  listStoredInteractionSessions,
  type StoredInteractionSession,
} from "../../../browser/interactionSessionStore.js";
import {
  type BrowserReapAction,
  type BrowserReapVerdict,
  gatherBrowserReapInput,
  judgeBrowserSessions,
  type LiveRegistryRow,
  type OwnerLiveness,
} from "../../../browser/sessionReap.js";
import { logger } from "../../../lib/logger.js";
import { humanDuration } from "../../../lib/progressRender.js";
import { readListeningPorts, readLiveBrowserOwners, readProcessTable } from "../../../live/machine/devServerRead.js";
import type { ProcessRow } from "../../../live/standing/processes.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";

/** One session as `browser sessions` reports it — the `--json` row, and what the human line is drawn from. */
export interface BrowserSessionRow {
  readonly id: string;
  readonly ownerSessionId: string;
  readonly owner: SessionOwner | null;
  readonly ownerLiveness: OwnerLiveness;
  readonly ownerWhy: string;
  readonly daemon: { readonly connected: boolean; readonly pids: readonly number[] };
  /** The page its last look was of, or `null` when nothing has been read through it. */
  readonly page: string | null;
  readonly openedAtIso: string;
  /** Seconds since it was opened, or `null` when the record's timestamp does not parse. Display only. */
  readonly ageSeconds: number | null;
  /** Whether a later command may still act through it — the idle TTL, which is NOT what the reap reads. */
  readonly interaction: "active" | "idle";
  readonly reapVerdict: BrowserReapAction;
  readonly reapReason: string;
}

/**
 * Join each record to its verdict.
 *
 * @param stored the records, in listing order
 * @param verdicts the judgement over those same records, in the same order
 * @param nowIso the instant age and interaction are read against
 * @returns one row per record
 */
export function browserSessionRows({
  stored,
  verdicts,
  nowIso,
}: {
  stored: readonly StoredInteractionSession[];
  verdicts: readonly BrowserReapVerdict[];
  nowIso: string;
}): readonly BrowserSessionRow[] {
  return stored.map(({ session }, index) => {
    const verdict = verdicts[index]!;
    return {
      ageSeconds: ageSecondsOf({ nowIso, session }),
      daemon: { connected: verdict.daemonPids.length > 0, pids: verdict.daemonPids },
      id: session.id,
      interaction: sessionIsLive({ nowIso, session }) ? "active" : "idle",
      openedAtIso: session.openedAtIso,
      owner: session.owner,
      ownerLiveness: verdict.owner,
      ownerSessionId: session.ownerSessionId,
      ownerWhy: verdict.ownerWhy,
      page: verdict.url,
      reapReason: verdict.why,
      reapVerdict: verdict.action,
    };
  });
}

/* Seconds between opening and now, or `null` when either instant does not parse. */
function ageSecondsOf({ session, nowIso }: { session: InteractionSession; nowIso: string }): number | null {
  const opened = Date.parse(session.openedAtIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(opened) || Number.isNaN(now)) {
    return null;
  }
  return Math.max(0, Math.round((now - opened) / 1000));
}

/* The opener's recorded identity, as the fields that were recorded. */
function ownerLabel({ row }: { row: BrowserSessionRow }): string {
  const parts: string[] = [];
  if (row.ownerSessionId !== "") {
    parts.push(`session ${row.ownerSessionId.slice(0, 8)}`);
  }
  if (row.owner !== null) {
    if (row.owner.pid !== null) {
      parts.push(`pid ${String(row.owner.pid)}`);
    }
    if (row.owner.cmuxWorkspace !== null) {
      parts.push(`workspace ${row.owner.cmuxWorkspace.slice(0, 8)}`);
    }
    if (row.owner.runSlug !== null) {
      parts.push(`run ${row.owner.runSlug}`);
    }
  }
  if (parts.length === 0) {
    return "no opener recorded";
  }
  return parts.join(" · ");
}

/**
 * The human listing: a count line, then two lines per session — its state, then its page and opener.
 *
 * @returns the lines to print
 */
export function renderBrowserSessionLines({ rows }: { rows: readonly BrowserSessionRow[] }): readonly string[] {
  if (rows.length === 0) {
    return ["browser sessions: none open"];
  }
  const keeps = rows.filter((row) => row.reapVerdict === "keep").length;
  const closes = rows.filter((row) => row.reapVerdict === "close").length;
  const forgets = rows.filter((row) => row.reapVerdict === "forget").length;
  const lines = [
    `browser sessions: ${String(rows.length)} held · the next \`machine reap\` keeps ${String(keeps)}, ` +
      `closes ${String(closes)}, forgets ${String(forgets)} whose tab no daemon holds`,
  ];
  for (const row of rows) {
    let age = "age unreadable";
    if (row.ageSeconds !== null) {
      age = `${humanDuration({ seconds: row.ageSeconds })} old`;
    }
    const daemon = row.daemon.connected ? "daemon connected" : "no daemon (Chrome: not connected)";
    lines.push(
      `  ${row.id}  ${row.interaction}  ${age}  owner ${row.ownerLiveness}  ${daemon}  → reap ${row.reapVerdict}: ${row.reapReason}`,
    );
    let page = "(never read)";
    if (row.page !== null) {
      page = row.page;
    }
    lines.push(`      ${page}  — opened by ${ownerLabel({ row })}`);
  }
  return lines;
}

/** The readings `browser sessions` takes, injected so a test never shells out. */
export interface BrowserSessionsDeps {
  readonly stored: () => readonly StoredInteractionSession[];
  readonly processes: () => readonly ProcessRow[] | undefined;
  readonly liveOwners: (input: { processes: readonly ProcessRow[] }) => readonly LiveRegistryRow[] | undefined;
  readonly listeningPorts: () => ReadonlySet<number> | undefined;
  readonly nowIso: () => string;
}

/**
 * The real readings over one home.
 *
 * @param home the state home the records live under
 * @returns the production {@link BrowserSessionsDeps}
 */
function productionBrowserSessionsDeps({ home }: { home: string }): BrowserSessionsDeps {
  return {
    listeningPorts: () => readListeningPorts(),
    liveOwners: ({ processes }) => readLiveBrowserOwners({ processes }),
    nowIso: () => new Date().toISOString(),
    processes: () => readProcessTable(),
    stored: () => listStoredInteractionSessions({ home }),
  };
}

/**
 * Run `browser sessions` over injected readings.
 *
 * @param json whether machine-readable output was asked for
 * @param deps the readings
 * @returns `EXIT_OK`, or `EXIT_ERROR` when the process table could not be read — without it no opener and
 *   no daemon can be judged, and a listing that guessed would be the thing this verb exists to replace
 */
export function runBrowserSessionsWithDeps({ json, deps }: { json: boolean; deps: BrowserSessionsDeps }): number {
  const stored = deps.stored();
  const processes = deps.processes();
  if (processes === undefined) {
    logger.error({ msg: "browser sessions: the process table could not be read, so no opener or daemon was judged" });
    return EXIT_ERROR;
  }
  const nowIso = deps.nowIso();
  const input = gatherBrowserReapInput({
    nowIso,
    processes,
    readers: {
      listeningPorts: deps.listeningPorts,
      liveOwners: () => deps.liveOwners({ processes }),
    },
    stored,
  });
  const rows = browserSessionRows({ nowIso, stored, verdicts: judgeBrowserSessions({ input }) });
  if (json) {
    logger.out({ line: JSON.stringify(rows, null, 2) });
    return EXIT_OK;
  }
  for (const line of renderBrowserSessionLines({ rows })) {
    logger.out({ line });
  }
  return EXIT_OK;
}

/**
 * Run `browser sessions`: list what this home is holding open, and what the reap will do with each.
 *
 * @param json whether machine-readable output was asked for
 * @param home the state home
 * @returns the process exit code
 */
export function runBrowserSessions({ json, home }: { json: boolean; home: string }): number {
  return runBrowserSessionsWithDeps({ deps: productionBrowserSessionsDeps({ home }), json });
}
