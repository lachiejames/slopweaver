/**
 * The pure half of a bounded, no-store live read of JumpCloud Directory Insights AUTHENTICATION events.
 *
 * ## Why this exists at all, and why it stores nothing
 *
 * `plan.ts` declares the whole `events` family SHAPE-INDEXED and never stored: the owner's ruling
 * bans persisting an event a row at a time, and the property that ruling asks for — every persistent
 * derivative byte-identical across two histories differing in ids, timestamps, values, ordering and
 * multiplicity — is not achievable from observed records. That ban is on STORING. It is not a ban on
 * LOOKING, and the difference is the whole of this module: nothing on this path reaches a store, a
 * generation, a manifest or a journal. A caller gets a fold on stdout and the process exits.
 *
 * Without it the bot cannot answer a dormant-account question for JumpCloud: it can read Google and
 * Cloudflare but not JumpCloud, because no verb in this repository could reach a last-authentication instant: `systemusers` carries no
 * `lastLogin` field, `sync` drops the shape-indexed families from its walk, and `atlas jumpcloud read
 * --kind events` refuses on an evidence boundary that was never measured. Finding row
 * `jumpcloud-last-auth-unreachable-by-any-verb`.
 *
 * ## One service per request, which is the provider's rule and not a choice
 *
 * MEASURED against an account. Sending the five auth services as one list answers
 * HTTP 400 and names its own whole vocabulary back:
 *
 * > `Validation Error: unknown service [directory ldap radius sso systems]. Must specify a single valid
 * > service from the known services: radius,ldap,systems,mdm,aigw,generic_di,directory,password_manager,
 * > password_vault,object_storage,notifications,sso,all,saas_app_management,reports,asset_management,
 * > workflows,ai_admin,software,alert,access_management,genai`
 *
 * So a window is walked once PER SERVICE and the folds are merged. `all` would have been one request, and
 * it is deliberately not used: it pulls `mdm_command_result` and `apple_ddm_status_receive` — every row of
 * a one-day probe's full page was device telemetry — so the auth events a dormancy read wants would sit
 * behind an unbounded quantity of traffic that is not about a person at all.
 *
 * ## The service set and the event-type allowlist are NAMED, never a pattern
 *
 * A caller chooses the WINDOW. A caller does not choose what counts as an authentication: a read that
 * quietly omitted SSO could not be produced by passing a flag. Both lists are measured, and an event type
 * this file does not name is DROPPED AND REPORTED ({@link AuthEventFold.unrecognisedEventTypes}) rather
 * than matched by a pattern over its name — the same discipline `requestContracts.ts` keeps for an
 * operation, and for the same reason: a vocabulary the provider grows should be a line in the output
 * instead of a silent narrowing of the answer.
 *
 * ## DESC, first-wins, and why a truncated walk is still correct
 *
 * The walk asks for `sort: "DESC"` and the fold keeps the FIRST instant it sees per identity. So a walk
 * that stops early — a page cap, a transport failure, a provider limit — still reports the true last
 * authentication for every identity it reached, and the only thing a truncation costs is identities it
 * never saw. An ASC walk folding last-wins has the opposite property: every row is provisional until the
 * final page lands, and a truncated one is silently wrong. {@link AuthEventFold.oldestEventIso} is what
 * makes the residue checkable — a caller reading "no authentication in the window" for somebody may only
 * conclude it back to that instant.
 */
import { parseIsoMs } from "../../lib/date.js";
import { err, ok, type Result } from "../../lib/result.js";

import { type JumpcloudReadError, JumpcloudReadErrors } from "./errors.js";

/**
 * The registry row this read calls. Named once, because it is the only surface this module ever reaches.
 */
export const JUMPCLOUD_AUTH_EVENTS_SURFACE = "insights-directory-insights-events-post";

/**
 * The Directory Insights services asked, one request each, written out rather than passed in.
 *
 * `directory` is a person signing in to JumpCloud itself, `systems` is a device login, `sso` is an
 * application assertion, `radius` is a network authentication and `ldap` is a bind. Every one of them is
 * somebody proving who they are, which is what a dormancy question asks about.
 *
 * The services this list does NOT name are not an oversight. MEASURED over a one-week window: `mdm`
 * answered a full page of `mdm_command_result` and `apple_ddm_status_receive`, which happen whether or not
 * a person is present, so counting one as a sign of life would report an idle account as active. A service
 * a tenancy does not use answers `X-Result-Count: 0` over the window, and every listed service is asked
 * anyway, because a measured zero on an unused service is a fact worth being able to state.
 */
export const JUMPCLOUD_AUTH_SERVICES: readonly string[] = ["directory", "ldap", "radius", "sso", "systems"];

/**
 * The event types that ARE an authentication, measured one at a time.
 *
 * MEASURED over a one-week window, one full page per service: `directory` carries
 * `user_login_attempt` and `admin_login_attempt` among other types that are provisioning and membership
 * changes; `systems` carries `login_attempt`; `sso` carries `sso_auth` on every row read.
 * Reproduce with `slopweaver atlas jumpcloud auth-events --since <iso> --max-pages 1` and read the
 * "event types read and not counted" line, which is where every other type an account emits appears.
 *
 * Note that `systems` spells its login `login_attempt` while `directory` spells the same idea
 * `user_login_attempt`. That is the exact reason this is a measured list rather than a suffix match: a
 * rule written against either spelling would have silently dropped the other service's whole traffic.
 */
export const JUMPCLOUD_AUTH_EVENT_TYPES: readonly string[] = [
  "admin_login_attempt",
  "login_attempt",
  "sso_auth",
  "user_login_attempt",
];

/** How many events one page asks for. */
export const JUMPCLOUD_AUTH_EVENTS_PAGE_LIMIT = 1000;

/** One authentication, projected down to the fields a dormancy read uses. Nothing else is kept. */
export interface AuthEvent {
  /** The event's own instant, as the provider wrote it. */
  readonly timestampIso: string;
  /**
   * The identity this fold is keyed by: the actor's email, lowercased, when the event carried one.
   *
   * Email is the key rather than the username because the username is not stable ACROSS services — the
   * same person is `firstlast` on a `systems` login and `first.last` on a `directory` one (measured) — and because email is what every other signal in a dormancy join is keyed by.
   */
  readonly email: string | null;
  /** The JumpCloud username, whichever of the three places this event type carries it. */
  readonly username: string | null;
  readonly eventType: string;
  readonly service: string;
  /**
   * Whether the attempt is known to have FAILED.
   *
   * Measured as `success !== false`, which is not the same as `success === true`: `sso_auth` carries
   * `success: null` on every row of a one-week probe, so requiring `true` would have discarded the
   * entire SSO service — the one signal that covers people who never touch a managed device.
   */
  readonly success: boolean;
  /**
   * The same instant as epoch milliseconds, resolved once at projection.
   *
   * Every comparison in the fold is on THIS rather than on the ISO string. Lexical order over ISO text is
   * only the same as time order when every string shares one precision, and this endpoint's do not:
   * measured on one page, a bare-second stamp, a millisecond stamp and
   * a nanosecond stamp all came back together — seconds, milliseconds and NANOseconds. As
   * text the bare-second stamp sorts after the fractional one while being the earlier instant, so a fold
   * comparing strings would report the wrong last authentication, which is the class of quiet wrongness
   * this whole read exists to remove.
   */
  readonly atMs: number;
}

/**
 * The last successful authentication one identity made inside the window.
 * @internal
 */
export interface LastAuth {
  /** The email, or the username when this identity never produced an event carrying an email. */
  readonly identity: string;
  /** Which of the two {@link LastAuth.identity} is, so a caller joining on email knows what it has. */
  readonly identityKind: "email" | "username";
  readonly username: string | null;
  readonly lastAuthIso: string;
  readonly eventType: string;
  readonly service: string;
}

/** What a whole walk folded to, and every bound a reader needs to know what a silence means. */
export interface AuthEventFold {
  /** One row per identity that authenticated, newest first. */
  readonly lastAuth: readonly LastAuth[];
  /** How many events were projected, successful or not. */
  readonly eventsRead: number;
  /** How many were dropped because their type is not an authentication. */
  readonly droppedNotAuth: number;
  /** Every event type seen that {@link JUMPCLOUD_AUTH_EVENT_TYPES} does not name, sorted. */
  readonly unrecognisedEventTypes: readonly string[];
  /**
   * The oldest instant this walk actually reached, or `null` when it read nothing.
   *
   * The bound on every negative claim the fold supports: an identity absent from `lastAuth` is silent back
   * to HERE, not back to the window's start, unless every service's walk ran to completion.
   */
  readonly oldestEventIso: string | null;
}

/**
 * The POST body for one page of one service's read.
 *
 * `search_after` is the provider's own cursor and is sent as the ARRAY it is. MEASURED: the
 * `X-Search_after` header carries that array as JSON TEXT, and sending the text back verbatim answers
 * `unable to parse JSON request body: invalid search_after: "[1789427630640, \"6aa87f…\"]"` — so the
 * header is parsed before it is sent. The first page omits the field entirely rather than sending an empty
 * one, because an empty cursor is a value the provider would have to interpret.
 *
 * @param service the one service this request asks for — the provider refuses a list
 * @param startIso the inclusive start of the window
 * @param endIso the exclusive end
 * @param searchAfter the cursor a previous page carried, already parsed, `null` on the first page
 * @returns the request body, ready for the closed client
 */
export function authEventsPageBody({
  service,
  startIso,
  endIso,
  searchAfter,
}: {
  service: string;
  startIso: string;
  endIso: string;
  searchAfter: readonly unknown[] | null;
}): Readonly<Record<string, unknown>> {
  const base = {
    end_time: endIso,
    limit: JUMPCLOUD_AUTH_EVENTS_PAGE_LIMIT,
    service: [service],
    // Newest first, so the fold's first-wins rule makes a truncated walk correct rather than provisional.
    sort: "DESC",
    start_time: startIso,
  };
  if (searchAfter === null) {
    return base;
  }
  return { ...base, search_after: [...searchAfter] };
}

/**
 * Parse the `X-Search_after` header into the array the request body wants.
 *
 * @param raw the header value, absent when the provider offered no cursor
 * @returns the parsed cursor, or `null` when there is none to send or it is not an array
 */
export function parseSearchAfter({ raw }: { raw: string | null }): readonly unknown[] | null {
  if (raw === null || raw.trim() === "") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    // A cursor that is not the JSON array this endpoint documents is a cursor no request can carry. The
    // walk ends on `no-cursor` and says so, rather than sending a value the provider would refuse.
    return null;
  }
}

/** Whether this value is a JSON object rather than an array, a primitive or `null`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One non-empty string field of an event, or `null` when the provider sent something that is not one. */
function stringField({ row, key }: { row: Record<string, unknown>; key: string }): string | null {
  const value = row[key];
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  return value;
}

/**
 * The username an event carries, which is in a different place on each service.
 *
 * MEASURED: a `systems` login carries a flat `username` and a null `jc_initiated_by_username`;
 * a `directory` login carries `jc_initiated_by_username`; both carry `initiated_by.username`, and an `mdm`
 * row carries a null `initiated_by` entirely. All three are read, in that order.
 *
 * @param row one raw event
 * @returns the username, or `null` when the event names no actor at all
 */
function eventUsername({ row }: { row: Record<string, unknown> }): string | null {
  const flat = stringField({ key: "username", row });
  if (flat !== null) {
    return flat;
  }
  const initiatedBy = stringField({ key: "jc_initiated_by_username", row });
  if (initiatedBy !== null) {
    return initiatedBy;
  }
  const initiator = row["initiated_by"];
  if (!isRecord(initiator)) {
    return null;
  }
  return stringField({ key: "username", row: initiator });
}

/**
 * Project one page of raw Directory Insights events down to the fields this read keeps.
 *
 * An event with no instant, or with neither an email nor a username, is skipped rather than defaulted: a
 * dormancy read whose instants or actors are invented is worse than one that is short by a row.
 *
 * @param body the parsed response body — Directory Insights answers a bare array
 * @param service the service this page was asked of, used when a row states none of its own
 * @returns the projected events, or why the page could not be read at all
 */
export function projectAuthEvents({
  body,
  service,
}: {
  body: unknown;
  service: string;
}): Result<readonly AuthEvent[], JumpcloudReadError> {
  if (!Array.isArray(body)) {
    return err(
      JumpcloudReadErrors.unexpectedShape({
        detail: `Directory Insights answers a JSON array of events; this page was ${typeof body}`,
        surface: JUMPCLOUD_AUTH_EVENTS_SURFACE,
      }),
    );
  }
  return ok(
    body.flatMap((raw) => {
      const projected = projectOneEvent({ raw, service });
      return projected === null ? [] : [projected];
    }),
  );
}

/**
 * Project ONE raw event, or skip it.
 *
 * Split from {@link projectAuthEvents} to keep each side inside the branch-and-nesting ceiling, and the
 * seam is real: this decides what ONE row is, and the caller decides what a PAGE is.
 *
 * @param raw one element of the provider's array, of unknown shape
 * @param service the service this page was asked of
 * @returns the projected event, or `null` when the row carries too little to be one
 */
function projectOneEvent({ raw, service }: { raw: unknown; service: string }): AuthEvent | null {
  if (!isRecord(raw)) {
    return null;
  }
  const timestampIso = stringField({ key: "timestamp", row: raw });
  const eventType = stringField({ key: "event_type", row: raw });
  if (timestampIso === null || eventType === null) {
    return null;
  }
  const atMs = parseIsoMs({ tsIso: timestampIso });
  if (atMs === undefined) {
    return null;
  }
  const email = stringField({ key: "jc_initiated_by_email", row: raw });
  const username = eventUsername({ row: raw });
  if (email === null && username === null) {
    return null;
  }
  return {
    atMs,
    email: lowercased({ email }),
    eventType,
    service: statedService({ asked: service, row: raw }),
    success: raw["success"] !== false,
    timestampIso,
    username,
  };
}

/**
 * The email, lowercased, or the absence.
 *
 * A named function rather than a conditional expression: the lint bar prefers `??` over a ternary and
 * `no-silent-fallback` forbids `??`, so the shape both rules accept is an `if` with the absent case named.
 *
 * @param email the email the event carried, or `null`
 * @returns the lowercased email, or `null`
 */
function lowercased({ email }: { email: string | null }): string | null {
  if (email === null) {
    return null;
  }
  return email.toLowerCase();
}

/**
 * The service a row states, or the one it was ASKED of.
 *
 * Attributing a row that names no service of its own to the service that was requested is a fact rather
 * than a guess: the provider only serves one service per request, so that IS which service answered.
 *
 * @param row one raw event
 * @param asked the service this page was asked of
 * @returns the service to record
 */
function statedService({ row, asked }: { row: Record<string, unknown>; asked: string }): string {
  const stated = stringField({ key: "service", row });
  if (stated === null) {
    return asked;
  }
  return stated;
}

/** One identity's best instant so far, kept with its own epoch so a comparison never re-parses. */
interface HeldAuth {
  readonly row: LastAuth;
  readonly atMs: number;
}

/** The running state a fold carries between pages and across services. */
export interface AuthFoldState {
  readonly byIdentity: Map<string, HeldAuth>;
  eventsRead: number;
  droppedNotAuth: number;
  readonly unrecognised: Set<string>;
  oldestEventIso: string | null;
  oldestEventMs: number | null;
}

/**
 * A fold with nothing in it.
 *
 * @returns the empty state a walk starts from
 */
export function emptyAuthFold(): AuthFoldState {
  return {
    byIdentity: new Map<string, HeldAuth>(),
    droppedNotAuth: 0,
    eventsRead: 0,
    oldestEventIso: null,
    oldestEventMs: null,
    unrecognised: new Set<string>(),
  };
}

/**
 * Fold one page of projected events into a running state, newest-first and first-wins.
 *
 * A FAILED attempt is counted as read and is never recorded as a last authentication: somebody typing a
 * wrong password proves a person was there, but the question this read answers is when an identity last
 * successfully proved who it was, and a dormancy list counting failures would report a locked-out account
 * as healthy.
 *
 * @param state the running fold, mutated in place
 * @param events one page, already projected
 * @returns nothing; the state carries the result
 */
export function foldAuthPage({ state, events }: { state: AuthFoldState; events: readonly AuthEvent[] }): void {
  for (const event of events) {
    state.eventsRead += 1;
    if (state.oldestEventMs === null || event.atMs < state.oldestEventMs) {
      state.oldestEventMs = event.atMs;
      state.oldestEventIso = event.timestampIso;
    }
    if (!JUMPCLOUD_AUTH_EVENT_TYPES.includes(event.eventType)) {
      state.droppedNotAuth += 1;
      state.unrecognised.add(event.eventType);
      continue;
    }
    if (!event.success) {
      continue;
    }
    const row = lastAuthRow({ event });
    const held = state.byIdentity.get(row.identity);
    if (held !== undefined && held.atMs >= event.atMs) {
      continue;
    }
    state.byIdentity.set(row.identity, { atMs: event.atMs, row });
  }
}

/**
 * The fold row one event becomes, keyed by email where the event carried one.
 *
 * @param event one projected authentication, already known to carry an email or a username
 * @returns the row, and which of the two its key is
 */
function lastAuthRow({ event }: { event: AuthEvent }): LastAuth {
  if (event.email !== null) {
    return {
      eventType: event.eventType,
      identity: event.email,
      identityKind: "email",
      lastAuthIso: event.timestampIso,
      service: event.service,
      username: event.username,
    };
  }
  // `projectAuthEvents` skips an event carrying neither, so a null email proves a username is present.
  return {
    eventType: event.eventType,
    identity: event.username!,
    identityKind: "username",
    lastAuthIso: event.timestampIso,
    service: event.service,
    username: event.username,
  };
}

/**
 * Close a running fold into the report a caller reads.
 *
 * @param state the fold every page of every service was accumulated into
 * @returns one row per identity, newest authentication first, with every bound the rows rest on
 */
export function closeAuthFold({ state }: { state: AuthFoldState }): AuthEventFold {
  return {
    droppedNotAuth: state.droppedNotAuth,
    eventsRead: state.eventsRead,
    lastAuth: [...state.byIdentity.values()].toSorted((left, right) => right.atMs - left.atMs).map((held) => held.row),
    oldestEventIso: state.oldestEventIso,
    unrecognisedEventTypes: [...state.unrecognised].toSorted(),
  };
}
