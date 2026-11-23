/**
 * The effectful edge of the metered chair check: each pinned-chair session's recent prompts from its
 * transcript, then every `api_request` event Claude Code exported under them, from Datadog.
 *
 * One query covers the whole workspace, scoped to those prompt ids — the machine exports roughly 700 requests
 * every half hour, and reading them all to find one session's would be the wrong shape. Paging rides the
 * reflection loop's existing reader (`../reflect/telemetrySource.ts`), newest first, so a capped read still
 * holds the event that decides. The judgement is `./chairMetered.ts` and `../claude/meteredSpend.ts`.
 *
 * Only the PRESENCE of a request's `organization.id` is read, never which organisation it names: Claude Code
 * stamps it from `~/.claude.json`'s shared `oauthAccount`, so it names the last hand `/login`, not the plan a
 * seat spends. The plan is the boot credential's (`../claude/seatBoot.ts`, `./chairCadence.ts`). For the same reason an
 * absence is judged against the device: a session reading metered-now costs one more single-event query, unless the
 * read already holds an identified request newer than its absence (`readBaseline`).
 */
import { join } from "node:path";

import {
  type ApiRequestSpend,
  absenceSinceIso,
  apiRequestPromptId,
  applyIdentityBaseline,
  baselineInRead,
  type IdentityBaseline,
  identityBaselineQuery,
  judgeMeteredSpend,
  projectApiRequest,
  promptScopedQuery,
} from "../claude/meteredSpend.js";
import { datadogConfigErrorLines } from "../datadog/configErrors.js";
import { createRawRequester } from "../datadog/rawRequest.js";
import { loadDatadogConfig } from "../datadog/source.js";
import { logger } from "../lib/logger.js";
import { TelemetryReadErrors } from "../reflect/errors.js";
import type { TelemetryPageFetcher } from "../reflect/telemetry.js";
import { createTelemetryPageFetcher } from "../reflect/telemetrySource.js";
import { readTail, transcriptPathFor } from "../sessions/liveSessionStore.js";
import { recentPromptIds, type TranscriptPrompt } from "../sessions/promptIds.js";
import { DEPTH_TAIL_BYTES } from "../sessions/tokenDepth.js";
import type { ChairRead } from "./chairGate.js";
import type { ChairMeteredReading, ChairMeteredSession } from "./chairMetered.js";

/**
 * The newest distinct prompts judged per session. A sweep tick is one prompt, so five is at least four ticks
 * back — enough that ingest lag on the newest prompt never leaves a session undescribed.
 *
 * @internal
 */
export const METERED_PROMPTS_PER_SESSION = 5;

/**
 * How far back the window may reach, whatever the prompts say: 24 hours, well inside log retention.
 *
 * @internal
 */
export const METERED_LOOKBACK_MAX_MS = 86_400_000;

/**
 * Margin before the oldest prompt's first transcript line, for a request logged a beat before its line.
 *
 * @internal
 */
export const METERED_WINDOW_MARGIN_MS = 60_000;

/**
 * One logs-events page, the route's own maximum.
 *
 * @internal
 */
export const METERED_PAGE_LIMIT = 1000;

/**
 * Pages read before the read calls itself truncated.
 *
 * @internal
 */
export const METERED_MAX_PAGES = 3;

/**
 * How long one Datadog request may take before the check calls itself unmeasured. Every gated tick pays for
 * this read, so a Datadog that never answers must cost seconds, not the minutes a default fetch would hang.
 *
 * @internal
 */
export const METERED_REQUEST_TIMEOUT_MS = 10_000;

/**
 * The telemetry read's deadline. Only a 429 is retried, and without waiting, so the per-request timeout alone bounds
 * a tick at pages × attempts × timeout — two minutes. This caps it at one slow request and a half, and each page
 * races it rather than the read as a whole, so a page already read is still judged when a later one is in flight.
 *
 * @internal
 */
export const METERED_READ_DEADLINE_MS = 15_000;

/** One session's prompts, or why none were read. */
type SessionPrompts =
  | { readonly sessionId: string; readonly pid: number; readonly prompts: readonly TranscriptPrompt[] }
  | { readonly sessionId: string; readonly pid: number; readonly why: string };

/**
 * Read one session's recent prompts from its transcript tail.
 *
 * @param sessionId the Claude Code session
 * @param pid its process
 * @param claudeHome the resolved `~/.claude`
 * @returns its prompts, or why they could not be read
 */
function sessionPrompts({
  sessionId,
  pid,
  claudeHome,
}: {
  sessionId: string;
  pid: number;
  claudeHome: string;
}): SessionPrompts {
  const path = transcriptPathFor({ projectsDir: join(claudeHome, "projects"), sessionId });
  if (path === undefined) {
    return { pid, sessionId, why: "no transcript was found for this session" };
  }
  try {
    const prompts = recentPromptIds({
      limit: METERED_PROMPTS_PER_SESSION,
      text: readTail({ maxBytes: DEPTH_TAIL_BYTES, path }),
    });
    if (prompts.length === 0) {
      return { pid, sessionId, why: "its transcript names no prompt yet" };
    }
    return { pid, prompts, sessionId };
  } catch (error: unknown) {
    return { pid, sessionId, why: `its transcript could not be read (${String(error)})` };
  }
}

/** What the page loop collected. */
type SpendRead =
  | {
      readonly kind: "read";
      readonly spends: readonly ApiRequestSpend[];
      /** The prompt each event that did not project was made under, undefined where even that is unreadable. */
      readonly unprojected: readonly (string | undefined)[];
      readonly truncated: boolean;
    }
  | { readonly kind: "unmeasured"; readonly why: string };

/**
 * Project one page's events, keeping the prompt of each one that is not an `api_request` this reader understands.
 *
 * @param events one page's raw events
 * @returns the projected spends and the prompts of the events that did not project
 */
function projectPage({ events }: { events: readonly unknown[] }): {
  spends: readonly ApiRequestSpend[];
  unprojected: readonly (string | undefined)[];
} {
  const spends: ApiRequestSpend[] = [];
  const unprojected: (string | undefined)[] = [];
  for (const event of events) {
    const result = projectApiRequest({ event });
    if (result.isOk()) {
      spends.push(result.value);
    } else {
      unprojected.push(apiRequestPromptId({ event }));
    }
  }
  return { spends, unprojected };
}

/** Why a read the deadline stopped before its first page is unmeasured. */
const DEADLINE_WHY = `Datadog did not answer within ${String(METERED_READ_DEADLINE_MS / 1000)}s, so the tick did not wait for it`;

/**
 * End the page loop early: what was already read is judged, truncated, and only an empty read is unmeasured.
 *
 * @param pages how many pages had arrived
 * @param spends every event projected so far
 * @param unprojected the prompts of the events so far that did not project
 * @param why what stopped the read, printed only when no page had arrived
 * @returns the truncated read, or why nothing could be judged
 */
function stopEarly({
  pages,
  spends,
  unprojected,
  why,
}: {
  pages: number;
  spends: readonly ApiRequestSpend[];
  unprojected: readonly (string | undefined)[];
  why: string;
}): SpendRead {
  if (pages > 0) {
    return { kind: "read", spends, truncated: true, unprojected };
  }
  return { kind: "unmeasured", why };
}

/**
 * Whether the deadline has already passed. Racing it against a settled value asks without waiting: an already
 * settled deadline wins because it is listed first, where a flag set from its `.then` would lag a microtask and
 * let one more page start.
 *
 * @param expired settles when the read's deadline passes
 * @returns true once the deadline has passed
 */
async function hasExpired({ expired }: { expired: Promise<"expired"> }): Promise<boolean> {
  return (await Promise.race([expired, Promise.resolve("live" as const)])) === "expired";
}

/**
 * Page through every event under one query, newest first.
 *
 * A failed or partial page AFTER the first, or a deadline passing while one is in flight, stops the read and
 * marks it truncated rather than discarding it: the pages arrive newest first, so what was already read holds
 * the event that decides. Only a first page that fails, comes back partial or never arrives leaves nothing to
 * judge. No page is started once the deadline has passed.
 *
 * @param query the prompt-scoped query
 * @param fromMs the window start, epoch ms
 * @param toMs the window end, epoch ms
 * @param fetchPage one logs-events page read
 * @param expired settles when the read's deadline passes; each page races it
 * @returns every projected event and what was not seen, or why nothing could be read
 */
async function readSpends({
  query,
  fromMs,
  toMs,
  fetchPage,
  expired,
}: {
  query: string;
  fromMs: number;
  toMs: number;
  fetchPage: TelemetryPageFetcher;
  expired: Promise<"expired">;
}): Promise<SpendRead> {
  const spends: ApiRequestSpend[] = [];
  const unprojected: (string | undefined)[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < METERED_MAX_PAGES; pages += 1) {
    const page: Awaited<ReturnType<TelemetryPageFetcher>> | "expired" = (await hasExpired({ expired }))
      ? "expired"
      : await Promise.race([fetchPage({ cursor, fromMs, limit: METERED_PAGE_LIMIT, query, toMs }), expired]);
    if (page === "expired") {
      return stopEarly({ pages, spends, unprojected, why: DEADLINE_WHY });
    }
    if (page.isErr() || page.value.status !== "done") {
      const why = page.isErr()
        ? page.error.message
        : `Datadog answered status "${page.value.status}", so the page is partial and cannot be judged`;
      return stopEarly({ pages, spends, unprojected, why });
    }
    const projected = projectPage({ events: page.value.events });
    spends.push(...projected.spends);
    unprojected.push(...projected.unprojected);
    cursor = page.value.nextCursor;
    if (cursor === null) {
      return { kind: "read", spends, truncated: false, unprojected };
    }
  }
  return { kind: "read", spends, truncated: true, unprojected };
}

/**
 * Read the metered verdict of every session in the pinned chair.
 *
 * @param read the chair read the Fable question already made
 * @param claudeHome the resolved `~/.claude`
 * @param fetchPage one logs-events page read
 * @param nowMs the instant the window ends, injected so a replay judges its own moment
 * @param expired settles when the telemetry read's deadline passes
 * @returns each session's verdict, or why the telemetry could not be read at all
 */
export async function readChairMetered({
  read,
  claudeHome,
  fetchPage,
  nowMs,
  expired,
}: {
  read: ChairRead;
  claudeHome: string;
  fetchPage: TelemetryPageFetcher;
  nowMs: number;
  expired: Promise<"expired">;
}): Promise<ChairMeteredReading> {
  if (read.kind === "unresolved") {
    return { kind: "unmeasured", why: `the chair could not be read: ${read.why}` };
  }
  const perSession = read.sessions.map(({ sessionId, pid }) => sessionPrompts({ claudeHome, pid, sessionId }));
  const prompts = perSession.flatMap((entry) => ("prompts" in entry ? entry.prompts : []));
  const query = promptScopedQuery({ promptIds: prompts.map((prompt) => prompt.promptId) });
  if (query === undefined) {
    return { kind: "unmeasured", why: "no session in the pinned workspace named a prompt to ask the telemetry about" };
  }
  const oldestMs = Math.min(...prompts.map((prompt) => Date.parse(prompt.firstIso)));
  const fromMs = Math.max(oldestMs - METERED_WINDOW_MARGIN_MS, nowMs - METERED_LOOKBACK_MAX_MS);
  const spent = await readSpends({ expired, fetchPage, fromMs, query, toMs: nowMs });
  if (spent.kind === "unmeasured") {
    return spent;
  }
  const sessions: ChairMeteredSession[] = [];
  for (const entry of perSession) {
    if (!("prompts" in entry)) {
      sessions.push({ pid: entry.pid, sessionId: entry.sessionId, verdict: { kind: "unmeasured", why: entry.why } });
      continue;
    }
    const own = new Set(entry.prompts.map((prompt) => prompt.promptId));
    const events = spent.spends.filter((spend) => own.has(spend.promptId));
    const verdict = judgeMeteredSpend({ events });
    const sinceIso = absenceSinceIso({ events });
    if (verdict.kind !== "metered-now" || sinceIso === undefined) {
      sessions.push({ pid: entry.pid, sessionId: entry.sessionId, verdict });
      continue;
    }
    const baseline = await readBaseline({ events, expired, fetchPage, sinceIso, spends: spent.spends, toMs: nowMs });
    sessions.push({
      pid: entry.pid,
      sessionId: entry.sessionId,
      verdict: applyIdentityBaseline({ baseline, verdict }),
    });
  }
  return { kind: "measured", sessions, truncated: spent.truncated, unprojected: spent.unprojected.length };
}

/**
 * Whether this device named an organisation at or after a session's absence began — from the read when it already
 * holds such a request, else from one single-event page of Datadog over that span (`../claude/meteredSpend.ts` §
 * Absence is read against a baseline, never alone).
 *
 * @param events the session's own requests, whose `user.id` values scope the query
 * @param spends every request the read projected, any session's
 * @param sinceIso where the session's current run without an organisation began
 * @param toMs the window end, epoch ms
 * @param fetchPage one logs-events page read
 * @param expired settles when the read's deadline passes; the page races it
 * @returns the baseline, or why it could not be read
 */
async function readBaseline({
  events,
  spends,
  sinceIso,
  toMs,
  fetchPage,
  expired,
}: {
  events: readonly ApiRequestSpend[];
  spends: readonly ApiRequestSpend[];
  sinceIso: string;
  toMs: number;
  fetchPage: TelemetryPageFetcher;
  expired: Promise<"expired">;
}): Promise<IdentityBaseline> {
  if (baselineInRead({ sinceIso, spends })) {
    return { kind: "established" };
  }
  if (await hasExpired({ expired })) {
    return { kind: "unread", why: DEADLINE_WHY };
  }
  const deviceIds = events.flatMap((event) => (event.deviceId === undefined ? [] : [event.deviceId]));
  const page = await Promise.race([
    fetchPage({
      cursor: null,
      fromMs: Date.parse(sinceIso),
      limit: 1,
      query: identityBaselineQuery({ deviceIds }),
      toMs,
    }),
    expired,
  ]);
  if (page === "expired") {
    return { kind: "unread", why: DEADLINE_WHY };
  }
  if (page.isErr()) {
    return { kind: "unread", why: page.error.message };
  }
  if (page.value.status !== "done") {
    return { kind: "unread", why: `Datadog answered status "${page.value.status}"` };
  }
  if (page.value.events.length === 0) {
    return { kind: "absent" };
  }
  return { kind: "established" };
}

/**
 * Read the metered verdict against the real Datadog, with the credentials the rest of the CLI resolves.
 *
 * @param read the chair read the Fable question already made
 * @param claudeHome the resolved `~/.claude`
 * @param env the process environment, read for `DD_*` only
 * @param nowMs the instant the window ends
 * @returns each session's verdict, or why the telemetry could not be read at all
 */
export async function readChairMeteredLive({
  read,
  claudeHome,
  env,
  nowMs,
}: {
  read: ChairRead;
  claudeHome: string;
  env: Readonly<Record<string, string | undefined>>;
  nowMs: number;
}): Promise<ChairMeteredReading> {
  const config = loadDatadogConfig({ env });
  if (config.isErr()) {
    return {
      kind: "unmeasured",
      why: TelemetryReadErrors.credentialsUnset({ reasons: datadogConfigErrorLines({ error: config.error }) }).message,
    };
  }
  const requester = createRawRequester({
    config: config.value,
    // A per-request deadline: an aborted fetch is a failed attempt, which the requester already turns into an
    // error, and so into an unmeasured tick rather than a stalled one.
    fetchImpl: async (url, init) => {
      const response = await globalThis.fetch(url, {
        ...init,
        signal: AbortSignal.timeout(METERED_REQUEST_TIMEOUT_MS),
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name] = value;
      });
      return { headers, status: response.status, text: () => response.text() };
    },
    logger,
    // No rate-limit wait: a tick that would sit out a reset is a stalled tick. A throttled read retries at once,
    // fails, and prints UNMEASURED — the gate's answer for any read it could not make.
    sleep: () => Promise.resolve(),
  });
  const fetchPage = createTelemetryPageFetcher({ requester });
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<"expired">((resolve) => {
    timer = setTimeout(() => {
      resolve("expired");
    }, METERED_READ_DEADLINE_MS);
  });
  try {
    return await readChairMetered({
      claudeHome,
      expired,
      fetchPage,
      nowMs,
      read,
    });
  } finally {
    clearTimeout(timer);
  }
}
