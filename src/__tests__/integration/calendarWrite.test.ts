/**
 * INTEGRATION test: the Calendar door's WRITE half against the REAL Calendar API, recorded + replayed via a
 * Polly cassette. One `describe`, one `it` holding the whole INWARD cycle — `insert` → `get` → `get` →
 * `patch` → `get` → `get` → `delete` — each mutation reaching the real `@googleapis/calendar` seam through
 * `prepareCalendarWrite` / `applyCalendarWrite`, so what is proven is the shipped path rather than a
 * restatement of it.
 *
 * ## INWARD only, and that is the whole point
 *
 * Every write here names NO attendee, so `classifyOutward` returns `outward: false`, `sendUpdates` is
 * `none`, and nothing Google does on the back of this recording reaches another person. An OUTWARD write is
 * deliberately absent: it HOLDS for the owner's own `--approve <digest>`, and a fleet session may never
 * approve a digest it printed itself — so there is nothing for a cassette to record on that leg. The hold
 * itself is proven by `unit/cli/commands/calendar/writeRun.test.ts`, over fakes, where it belongs.
 *
 * ## The scope the recording was made under
 *
 * `calendar.events.owned` and no wider calendar WRITE scope — not `calendar.events`, not `calendar`, not
 * `calendar.app.created`. That is the owner's ruling and it is asserted below rather than
 * described, in BOTH lanes: the record lane reads the real stored grant, the replay lane declares the same
 * narrow set, and a grant carrying a wider write scope fails the suite before a single call is made.
 *
 * ## Recording
 *
 *   slopweaver calendar connect --grant meetings     # consent to the write scope, once
 *   POLLY_MODE=record yarn test:integration
 *
 * The recording CREATES and then DELETES one real event on the owner's own primary calendar, far enough in
 * the future that it collides with nothing. `afterAll` sweeps it in the record lane if the cycle failed
 * before its own delete, so a red record run cannot strand an event on the owner's diary.
 *
 * ## A missing cassette FAILS this suite
 *
 * Exactly `calendar.test.ts`'s reason: a write half that is "proven by cassette" must not be provable by
 * the cassette's absence.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { calendar } from "@googleapis/calendar";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { unwrap } from "../../lib/result.js";
import { makeCalendarApi } from "../../live/calendar/api.js";
import { CALENDAR_SCOPES } from "../../live/calendar/scopes.js";
import { applyCalendarWrite, prepareCalendarWrite } from "../../live/calendar/write.js";
import { makeCalendarWriteApi } from "../../live/calendar/writeApi.js";
import { makeGoogleAuthClient } from "../../live/google/authClient.js";
import type { CalendarBookForm, CalendarRescheduleForm } from "../../outbound/calendar/form.js";
import { type CalendarGrant, calendarGrantStore } from "../../secrets/calendarGrant.js";
import { googleClientId, googleClientSecret } from "../../secrets/googleClients.js";
import { NO_TERMS_CALENDAR_PRIVACY } from "../calendarWritePrivacyFixture.js";
import { realAmbientHome } from "../realAmbientHome.js";
import { activePolly } from "../setup-polly.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/** Where `setup-polly.ts` persists this file's recordings. */
const RECORDINGS_DIR = join(dirname(new URL(import.meta.url).pathname), "__recordings__");

/** Matched by PREFIX: Polly appends a hash of the suite title to the directory it persists under. */
const RECORDING_PREFIX = "calendar-writes-integration";
const RECORDED = existsSync(RECORDINGS_DIR)
  ? readdirSync(RECORDINGS_DIR).some((entry) => entry.startsWith(RECORDING_PREFIX))
  : false;

if (!(RECORD || RECORDED)) {
  process.stdout.write(
    "calendar write integration: UNRECORDED — no cassette under " +
      RECORDING_PREFIX +
      ", so this suite FAILS rather than skips; see this file's header for the recording commands.\n",
  );
}

/**
 * Every Google calendar scope that admits a WRITE wider than `calendar.events.owned`. None of these may be
 * on the grant this suite runs under — the narrow scope is the feature, so the recording proves it was the
 * only one in play rather than merely the one that was asked for.
 */
const WIDER_CALENDAR_WRITE_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.calendars",
  "https://www.googleapis.com/auth/calendar.calendarlist",
  "https://www.googleapis.com/auth/calendar.acls",
];

/** A placeholder grant for the replay lane, declaring exactly the scopes the recording was made under. */
const REPLAY_GRANT: CalendarGrant = {
  account: "replay@example.invalid",
  accessToken: "dummy-replay-value-not-real",
  expiryMs: 4_102_444_800_000,
  grantedAtIso: "2026-09-13T00:00:00.000Z",
  refreshToken: "dummy-replay-value-not-real",
  scopes: [CALENDAR_SCOPES.events, CALENDAR_SCOPES.ownedEvents],
};

/** The state home the record lane reads the real grant out of — captured before the sandbox exists. */
function recordHome(): string {
  return realAmbientHome();
}

/** The real grant, read from disk. Only ever called on the record path. */
function storedGrant(): CalendarGrant {
  const stored = calendarGrantStore.read({ home: recordHome() });
  if (stored.isErr()) {
    throw new Error(`could not read the stored Calendar grant: ${stored.error.join("; ")}`);
  }
  if (stored.value === undefined) {
    throw new Error("no Calendar grant stored — run `slopweaver calendar connect --grant meetings` first");
  }
  return stored.value;
}

/** The OAuth client credentials, read from the same home. Only ever called on the record path. */
function clientCredentials(): { clientId: string; clientSecret: string } {
  const home = recordHome();
  const clientId = googleClientId({ home });
  const clientSecret = googleClientSecret({ home });
  if (clientId === undefined || clientSecret === undefined) {
    throw new Error("set google-client-id and google-client-secret in this home before recording this cassette");
  }
  return { clientId, clientSecret };
}

/** Where a mid-recording token refresh is allowed to land: outside the repo, and thrown away. */
const TOKEN_SINK = mkdtempSync(join(tmpdir(), "slopweaver-calendar-write-cassette-"));

/** The home the intents this suite prepares are persisted under. Thrown away with the token sink. */
const INTENT_HOME = mkdtempSync(join(tmpdir(), "slopweaver-calendar-write-intents-"));

const REFRESHED_TOKEN_EXPIRY_MS = Date.now() + 30 * 60 * 1000;

/** The grant the record lane uses, refreshed BEFORE Polly exists so no token exchange is recorded. */
const RECORD_GRANT: CalendarGrant = RECORD ? await refreshedGrant() : REPLAY_GRANT;

/** Force a token refresh outside the recorded window, and return a grant carrying the fresh token. */
async function refreshedGrant(): Promise<CalendarGrant> {
  const grant = storedGrant();
  const auth = makeGoogleAuthClient({
    ...clientCredentials(),
    grant: { ...grant, expiryMs: 1 },
    persist: ({ grant: refreshed }) => calendarGrantStore.write({ grant: refreshed, home: TOKEN_SINK }),
  });
  const token = await auth.getAccessToken();
  if (typeof token.token !== "string") {
    throw new Error("could not refresh the stored Calendar grant before recording");
  }
  return { ...grant, accessToken: token.token, expiryMs: REFRESHED_TOKEN_EXPIRY_MS };
}

/** The bound client both lanes use: the refreshed stored grant when recording, a placeholder when replaying. */
function boundClient(): { client: ReturnType<typeof calendar>; account: string } {
  const grant = RECORD_GRANT;
  const credentials = RECORD ? clientCredentials() : { clientId: "replay", clientSecret: "replay" };
  const auth = makeGoogleAuthClient({
    ...credentials,
    grant,
    persist: ({ grant: refreshed }) => calendarGrantStore.write({ grant: refreshed, home: TOKEN_SINK }),
  });
  return { account: grant.account, client: calendar({ auth, version: "v3" }) };
}

/**
 * Force ORDERED matching for this file.
 *
 * The event id is 32 hex characters, so `redactRequestPath` collapses every addressed call — the two
 * snapshot reads, the two read-backs, the patch and the delete — onto the single path `/[REDACTED]`. Under
 * the shared lenient config all FOUR `GET`s would then share one recorded entry, and "the reschedule
 * changed the start" would replay the booking's own read-back and pass while proving nothing.
 */
function requireOrderedMatching(): void {
  const polly = activePolly();
  if (polly === undefined) {
    return;
  }
  polly.server.any().on("request", (req) => {
    req.configure({ matchRequestsBy: { order: true } });
  });
}

const NOW = "2026-09-13T02:10:00.000Z";
const ZONE = "Australia/Melbourne";

/** Far enough out to collide with nothing real, and a fixed January date so the offset is AEDT either lane. */
const BOOKED: CalendarBookForm = {
  attendees: [],
  description: undefined,
  kind: "book",
  location: undefined,
  meet: false,
  span: { allDay: false, end: "2027-01-05T09:30", start: "2027-01-05T09:00", zone: ZONE },
  title: "slopweaver calendar write cassette",
};

const MOVED: CalendarRescheduleForm = {
  kind: "reschedule",
  span: { allDay: false, end: "2027-01-05T14:45", start: "2027-01-05T14:00", zone: ZONE },
};

/** The event the cycle created, so a failed RECORD run can be swept rather than stranded on the owner's diary. */
let strandedEventId: string | undefined;

/**
 * Sweep an event a failed RECORD run left behind — THROUGH the door's own planner, never around it.
 *
 * The obvious cleanup is one `client.events.delete`, and it is wrong: between this suite's booking and its
 * own failure somebody can have added a guest to that event, and cancelling an attended event tells every
 * one of them the meeting is off. That is an OUTWARD write by the planner's own classification, and no test
 * helper may make one. So the sweep rebuilds the cancel plan and refuses on any outward verdict, printing a
 * line that names the event instead of mailing strangers — the same answer the verb would give a person.
 */
async function sweepStrandedEvent({ eventId }: { eventId: string }): Promise<void> {
  const bound = boundClient();
  const api = makeCalendarApi({ account: bound.account, client: bound.client });
  const plan = await prepareCalendarWrite({
    account: bound.account,
    api,
    calendarId: "primary",
    eventId,
    form: { kind: "cancel" },
    home: INTENT_HOME,
    intentId: randomUUID(),
    nowIso: () => new Date().toISOString(),
    zone: ZONE,
  });
  if (plan.isErr()) {
    process.stdout.write(`calendar write cassette: could not plan a sweep of ${eventId} (${plan.error.message})\n`);
    return;
  }
  if (plan.value.outward.outward) {
    process.stdout.write(
      `calendar write cassette: NOT sweeping ${eventId} — it is now outward (${plan.value.outward.reasons.join("; ")}). ` +
        "Cancel it yourself, or approve the digest the verb prints.\n",
    );
    return;
  }
  await applyCalendarWrite({
    account: bound.account,
    api,
    home: INTENT_HOME,
    plan: plan.value,
    writeApi: makeCalendarWriteApi({
      account: bound.account,
      client: bound.client,
      privacy: NO_TERMS_CALENDAR_PRIVACY,
    }),
  });
}

afterAll(async () => {
  if (RECORD && strandedEventId !== undefined) {
    await sweepStrandedEvent({ eventId: strandedEventId });
  }
  rmSync(TOKEN_SINK, { force: true, recursive: true });
  rmSync(INTENT_HOME, { force: true, recursive: true });
});

describe("calendar writes (integration — real Calendar via Polly cassette)", () => {
  beforeEach(() => {
    requireOrderedMatching();
  });

  it("books an INWARD event, reschedules it and cancels it — insert, patch and delete on the real API", async () => {
    // The narrow write scope is the feature, so it is asserted before anything is written.
    expect(RECORD_GRANT.scopes.includes(CALENDAR_SCOPES.ownedEvents)).toBe(true);
    expect(WIDER_CALENDAR_WRITE_SCOPES.filter((scope) => RECORD_GRANT.scopes.includes(scope))).toEqual([]);

    const bound = boundClient();
    const api = makeCalendarApi({ account: bound.account, client: bound.client });
    const writeApi = makeCalendarWriteApi({
      account: bound.account,
      client: bound.client,
      privacy: NO_TERMS_CALENDAR_PRIVACY,
    });
    const shared = {
      account: bound.account,
      api,
      calendarId: "primary",
      home: INTENT_HOME,
      nowIso: () => NOW,
      zone: ZONE,
    };

    // 1 — BOOK. No snapshot is read: an insert has no version to compare. POST.
    const bookIntentId = randomUUID();
    const booking = unwrap(
      await prepareCalendarWrite({ ...shared, eventId: undefined, form: BOOKED, intentId: bookIntentId }),
    );
    expect(booking.mutation.kind).toBe("insert");
    expect(booking.outward.outward).toBe(false);
    expect(booking.sendUpdates).toBe("none");
    expect(booking.attendeesAfter).toEqual([]);
    const eventId = booking.intent.eventId;
    expect(eventId).toBe(bookIntentId.replaceAll("-", ""));

    const booked = unwrap(
      await applyCalendarWrite({ account: bound.account, api, home: INTENT_HOME, plan: booking, writeApi }),
    );
    strandedEventId = eventId;
    expect(booked.status).toBe("applied");
    expect(booked.event!.status).toBe("confirmed");
    expect(booked.event!.start!.dateTime).toBe("2027-01-05T09:00:00+11:00");
    expect(booked.event!.end!.dateTime).toBe("2027-01-05T09:30:00+11:00");
    expect(booked.meetLink).toBeUndefined();

    // 2 — RESCHEDULE. A snapshot GET for the ETag, then a conditional PATCH, then the read-back GET.
    const move = unwrap(await prepareCalendarWrite({ ...shared, eventId, form: MOVED, intentId: randomUUID() }));
    expect(move.mutation.kind).toBe("patch");
    expect(move.outward.outward).toBe(false);
    expect(move.intent.before!.etag.length).toBeGreaterThan(0);

    const moved = unwrap(
      await applyCalendarWrite({ account: bound.account, api, home: INTENT_HOME, plan: move, writeApi }),
    );
    expect(moved.status).toBe("applied");
    expect(moved.event!.start!.dateTime).toBe("2027-01-05T14:00:00+11:00");
    expect(moved.event!.end!.dateTime).toBe("2027-01-05T14:45:00+11:00");

    // 3 — CANCEL. A snapshot GET for the fresh ETag, then a conditional DELETE and no read-back.
    const kill = unwrap(
      await prepareCalendarWrite({ ...shared, eventId, form: { kind: "cancel" }, intentId: randomUUID() }),
    );
    expect(kill.mutation.kind).toBe("delete");
    expect(kill.sendUpdates).toBe("none");

    const killed = unwrap(
      await applyCalendarWrite({ account: bound.account, api, home: INTENT_HOME, plan: kill, writeApi }),
    );
    strandedEventId = undefined;
    expect(killed.status).toBe("applied");
    expect(killed.event).toBeUndefined();
    expect(killed.eventId).toBe(eventId);
  });
});
