/**
 * INTEGRATION test: the Calendar door's READ half against the REAL Calendar API, recorded + replayed via a
 * Polly cassette (see `setup-polly.ts` + `cassetteRedact.ts`). One `describe`, one `it` per door verb —
 * `calendars`, `list`, `read` and `free` — each reaching the real `@googleapis/calendar` seam.
 *
 * ## Why this replays at all
 *
 * Exactly the Gmail lane's reason (`gmail.test.ts`): `@googleapis/calendar` issues its calls through
 * `gaxios`, and `makeGoogleAuthClient` points the auth client's transport at a late-binding
 * `globalThis.fetch` so Polly sees them. If this suite ever starts reaching the network in replay, that is
 * the line in `src/live/google/authClient.ts` that regressed.
 *
 * ## Recording
 *
 * Recorded against the owner's REAL diary, so EVERY assertion here is STRUCTURAL — never
 * content, which the allowlist redactor blanks (titles, descriptions, locations and join links →
 * `[REDACTED]`; event ids, ETags and attendee addresses → `id_N`). Free/busy is asked about `primary` ONLY,
 * because a free/busy response keys its `calendars` map by calendar id — an address — and a map KEY is not
 * something the redactor rewrites; the colleague leg is proven live in the session, never committed.
 *
 *   slopweaver secrets set google-client-id           # once, in Google Cloud, then here
 *   slopweaver secrets set google-client-secret
 *   slopweaver calendar connect --grant read         # opens the consent screen; the meetings grant also works
 *   POLLY_MODE=record yarn test:integration
 *
 * The record lane reads the STORED GRANT out of the ambient home rather than taking tokens from the
 * environment — the credential is already on disk at `0600`, and nothing has to hold it.
 *
 * ## A missing cassette FAILS this suite
 *
 * Deliberately NOT the Gmail lane's conditional skip. That pattern is right for a suite whose recording
 * costs a real send; this one costs nothing but a read, and a read half that is "proven by cassette" must
 * not be provable by the cassette's absence. A replay with no recording under `RECORDING_PREFIX` fails on
 * the first call rather than skipping green.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { calendar } from "@googleapis/calendar";
import { afterAll, describe, expect, it } from "vitest";
import { unwrap } from "../../lib/result.js";
import { makeCalendarApi } from "../../live/calendar/api.js";
import { readCalendarFree } from "../../live/calendar/free.js";
import { makeCalendarFreeBusyApi } from "../../live/calendar/freeApi.js";
import { readCalendarEvent, readCalendarListing, readCalendarVocabulary } from "../../live/calendar/read.js";
import { makeGoogleAuthClient } from "../../live/google/authClient.js";
import { type CalendarGrant, calendarGrantStore } from "../../secrets/calendarGrant.js";
import { googleClientId, googleClientSecret } from "../../secrets/googleClients.js";
import { realAmbientHome } from "../realAmbientHome.js";

const RECORD = process.env["POLLY_MODE"] === "record";

/** Where `setup-polly.ts` persists this file's recordings. */
const RECORDINGS_DIR = join(dirname(new URL(import.meta.url).pathname), "__recordings__");

/** Matched by PREFIX: Polly appends a hash of the suite title to the directory it persists under. */
const RECORDING_PREFIX = "calendar-door-integration";
const RECORDED = existsSync(RECORDINGS_DIR)
  ? readdirSync(RECORDINGS_DIR).some((entry) => entry.startsWith(RECORDING_PREFIX))
  : false;

if (!(RECORD || RECORDED)) {
  process.stdout.write(
    "calendar integration: UNRECORDED — no cassette under " +
      RECORDING_PREFIX +
      ", so this suite FAILS rather than skips; see this file's header for the recording commands.\n",
  );
}

/** A placeholder grant for the replay lane, which authenticates against the cassette rather than Google. */
const REPLAY_GRANT: CalendarGrant = {
  account: "replay@example.invalid",
  accessToken: "dummy-replay-value-not-real",
  expiryMs: 4_102_444_800_000,
  grantedAtIso: "2026-09-13T00:00:00.000Z",
  refreshToken: "dummy-replay-value-not-real",
  scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
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
    throw new Error("no Calendar grant stored — run `slopweaver calendar connect` before recording this cassette");
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
const TOKEN_SINK = mkdtempSync(join(tmpdir(), "slopweaver-calendar-cassette-"));

afterAll(() => {
  rmSync(TOKEN_SINK, { force: true, recursive: true });
});

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

const NOW = "2026-09-13T01:40:00.000Z";

/**
 * A FIXED window, so replay asks for the same query string the recording holds. Chosen to hold events on
 * the day it was recorded; a re-recording on a diary with nothing in it should move it, not weaken the
 * assertions below.
 */
const WINDOW = { timeMaxIso: "2026-09-16T00:00:00.000Z", timeMinIso: "2026-09-14T00:00:00.000Z" };

describe("calendar door (integration — real Calendar via Polly cassette)", () => {
  it("lists the calendars the grant can see and the account's own zone", async () => {
    const bound = boundClient();
    const api = makeCalendarApi({ account: bound.account, client: bound.client });
    const result = unwrap(await readCalendarVocabulary({ account: bound.account, api, nowIso: () => NOW }));
    expect(result.vocabulary.calendars.length).toBeGreaterThan(0);
    expect(result.vocabulary.calendars.some((entry) => entry.primary)).toBe(true);
    expect(result.vocabulary.calendars.every((entry) => entry.id.length > 0)).toBe(true);
    // The zone survives redaction by a value-scoped keep, because an all-day date means nothing without it.
    expect(result.vocabulary.accountTimeZone).toBe("Australia/Melbourne");
    expect(result.document.source).toBe("calendar");
    expect(result.document.coverage.kind).toBe("bounded");
  });

  it("lists one window on primary, recurring events expanded, ordered by start", async () => {
    const bound = boundClient();
    const api = makeCalendarApi({ account: bound.account, client: bound.client });
    const result = unwrap(
      await readCalendarListing({
        account: bound.account,
        api,
        calendarIds: ["primary"],
        limit: 50,
        nowIso: () => NOW,
        ...WINDOW,
      }),
    );
    expect(result.listing.events.length).toBeGreaterThan(0);
    expect(result.listing.events.every((event) => event.id.length > 0)).toBe(true);
    expect(result.listing.events.every((event) => event.start !== undefined)).toBe(true);
    expect(result.document.coverage.residue.some((line) => line.includes("EXPANDED into instances"))).toBe(true);
  });

  it("reads one event in full through events.get, addressed by the id the listing returned", async () => {
    const bound = boundClient();
    const api = makeCalendarApi({ account: bound.account, client: bound.client });
    const listing = unwrap(
      await readCalendarListing({
        account: bound.account,
        api,
        calendarIds: ["primary"],
        limit: 50,
        nowIso: () => NOW,
        ...WINDOW,
      }),
    );
    const first = listing.listing.events[0]!;
    const result = unwrap(
      await readCalendarEvent({
        account: bound.account,
        api,
        calendarId: "primary",
        eventId: first.id,
        nowIso: () => NOW,
      }),
    );
    expect(result.payload.event.id).toBe(first.id);
    expect(result.payload.event.status).toBe("confirmed");
    expect(result.document.coverage.residue.some((line) => line.includes("attachments"))).toBe(true);
  });

  it("answers free/busy on the read grant, and computes open stretches from the busy blocks", async () => {
    const bound = boundClient();
    const api = makeCalendarFreeBusyApi({ account: bound.account, client: bound.client });
    const result = unwrap(
      await readCalendarFree({
        account: bound.account,
        api,
        between: { endMinute: 1020, startMinute: 540 },
        calendarIds: ["primary"],
        minutes: 30,
        nowIso: () => NOW,
        zone: "Australia/Melbourne",
        zoneEstablished: true,
        ...WINDOW,
      }),
    );
    expect(result.free.calendars.length).toBe(1);
    expect(result.free.calendars[0]!.error).toBeUndefined();
    expect(result.free.calendars[0]!.busy.length).toBeGreaterThan(0);
    // Slots exist and every one is at least the meeting length — the arithmetic ran over real busy blocks.
    expect(result.free.slots).toBeDefined();
    expect(result.free.slots!.length).toBeGreaterThan(0);
    expect(result.free.slots!.every((slot) => slot.endMs - slot.startMs >= 30 * 60_000)).toBe(true);
    expect(result.document.coverage.residue.some((line) => line.includes("not a reservation"))).toBe(true);
  });
});
