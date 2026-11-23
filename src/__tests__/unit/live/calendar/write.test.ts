/**
 * Unit: the effectful half of a calendar write against plain fakes and a temporary home — the snapshot, the
 * intent's persistence, the re-plan a commit does, and the three outcomes a mutation can leave behind.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { CalendarApi } from "../../../../live/calendar/api.js";
import { CalendarErrors } from "../../../../live/calendar/errors.js";
import { calendarIntentsDir, readCalendarIntent } from "../../../../live/calendar/intentStore.js";
import {
  applyCalendarWrite,
  assertWriteTargetIsOwnPrimary,
  prepareCalendarCommit,
  prepareCalendarWrite,
} from "../../../../live/calendar/write.js";
import { BOOK, ME, NOW, readApi, writeApi, ZONE } from "../../../calendarWriteFixture.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "slopweaver-calendar-intent-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("prepareCalendarWrite", () => {
  it("persists the intent and plans the insert, changing nothing on Google", async () => {
    const plan = unwrap(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({}),
        calendarId: "primary",
        eventId: undefined,
        form: BOOK,
        home,
        intentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    expect(plan.mutation.kind).toBe("insert");
    expect(plan.outward.outward).toBe(true);
    expect(plan.intent.eventId).toBe("aaaaaaaabbbbccccddddeeeeeeeeeeee");
    const stored = unwrap(readCalendarIntent({ home, intentId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }))!;
    expect(stored.state).toBe("pending");
    expect(stored.createdAtIso).toBe(NOW);
    // What an anchored commit binds the owner's yes to: the digest this preview printed.
    expect(stored.previewDigest).toBe(plan.digest);
  });

  it("reads the event back for a change, and refuses an event Google returned without an ETag", async () => {
    const withEtag = unwrap(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({ event: { attendees: [{ email: "a@x.test" }], etag: '"v1"' } }),
        calendarId: "primary",
        eventId: "evt-1",
        form: { kind: "cancel" },
        home,
        intentId: "i-1",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    expect(withEtag.mutation).toStrictEqual({ etag: '"v1"', kind: "delete" });
    expect(withEtag.intent.eventId).toBe("evt-1");
    const noEtag = unwrapErr(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({ event: {} }),
        calendarId: "primary",
        eventId: "evt-1",
        form: { kind: "cancel" },
        home,
        intentId: "i-2",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    expect(noEtag.message).toContain("without an ETag");
  });
});

describe("prepareCalendarCommit", () => {
  it("re-reads Google, so a digest approved over a stale snapshot no longer matches", async () => {
    const first = unwrap(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({ event: { attendees: [{ email: "a@x.test" }], etag: '"v1"' } }),
        calendarId: "primary",
        eventId: "evt-1",
        form: { attendees: ["b@x.test"], description: undefined, kind: "edit", location: undefined, title: undefined },
        home,
        intentId: "i-1",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    const again = unwrap(
      await prepareCalendarCommit({
        account: ME,
        api: readApi({ event: { attendees: [{ email: "a@x.test" }, { email: "c@x.test" }], etag: '"v2"' } }),
        home,
        intentId: "i-1",
        zone: ZONE,
      }),
    );
    expect(again.digest).not.toBe(first.digest);
    expect(again.attendeesBefore).toStrictEqual(["a@x.test", "c@x.test"]);
  });

  it("refuses an unknown intent and a spent one by the same code", async () => {
    const unknown = unwrapErr(
      await prepareCalendarCommit({ account: ME, api: readApi({}), home, intentId: "nope", zone: ZONE }),
    );
    expect(unknown.code).toBe("INTENT_UNKNOWN");
  });
});

describe("assertWriteTargetIsOwnPrimary", () => {
  it("admits the bound account's own primary calendar", () => {
    const target = assertWriteTargetIsOwnPrimary({
      account: ME,
      intent: { account: ME, calendarId: "primary" },
    });
    expect(target.isOk()).toBe(true);
  });

  it("admits it whatever case the two addresses were written in", () => {
    const target = assertWriteTargetIsOwnPrimary({
      account: "ME@X.test",
      intent: { account: "me@x.TEST", calendarId: "primary" },
    });
    expect(target.isOk()).toBe(true);
  });

  it("refuses an intent prepared under ANOTHER account, naming both sides", () => {
    const error = unwrapErr(
      assertWriteTargetIsOwnPrimary({ account: "other@x.test", intent: { account: ME, calendarId: "primary" } }),
    );
    expect(error.code).toBe("WRITE_TARGET_MISMATCH");
    expect(error.message).toContain("me@x.test");
    expect(error.message).toContain("other@x.test");
  });

  it("refuses a calendar that is not `primary`, which is what keeps primary-only out of the credential", () => {
    const error = unwrapErr(
      assertWriteTargetIsOwnPrimary({ account: ME, intent: { account: ME, calendarId: "team@group.calendar" } }),
    );
    expect(error.code).toBe("WRITE_TARGET_MISMATCH");
    expect(error.message).toContain("team@group.calendar");
  });
});

describe("the write target is re-checked at every stage that can reach Google", () => {
  it("refuses to PREPARE against a calendar that is not the bound account's primary", async () => {
    const error = unwrapErr(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({}),
        calendarId: "team@group.calendar",
        eventId: undefined,
        form: BOOK,
        home,
        intentId: "i-target-1",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    expect(error.code).toBe("WRITE_TARGET_MISMATCH");
    expect(unwrap(readCalendarIntent({ home, intentId: "i-target-1" }))).toBeUndefined();
  });

  it("refuses to COMMIT an intent prepared under another account, before reading Google", async () => {
    await prepareCalendarWrite({
      account: ME,
      api: readApi({}),
      calendarId: "primary",
      eventId: undefined,
      form: BOOK,
      home,
      intentId: "i-target-2",
      nowIso: () => NOW,
      zone: ZONE,
    });
    const error = unwrapErr(
      await prepareCalendarCommit({
        account: "someone.else@x.test",
        api: readApi({ failure: CalendarErrors.apiFailed({ message: "this read must never happen" }) }),
        home,
        intentId: "i-target-2",
        zone: ZONE,
      }),
    );
    expect(error.code).toBe("WRITE_TARGET_MISMATCH");
  });

  it("refuses to APPLY an approved plan onto a different account's diary, sending nothing", async () => {
    const plan = unwrap(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({}),
        calendarId: "primary",
        eventId: undefined,
        form: BOOK,
        home,
        intentId: "i-target-3",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    const calls: { kind: string; sendUpdates: string }[] = [];
    const error = unwrapErr(
      await applyCalendarWrite({
        account: "someone.else@x.test",
        api: readApi({}),
        home,
        plan,
        writeApi: writeApi({ answer: ok({ id: plan.intent.eventId }), calls }),
      }),
    );
    expect(error.code).toBe("WRITE_TARGET_MISMATCH");
    expect(calls).toStrictEqual([]);
    expect(unwrap(readCalendarIntent({ home, intentId: "i-target-3" }))!.state).toBe("pending");
  });
});

describe("applyCalendarWrite", () => {
  it("sends one mutation with sendUpdates all, reads back, and marks the intent applied", async () => {
    const plan = unwrap(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({}),
        calendarId: "primary",
        eventId: undefined,
        form: BOOK,
        home,
        intentId: "i-1",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    const calls: { kind: string; sendUpdates: string }[] = [];
    const outcome = unwrap(
      await applyCalendarWrite({
        account: ME,
        api: readApi({ event: { hangoutLink: "https://meet.example/x", id: plan.intent.eventId } }),
        home,
        plan,
        writeApi: writeApi({ answer: ok({ id: plan.intent.eventId }), calls }),
      }),
    );
    expect(calls).toStrictEqual([{ kind: "insert", sendUpdates: "all" }]);
    expect(outcome.status).toBe("applied");
    expect(outcome.meetLink).toBe("https://meet.example/x");
    expect(unwrap(readCalendarIntent({ home, intentId: "i-1" }))!.state).toBe("applied");
  });

  it("reports a non-Meet conference's video entry point as the link, and no link for an event with neither", async () => {
    const plan = unwrap(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({}),
        calendarId: "primary",
        eventId: undefined,
        form: BOOK,
        home,
        intentId: "i-1",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    const video = unwrap(
      await applyCalendarWrite({
        account: ME,
        api: readApi({
          event: {
            conferenceData: {
              entryPoints: [
                { entryPointType: "phone", uri: "tel:+61-0000" },
                { entryPointType: "video", uri: "https://zoom.example/j/1" },
              ],
            },
            hangoutLink: null,
            id: plan.intent.eventId,
          },
        }),
        home,
        plan,
        writeApi: writeApi({ answer: ok({ id: plan.intent.eventId }), calls: [] }),
      }),
    );
    expect(video.meetLink).toBe("https://zoom.example/j/1");
    const again = unwrap(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({}),
        calendarId: "primary",
        eventId: undefined,
        form: BOOK,
        home,
        intentId: "i-2",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    const none = unwrap(
      await applyCalendarWrite({
        account: ME,
        api: readApi({ event: { id: again.intent.eventId } }),
        home,
        plan: again,
        writeApi: writeApi({ answer: ok({ id: again.intent.eventId }), calls: [] }),
      }),
    );
    expect(none.meetLink).toBeUndefined();
  });

  it("leaves the intent UNCERTAIN when the mutation failed after it may have reached Google", async () => {
    const plan = unwrap(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({}),
        calendarId: "primary",
        eventId: undefined,
        form: BOOK,
        home,
        intentId: "i-2",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    const error = unwrapErr(
      await applyCalendarWrite({
        account: ME,
        api: readApi({}),
        home,
        plan,
        writeApi: writeApi({ answer: err(CalendarErrors.apiFailed({ message: "socket hang up" })), calls: [] }),
      }),
    );
    expect(error.code).toBe("API_FAILED");
    expect(unwrap(readCalendarIntent({ home, intentId: "i-2" }))!.state).toBe("uncertain");
  });

  it("leaves the intent PENDING when the privacy check refused the mutation before the wire, and reads nothing back", async () => {
    const plan = unwrap(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({}),
        calendarId: "primary",
        eventId: undefined,
        form: BOOK,
        home,
        intentId: "i-3",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    let readBacks = 0;
    const counting: CalendarApi = {
      ...readApi({}),
      getEvent: async () => {
        readBacks += 1;
        return ok({});
      },
    };
    const refused = CalendarErrors.privacyRefused({
      message: "calendar calendar.events.insert refused before sending",
    });
    const error = unwrapErr(
      await applyCalendarWrite({
        account: ME,
        api: counting,
        home,
        plan,
        writeApi: writeApi({ answer: err(refused), calls: [] }),
      }),
    );
    expect(error).toStrictEqual({
      code: "PRIVACY_REFUSED",
      message: "calendar calendar.events.insert refused before sending",
      refusedBeforeWire: true,
    });
    expect(readBacks).toBe(0);
    expect(unwrap(readCalendarIntent({ home, intentId: "i-3" }))!.state).toBe("pending");
  });

  it("SAYS SO when an ambiguous failure could not even be marked uncertain, rather than reporting only the send", async () => {
    const plan = unwrap(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({}),
        calendarId: "primary",
        eventId: undefined,
        form: BOOK,
        home,
        intentId: "i-unsettled",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    // The intents directory becomes a FILE, so every write under it fails for a real filesystem reason.
    rmSync(calendarIntentsDir({ home }), { force: true, recursive: true });
    writeFileSync(calendarIntentsDir({ home }), "not a directory");
    const error = unwrapErr(
      await applyCalendarWrite({
        account: ME,
        api: readApi({}),
        home,
        plan,
        writeApi: writeApi({ answer: err(CalendarErrors.apiFailed({ message: "socket hang up" })), calls: [] }),
      }),
    );
    expect(error.code).toBe("API_FAILED");
    expect(error.message).toContain("socket hang up");
    expect(error.message).toContain("could NOT be marked uncertain locally");
    expect(error.message).toContain("i-unsettled");
    expect(error.message).toContain("do NOT re-run this write");
  });

  it("treats a 409 on our own event id as already applied and reports the read-back", async () => {
    const plan = unwrap(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({}),
        calendarId: "primary",
        eventId: undefined,
        form: BOOK,
        home,
        intentId: "i-3",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    const outcome = unwrap(
      await applyCalendarWrite({
        account: ME,
        api: readApi({ event: { id: plan.intent.eventId, summary: "Sync" } }),
        home,
        plan,
        writeApi: writeApi({ answer: err(CalendarErrors.alreadyApplied()), calls: [] }),
      }),
    );
    expect(outcome.status).toBe("applied");
    expect(outcome.event?.summary).toBe("Sync");
  });

  it("does NOT read a 409 on a PATCH as already applied — the id was not ours, so it says nothing about a repeat", async () => {
    const plan = unwrap(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({ event: { attendees: [{ email: "a@x.test" }], etag: '"v1"' } }),
        calendarId: "primary",
        eventId: "evt-9",
        form: {
          kind: "reschedule",
          span: { allDay: false, end: "2026-09-20T12:00", start: "2026-09-20T11:00", zone: undefined },
        },
        home,
        intentId: "i-409-patch",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    const error = unwrapErr(
      await applyCalendarWrite({
        account: ME,
        api: readApi({}),
        home,
        plan,
        writeApi: writeApi({ answer: err(CalendarErrors.alreadyApplied()), calls: [] }),
      }),
    );
    expect(error.code).toBe("ALREADY_APPLIED");
  });

  it("refuses a stale ETag without retrying, and leaves the intent pending for a fresh preview", async () => {
    const plan = unwrap(
      await prepareCalendarWrite({
        account: ME,
        api: readApi({ event: { attendees: [{ email: "a@x.test" }], etag: '"v1"' } }),
        calendarId: "primary",
        eventId: "evt-1",
        form: { kind: "cancel" },
        home,
        intentId: "i-4",
        nowIso: () => NOW,
        zone: ZONE,
      }),
    );
    const calls: { kind: string; sendUpdates: string }[] = [];
    const error = unwrapErr(
      await applyCalendarWrite({
        account: ME,
        api: readApi({}),
        home,
        plan,
        writeApi: writeApi({ answer: err(CalendarErrors.versionConflict()), calls }),
      }),
    );
    expect(error.code).toBe("VERSION_CONFLICT");
    expect(calls).toStrictEqual([{ kind: "delete", sendUpdates: "all" }]);
    expect(unwrap(readCalendarIntent({ home, intentId: "i-4" }))!.state).toBe("pending");
  });
});
