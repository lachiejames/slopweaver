/**
 * Decide, from Claude Code's own telemetry, whether a session is spending a subscription plan or a metered
 * (per-token) Console organisation — the signal a metered session is refused on.
 *
 * ## The signal, measured
 *
 * Every `claude_code.api_request` log event Claude Code exports carries `cost_usd`, `prompt.id` and, for a
 * claude.ai subscription credential, `organization.id`, `user.email` and `user.account_uuid`. A Console
 * credential resolves NONE of the three. Measured over fourteen days, 315,242 events: exactly four
 * lacked `organization.id`, $7.38 in under two minutes — a chair on Fable, after a `/login` onto a Console
 * organisation. Reproduce:
 * `slopweaver datadog logs 'service:claude-code @event.name:api_request -@organization.id:*' --from 14d`.
 *
 * ## Why this is not the environment-variable classifier
 *
 * `./ambientCredential.ts` reads `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `apiKeyHelper`. A `/login`
 * onto a Console organisation sets none of them, so it answered `subscription` through the whole incident.
 * The telemetry names what the session actually presented, request by request, which is the only thing that
 * would have caught it (the "is my fleet on my Max plans" page).
 *
 * ## The join
 *
 * There is no session id on these events (`OTEL_METRICS_INCLUDE_SESSION_ID=false`, and the logs never carry
 * one). `prompt.id` is the key: it equals the `promptId` field on the session's own transcript records, so a
 * reader asks for the events of a session's recent prompts and nothing else. The transcript half is
 * `../sessions/promptIds.ts`.
 *
 * ## Absence is read against a baseline, never alone
 *
 * Claude Code stamps `organization.id` from `~/.claude.json`'s SHARED `oauthAccount` (`../supervisor/chairCadence.ts`),
 * so the field says whether THAT block exists, not what a seat presented. Once nothing on the machine holds a hand
 * `/login` — the setup-token-only shape `./seatAttest.ts` enforces, and its own remedy, `claude auth logout` on the
 * default store, removes the block — every request lacks it. Measured: the last identified event preceded
 * a restart onto 2.1.287, and every request after it lacked the field, plan seats included. Reproduce:
 * `slopweaver datadog logs 'service:claude-code @event.name:api_request @organization.id:*' --from 1h` (zero) against the
 * same query with `-@organization.id:*`, and `jq .oauthAccount ~/.claude.json` (null).
 *
 * So a missing organisation reads as metered only when, at or after the start of the session's current run without one,
 * this same device (`user.id`, a hash of the install) made a request that named one. In the incident the chair's run
 * lacked it for under two minutes while identified requests carried on around it, so the incident still refuses.
 * Without that baseline the absence is device-wide and tells a Console credential from a plan by nothing, so the
 * session is UNMEASURED and printed rather than refused. A restart is the trap here: the five-prompt read straddles one,
 * which is why a baseline older than the absence does not count.
 *
 * ## Newest decides
 *
 * A chair that was metered and has since logged back onto a plan is not metered NOW; refusing it until the
 * window ages out would make the hatch routine. So the newest event decides, and earlier metered spend is
 * reported rather than refused. On the incident's own transcript the chair's next two prompts went out on a
 * plan organisation again, which is exactly this shape.
 */
import { z } from "zod";

import { err, ok, type Result } from "../lib/result.js";

/** Every Claude Code API request, as the OTLP logs track names it. */
const API_REQUEST_QUERY = "service:claude-code @event.name:api_request";

/** A prompt id as Claude Code mints it — a lowercase UUID. Anything else is never put into a query. */
const PROMPT_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * One `api_request` event, reduced to what the judgement reads.
 *
 * `organization` is optional because its absence IS the signal. A `null`, an object with no id, and an empty
 * id are not a presence either, so all of them read as metered: were they refused as unprojectable instead, an OLDER event that did name an
 * organisation would become the newest and the session would read as a plan. The timestamp must be a real
 * instant for the same reason — an unparseable one could never be displaced as the newest.
 */
const API_REQUEST_EVENT = z.object({
  attributes: z.object({
    attributes: z.object({
      cost_usd: z.number(),
      organization: z.object({ id: z.string().nullable().optional() }).nullable().optional(),
      prompt: z.object({ id: z.string().min(1) }),
      user: z.object({ id: z.string().optional() }).optional(),
    }),
    timestamp: z.iso.datetime({ offset: true }),
  }),
});

/** A device id as Claude Code mints it — a lowercase SHA-256 hex digest. Anything else is never put into a query. */
const DEVICE_ID_SHAPE = /^[0-9a-f]{64}$/;

/** One API request's spend, and whether it resolved a claude.ai organisation. */
export interface ApiRequestSpend {
  readonly tsIso: string;
  readonly promptId: string;
  readonly costUsd: number;
  /** True when the event resolved no organisation — a Console credential, billed per token. */
  readonly metered: boolean;
  /**
   * The claude.ai organisation the request resolved, present exactly when `metered` is false. It is what names
   * the PLAN a session is spending — the boot line cannot, because a seat boots on a token over a descriptor
   * against an unbound store, and a `/login` moves it anyway (`../supervisor/chairCadence.ts`).
   */
  readonly organizationId?: string;
  /** The install the request came from (`user.id`), present when the event carries a well-formed one. */
  readonly deviceId?: string;
}

/**
 * Project one raw logs-events element into an {@link ApiRequestSpend}.
 *
 * A plain `Result` rather than a typed union: a caller only ever counts a miss and names it, exactly as
 * `../reflect/telemetry.ts`'s projection does.
 *
 * @param event one element of the logs-events `data` array, unvalidated
 * @returns the projected spend, or why this event is not one
 */
export function projectApiRequest({ event }: { event: unknown }): Result<ApiRequestSpend> {
  const parsed = API_REQUEST_EVENT.safeParse(event);
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  const inner = parsed.data.attributes.attributes;
  const deviceId = inner.user?.id;
  const spend = {
    costUsd: inner.cost_usd,
    promptId: inner.prompt.id,
    tsIso: parsed.data.attributes.timestamp,
    ...(deviceId !== undefined && DEVICE_ID_SHAPE.test(deviceId) ? { deviceId } : {}),
  };
  const organizationId = inner.organization?.id;
  if (organizationId == null || organizationId === "") {
    return ok({ ...spend, metered: true });
  }
  return ok({ ...spend, metered: false, organizationId });
}

/** The part of an event that names its prompt, readable even when the rest of it will not project. */
const PROMPT_OF_EVENT = z.object({
  attributes: z.object({ attributes: z.object({ prompt: z.object({ id: z.string().min(1) }) }) }),
});

/**
 * The prompt an `api_request` event was made under, read even when {@link projectApiRequest} refuses the event.
 *
 * @param event one element of the logs-events `data` array, unvalidated
 * @returns the prompt id, or undefined when the event names none
 */
export function apiRequestPromptId({ event }: { event: unknown }): string | undefined {
  const parsed = PROMPT_OF_EVENT.safeParse(event);
  if (!parsed.success) {
    return undefined;
  }
  return parsed.data.attributes.attributes.prompt.id;
}

/**
 * The newest of a session's requests, a metered one winning a same-instant tie so the pair never reads as a plan.
 *
 * @param events every projected request, in any order
 * @returns the newest, or undefined when there are none
 */
export function newestApiRequestSpend({ events }: { events: readonly ApiRequestSpend[] }): ApiRequestSpend | undefined {
  const [head, ...rest] = events;
  if (head === undefined) {
    return undefined;
  }
  return rest.reduce((best, event) => (newerThan({ a: event, b: best }) ? event : best), head);
}

/**
 * The Datadog query for every API request made under a set of prompts.
 *
 * An id that is not a UUID is dropped rather than escaped: it came from a transcript line, and a query built
 * from arbitrary text is a query nobody reviewed.
 *
 * @param promptIds the prompts to ask about
 * @returns the query, or undefined when no id survived — there is then nothing to ask
 */
export function promptScopedQuery({ promptIds }: { promptIds: readonly string[] }): string | undefined {
  const usable = [...new Set(promptIds.filter((id) => PROMPT_ID_SHAPE.test(id)))];
  if (usable.length === 0) {
    return undefined;
  }
  return `${API_REQUEST_QUERY} @prompt.id:(${usable.join(" OR ")})`;
}

/** What one session's recent telemetry says about the credential it presents. */
export type MeteredVerdict =
  /** The newest request resolved a claude.ai organisation. */
  | { readonly kind: "plan"; readonly newestIso: string }
  /** The newest request resolved none: this session is spending a metered organisation now. */
  | {
      readonly kind: "metered-now";
      readonly dollars: number;
      readonly requests: number;
      readonly firstIso: string;
      readonly lastIso: string;
    }
  /** Metered requests were made, but a newer one resolved a plan again. Named, never refused. */
  | {
      readonly kind: "metered-earlier";
      readonly dollars: number;
      readonly requests: number;
      readonly firstIso: string;
      readonly lastIso: string;
      readonly newestIso: string;
    }
  /** Not one request was found for these prompts — undescribed, never read as a plan. */
  | { readonly kind: "no-telemetry" };

/**
 * Whether `a` is newer than `b`, a metered event winning a tie so a same-instant pair never reads as a plan.
 *
 * @param a the candidate
 * @param b the incumbent
 * @returns true when `a` should replace `b` as the newest
 */
function newerThan({ a, b }: { a: ApiRequestSpend; b: ApiRequestSpend }): boolean {
  const aMs = Date.parse(a.tsIso);
  const bMs = Date.parse(b.tsIso);
  if (aMs !== bMs) {
    return aMs > bMs;
  }
  return a.metered && !b.metered;
}

/**
 * Judge one session's API requests.
 *
 * @param events every projected request under the session's recent prompts, in any order
 * @returns whether the session is on a plan, metered now, metered earlier, or undescribed
 */
export function judgeMeteredSpend({ events }: { events: readonly ApiRequestSpend[] }): MeteredVerdict {
  const newest = newestApiRequestSpend({ events });
  if (newest === undefined) {
    return { kind: "no-telemetry" };
  }
  const metered = events.filter((event) => event.metered);
  if (metered.length === 0) {
    return { kind: "plan", newestIso: newest.tsIso };
  }
  const instants = metered.map((event) => event.tsIso).toSorted((a, b) => Date.parse(a) - Date.parse(b));
  const span = {
    dollars: metered.reduce((sum, event) => sum + event.costUsd, 0),
    firstIso: instants[0]!,
    lastIso: instants[instants.length - 1]!,
    requests: metered.length,
  };
  if (newest.metered) {
    return { kind: "metered-now", ...span };
  }
  return { kind: "metered-earlier", ...span, newestIso: newest.tsIso };
}

/**
 * The Datadog query for any request from these devices that named an organisation — the baseline an absence is read
 * against.
 *
 * An id that is not a device hash is dropped rather than escaped, as {@link promptScopedQuery} drops a prompt id.
 * With none left the query is unscoped: a redacted or older event carries no `user.id`, and every Claude Code request
 * the account exports is this owner's own.
 *
 * @param deviceIds the `user.id` values the session's own requests carried
 * @returns the query
 */
export function identityBaselineQuery({ deviceIds }: { deviceIds: readonly string[] }): string {
  const usable = [...new Set(deviceIds.filter((id) => DEVICE_ID_SHAPE.test(id)))];
  const identified = `${API_REQUEST_QUERY} @organization.id:*`;
  if (usable.length === 0) {
    return identified;
  }
  return `${identified} @user.id:(${usable.join(" OR ")})`;
}

/**
 * When a session's CURRENT run of requests without an organisation began: its earliest unidentified request at or after
 * its newest identified one. Not its first metered request ever — an older metered spell would reach back past a
 * restart and let identified requests from before it stand as the baseline.
 *
 * @param events one session's projected requests, in any order
 * @returns the run's first instant, or undefined when its newest request named an organisation
 */
export function absenceSinceIso({ events }: { events: readonly ApiRequestSpend[] }): string | undefined {
  const identifiedMs = events.filter((event) => !event.metered).map((event) => Date.parse(event.tsIso));
  const floorMs = Math.max(-Infinity, ...identifiedMs);
  const run = events
    .filter((event) => event.metered && Date.parse(event.tsIso) >= floorMs)
    .map((event) => event.tsIso)
    .toSorted((a, b) => Date.parse(a) - Date.parse(b));
  return run[0];
}

/**
 * Whether a read already holds the baseline: a request naming an organisation at or after `sinceIso`.
 *
 * Every spend in one chair read came from the pinned workspace's own prompts, so from this device.
 *
 * @param spends every request the read projected, any session's
 * @param sinceIso where the session's current run without an organisation began, from {@link absenceSinceIso}
 * @returns true when an identified request is as new as the absence or newer
 */
export function baselineInRead({
  spends,
  sinceIso,
}: {
  spends: readonly ApiRequestSpend[];
  sinceIso: string;
}): boolean {
  const sinceMs = Date.parse(sinceIso);
  return spends.some((spend) => !spend.metered && Date.parse(spend.tsIso) >= sinceMs);
}

/** What was found about the device's identified requests since a session's absence began. */
export type IdentityBaseline =
  /** An identified request from this device at or after the absence — the absence is the session's own. */
  | { readonly kind: "established" }
  /** None: the whole device names no organisation, so the absence tells a Console credential from a plan by nothing. */
  | { readonly kind: "absent" }
  /** The baseline could not be read. */
  | { readonly kind: "unread"; readonly why: string };

/** A session's verdict once its absence has been read against the baseline. */
export type BaselinedVerdict = MeteredVerdict | { readonly kind: "unmeasured"; readonly why: string };

/** Why a device-wide absence is not a metered reading, printed on the session's UNMEASURED line. */
const DEVICE_WIDE_ABSENCE =
  "no request from this device has named an organisation since this session's first request without one — Claude " +
  "Code stamps it from ~/.claude.json's shared oauthAccount, which a default-store `claude auth logout` removes, so " +
  "its absence cannot tell a Console credential from a plan seat; `slopweaver claude seat` judges the boot credential";

/**
 * Read a session's metered verdict against the device baseline. Only `metered-now` refuses, so only it is touched.
 *
 * @param verdict the session's verdict from {@link judgeMeteredSpend}
 * @param baseline what the device's identified requests since the absence showed; ignored for any other verdict
 * @returns the verdict unchanged, or unmeasured with why when the absence could not be told from a plan seat's
 */
export function applyIdentityBaseline({
  verdict,
  baseline,
}: {
  verdict: MeteredVerdict;
  baseline: IdentityBaseline;
}): BaselinedVerdict {
  if (verdict.kind !== "metered-now" || baseline.kind === "established") {
    return verdict;
  }
  if (baseline.kind === "absent") {
    return { kind: "unmeasured", why: DEVICE_WIDE_ABSENCE };
  }
  return {
    kind: "unmeasured",
    why: `its requests name no organisation and the device baseline could not be read (${baseline.why})`,
  };
}

/**
 * Dollars as the refusal prints them.
 *
 * @param dollars a sum of `cost_usd`
 * @returns the amount to the cent, with its sign
 */
export function renderDollars({ dollars }: { dollars: number }): string {
  return `$${dollars.toFixed(2)}`;
}
