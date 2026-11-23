/**
 * `meeting-prep-due`: a page tagged to a meeting floats as a notice whose Open button is the page, in the hour before
 * it starts, and settles itself when the meeting does.
 *
 * The case this holds down: a page was cut the day before the owner's one-on-one, and the owner went in without
 * it — nothing had put it in front of them.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONSOLE_URL_ENV, consoleBaseFrom } from "../../../hand/consoleLink.js";
import { buildSettledRow } from "../../../hand/row.js";
import { recordSnooze } from "../../../hand/snoozeStore.js";
import { WHAT_CAP } from "../../../hand/step.js";
import { appendHandRow, readOpenHandSteps } from "../../../hand/store.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import { buildArrival } from "../../../monitor/card.js";
import {
  dismissedKeys,
  evaluateMeetingPrepDue,
  MEETING_PREP_DUE,
  meetingPrepKey,
  meetingPrepKeyLapsesAt,
} from "../../../monitor/meetingPrepDue.js";
import { readMeetingPrepDue } from "../../../monitor/meetingPrepDueSource.js";
import { runMonitorPass } from "../../../monitor/pass.js";
import type { MonitorReading, MonitorSubject } from "../../../monitor/types.js";
import type { MeetingTag } from "../../../pages/meetingTag.js";
import { appendMeetingTag } from "../../../pages/meetingTagStore.js";
import type { PagePublished } from "../../../pages/published.js";
import { consoleViewerUrl } from "../../../pages/url.js";
import { stateHomePaths } from "../../../stateHome.js";
import { PublishedPagesReadErrors } from "../../../store/publishedPages/readErrors.js";
import { memoryPlanHealthPorts } from "../../claudePlanProbesFixture.js";
import { memoryCodexFleetCapPort } from "../../codexFleetCapFixture.js";
import { memoryOrgHealthPort } from "../../orgHealthStoreFixture.js";
import { memoryPlanRegisterPort } from "../../planRegisterFixture.js";
import { NO_FSEVENTSD } from "../../processesFake.js";

const SLUG = "tobias-one-on-one-2-oct";
const START = "2026-10-02T05:00:00.000Z";
/** When the owner asked the voice where the page was. */
const ASKED = "2026-10-02T04:43:00.000Z";

const TAG: MeetingTag = {
  calendarId: "primary",
  eventId: "6h1s9r0k4p2m8n3q_20261002T050000Z",
  schemaVersion: 1,
  slug: SLUG,
  startIso: START,
  startWall: "15:00",
  summary: "Tobias / the owner 1:1",
  taggedIso: "2026-10-01T05:40:00.000Z",
};

/** The page's viewer address — never its `file://` one, which the posting form refuses. */
const ADDRESS = "http://localhost:3000/view?src=%2Fapi%2Fpage%2Ftobias-one-on-one-2-oct%2Findex.html&back=%2Fqueue";

/** A second meeting inside the same hour, tagged the day before. */
const LATER: MeetingTag = {
  ...TAG,
  eventId: "later_20261002T053000Z",
  slug: "later",
  startIso: "2026-10-02T05:30:00.000Z",
};

/* The reading, at one instant, over the one tag with its page published. */
function readingAt({ nowIso, unparsed = [] }: { nowIso: string; unparsed?: readonly string[] }): MonitorReading {
  return evaluateMeetingPrepDue({
    nowMs: Date.parse(nowIso),
    pageAddress: () => ADDRESS,
    dismissed: new Set(),
    tags: [TAG],
    unparsed,
  });
}

describe("meetingPrepKey", () => {
  it("carries the event's digest and its UTC start, so the start is read back off the id alone", () => {
    const key = meetingPrepKey({ tag: TAG });
    expect(key).toMatch(/^[0-9a-f]{8}-202610020500$/u);
    expect(meetingPrepKeyLapsesAt({ key })).toBe(START);
    expect(`mon-prep-${key}`.length).toBe(30);
  });

  it("is stable for one event and differs for another", () => {
    expect(meetingPrepKey({ tag: { ...TAG, taggedIso: "2026-10-02T00:00:00.000Z" } })).toBe(
      meetingPrepKey({ tag: TAG }),
    );
    expect(meetingPrepKey({ tag: { ...TAG, eventId: "other" } })).not.toBe(meetingPrepKey({ tag: TAG }));
  });

  it("reads no lapse from a key of another shape", () => {
    expect(meetingPrepKeyLapsesAt({ key: "deaths" })).toBe(undefined);
  });
});

describe("evaluateMeetingPrepDue", () => {
  it("fires over the page, addressed, at the moment the owner asked for it", () => {
    expect(readingAt({ nowIso: ASKED })).toEqual({
      blindSpot: undefined,
      monitorId: "meeting-prep-due",
      state: "firing",
      subjects: [
        {
          address: ADDRESS,
          id: SLUG,
          key: meetingPrepKey({ tag: TAG }),
          label: "Tobias / the owner 1:1 at 15:00 (2026-10-02T05:00:00.000Z)",
          meeting: { startWall: "15:00", title: "Tobias / the owner 1:1" },
        },
      ],
    });
  });

  it("is clear before the hour and from the start on", () => {
    expect(readingAt({ nowIso: "2026-10-02T03:59:59.000Z" })).toEqual({
      monitorId: "meeting-prep-due",
      state: "clear",
    });
    expect(readingAt({ nowIso: START })).toEqual({ monitorId: "meeting-prep-due", state: "clear" });
  });

  it("will not call a ledger with unreadable lines clear, and fires through them with the blind spot named", () => {
    expect(readingAt({ nowIso: "2026-10-02T03:00:00.000Z", unparsed: ["line 2: a tag line is not JSON"] })).toEqual({
      because: "the tag ledger has lines that are not tags: line 2: a tag line is not JSON",
      monitorId: "meeting-prep-due",
      state: "unmeasurable",
    });
    const firing = readingAt({ nowIso: ASKED, unparsed: ["line 2: a tag line is not JSON"] });
    expect(firing.state).toBe("firing");
    expect(firing).toMatchObject({
      blindSpot: "the tag ledger has lines that are not tags: line 2: a tag line is not JSON",
    });
  });

  it("is unmeasurable when the due meeting's page is no longer published", () => {
    expect(
      evaluateMeetingPrepDue({
        nowMs: Date.parse(ASKED),
        pageAddress: () => undefined,
        dismissed: new Set(),
        tags: [TAG],
        unparsed: [],
      }),
    ).toEqual({
      because: `${SLUG} is tagged to a meeting starting ${START}, and no page is published under it`,
      monitorId: "meeting-prep-due",
      state: "unmeasurable",
    });
  });

  it("holds a meeting the owner dismissed, and still shows a later one in the same hour", () => {
    const read = ({ tags }: { tags: readonly MeetingTag[] }) =>
      evaluateMeetingPrepDue({
        dismissed: new Set([meetingPrepKey({ tag: TAG })]),
        nowMs: Date.parse("2026-10-02T04:50:00.000Z"),
        pageAddress: () => ADDRESS,
        tags,
        unparsed: [],
      });
    expect(read({ tags: [TAG] })).toEqual({ monitorId: "meeting-prep-due", state: "clear" });
    expect(read({ tags: [TAG, LATER] })).toMatchObject({ state: "firing", subjects: [{ id: "later" }] });
  });
});

describe("dismissedKeys", () => {
  const sooner = meetingPrepKey({ tag: TAG });
  const later = meetingPrepKey({ tag: LATER });

  it("holds every key whose last settle was the owner's Done", () => {
    const settles = [
      { departed: false, key: sooner },
      { departed: false, key: later },
    ];
    expect([...dismissedKeys({ open: new Set(), settles })]).toEqual([sooner, later]);
  });

  it("does not hold a card the pass departed for a sooner meeting", () => {
    const settles = [{ departed: true, key: later }];
    expect([...dismissedKeys({ open: new Set(), settles })]).toEqual([]);
  });

  it("judges by the settle the register wrote last", () => {
    const departedThenDone = [
      { departed: true, key: later },
      { departed: false, key: later },
    ];
    expect([...dismissedKeys({ open: new Set(), settles: departedThenDone })]).toEqual([later]);
    expect([...dismissedKeys({ open: new Set(), settles: departedThenDone.toReversed() })]).toEqual([]);
  });

  it("never holds a key whose card is open", () => {
    const settles = [{ departed: false, key: later }];
    expect([...dismissedKeys({ open: new Set([later]), settles })]).toEqual([]);
  });
});

describe("the meeting-prep card", () => {
  const subject = (readingAt({ nowIso: ASKED }) as Extract<MonitorReading, { state: "firing" }>).subjects[0]!;
  const arrival = ({ over }: { over: Partial<MonitorSubject> }) =>
    unwrap(
      buildArrival({
        address: { consoleBase: "http://localhost:3000", occurrence: 1 },
        definition: MEETING_PREP_DUE,
        nowIso: ASKED,
        postedBy: "supervisor",
        subject: { ...subject, ...over },
      }),
    );

  it("is a notice whose Open button is the page itself, naming the meeting and its time", () => {
    const step = arrival({ over: {} });
    expect(step.what).toBe("Prep page for Tobias / the owner 1:1 at 15:00 — Open shows it");
    expect([step.notice, step.url, step.unaddressed, step.context]).toEqual([true, ADDRESS, undefined, undefined]);
    expect(step.id).toBe(`mon-prep-${meetingPrepKey({ tag: TAG })}`);
  });

  it("fits a long title into the sentence cap, keeping the time", () => {
    const step = arrival({ over: { meeting: { startWall: "15:00", title: "x".repeat(400) } } });
    expect(step.what.length).toBeLessThanOrEqual(WHAT_CAP);
    expect(step.what.endsWith(" at 15:00 — Open shows it")).toBe(true);
  });

  it("floats at the meeting-prep level above every other note, settles from its key and has a plain sentence to fall back on", () => {
    expect([
      MEETING_PREP_DUE.floats,
      MEETING_PREP_DUE.noteLevel,
      MEETING_PREP_DUE.perSubject,
      MEETING_PREP_DUE.plainWhat,
    ]).toEqual([true, "meeting-prep", undefined, "Prep page for a meeting starting within the hour — Open shows it"]);
  });
});

describe("meeting-prep-due through the real pass", () => {
  let home = "";
  /** The pages the fake store holds — what `page publish` would have put there in this test. */
  let publishedSlugs: string[] = [];
  /* The fake store: it serves exactly the pages this test published. */
  const storeHolding: PagePublished = async ({ slug }) => ok(publishedSlugs.includes(slug));

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "meeting-prep-"));
    publishedSlugs = [];
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /* Publish the page into the fake store and tag it, as `page publish` then `page tag` leave the home and the store. */
  function tagged({ tag = TAG }: { tag?: MeetingTag } = {}): string {
    publishedSlugs.push(tag.slug);
    unwrap(appendMeetingTag({ home, tag }));
    return consoleViewerUrl({
      consoleBase: consoleBaseFrom({ configured: process.env[CONSOLE_URL_ENV] }),
      slug: tag.slug,
    });
  }

  /* One fired pass of this monitor alone, returning each of its actions and how many notes it raised. */
  async function fired({ nowIso, openIds }: { nowIso: string; openIds: readonly string[] }): Promise<{
    actions: readonly string[];
    raised: number;
  }> {
    let raised = 0;
    const outcome = await runMonitorPass({
      consoleBase: "http://localhost:3000",
      fire: true,
      inputs: {
        claudeProjectsDir: join(home, "claude-projects"),
        fleetCapPort: memoryCodexFleetCapPort(),
        orgHealthPort: memoryOrgHealthPort(),
        pagePublished: storeHolding,
        registerPort: memoryPlanRegisterPort(),
        ...memoryPlanHealthPorts(),
        processes: NO_FSEVENTSD,
        home,
        landingPath: undefined,
        nowIso,
        nowMs: Date.parse(nowIso),
        only: "meeting-prep-due",
      },
      nowIso,
      openIds,
      openWithDecision: new Set(),
      openPage: async () => ok("not opened in this case"),
      postedBy: "supervisor",
      postedIds: unwrap(readOpenHandSteps({ home })).postedIds,
      raiseNote: () => {
        raised += 1;
        return ok("drawn");
      },
    });
    return {
      actions: outcome.actions
        .filter((action) => action.monitorId === "meeting-prep-due")
        .map((action) => `${action.kind} ${action.stepId}`),
      raised,
    };
  }

  it("fires over a page the store holds, at its viewer address, asking the store about that page alone", async () => {
    const address = tagged();
    const asked: string[] = [];
    const reading = await readMeetingPrepDue({
      home,
      nowMs: Date.parse(ASKED),
      pagePublished: async ({ home: under, slug }) => {
        asked.push(`${under}:${slug}`);
        return storeHolding({ home: under, slug });
      },
    });
    expect(reading).toMatchObject({ state: "firing", subjects: [{ address, id: SLUG }] });
    expect(asked).toEqual([`${home}:${SLUG}`]);
  });

  it("reads an empty home as clear — nothing was ever tagged", async () => {
    expect(await readMeetingPrepDue({ home, nowMs: Date.parse(ASKED), pagePublished: storeHolding })).toEqual({
      monitorId: "meeting-prep-due",
      state: "clear",
    });
  });

  it("reads a due meeting whose page the store does not hold as unmeasurable, never clear", async () => {
    unwrap(appendMeetingTag({ home, tag: TAG }));
    expect(await readMeetingPrepDue({ home, nowMs: Date.parse(ASKED), pagePublished: storeHolding })).toEqual({
      because: `${SLUG} is tagged to a meeting starting ${TAG.startIso}, and no page is published under it`,
      monitorId: "meeting-prep-due",
      state: "unmeasurable",
    });
  });

  it("reads a store that cannot say as unmeasurable for the due meeting, naming why", async () => {
    tagged();
    const reading = await readMeetingPrepDue({
      home,
      nowMs: Date.parse(ASKED),
      pagePublished: async () =>
        err(PublishedPagesReadErrors.unavailable({ cause: new Error("connection refused"), doing: "be opened" })),
    });
    expect(reading).toEqual({
      because:
        `${SLUG} is tagged to a meeting starting ${TAG.startIso}, and the store could not say whether it is published: ` +
        "the published-page store did not be opened: connection refused",
      monitorId: "meeting-prep-due",
      state: "unmeasurable",
    });
  });

  it("never asks the store when no meeting is due, so a store that is down leaves a quiet hour clear", async () => {
    tagged();
    const asked: string[] = [];
    const reading = await readMeetingPrepDue({
      home,
      nowMs: Date.parse("2026-10-01T00:00:00.000Z"),
      pagePublished: async ({ slug }) => {
        asked.push(slug);
        return err(
          PublishedPagesReadErrors.unavailable({ cause: new Error("connection refused"), doing: "be opened" }),
        );
      },
    });
    expect(reading).toEqual({ monitorId: "meeting-prep-due", state: "clear" });
    expect(asked).toEqual([]);
  });

  it("posts the card and raises its note in the hour, and settles it from its key once the meeting starts", async () => {
    tagged();
    const id = `mon-prep-${meetingPrepKey({ tag: TAG })}`;
    const up = await fired({ nowIso: ASKED, openIds: [] });
    expect(up.actions[0]).toBe(`posted ${id}`);
    expect(up.raised).toBe(1);
    expect(await fired({ nowIso: "2026-10-02T04:50:00.000Z", openIds: [id] })).toEqual({ actions: [], raised: 0 });
    const over = await fired({ nowIso: "2026-10-02T05:01:00.000Z", openIds: [id] });
    expect(over.actions).toEqual([`settled ${id}`]);
  });

  /* The owner's Done on one card, as `hand` reconciles the note's marker into the register. */
  async function pressDone({ id, atIso }: { id: string; atIso: string }): Promise<void> {
    const done = unwrap(
      buildSettledRow({
        draft: { bySession: "owner", did: "the owner pressed Done on the note", id, settledIso: atIso },
      }),
    );
    unwrap(await appendHandRow({ home, nowIso: atIso, row: done }));
  }

  it("never re-posts the card after the owner's Done while the meeting is still ahead", async () => {
    tagged();
    const id = `mon-prep-${meetingPrepKey({ tag: TAG })}`;
    expect((await fired({ nowIso: ASKED, openIds: [] })).actions[0]).toBe(`posted ${id}`);
    await pressDone({ atIso: "2026-10-02T04:45:00.000Z", id });
    expect(await fired({ nowIso: "2026-10-02T04:50:00.000Z", openIds: [] })).toEqual({ actions: [], raised: 0 });
  });

  it("holds both of two meetings the owner closed in turn, the sooner one still due", async () => {
    tagged();
    tagged({ tag: LATER });
    const sooner = `mon-prep-${meetingPrepKey({ tag: TAG })}`;
    const later = `mon-prep-${meetingPrepKey({ tag: LATER })}`;
    expect((await fired({ nowIso: "2026-10-02T04:00:00.000Z", openIds: [] })).actions[0]).toBe(`posted ${sooner}`);
    await pressDone({ atIso: "2026-10-02T04:10:00.000Z", id: sooner });
    expect((await fired({ nowIso: "2026-10-02T04:30:00.000Z", openIds: [] })).actions[0]).toBe(`posted ${later}`);
    await pressDone({ atIso: "2026-10-02T04:35:00.000Z", id: later });
    expect(await fired({ nowIso: "2026-10-02T04:40:00.000Z", openIds: [] })).toEqual({ actions: [], raised: 0 });
  });

  it("brings back a later meeting's card the pass departed for a sooner one, once the sooner one starts", async () => {
    tagged({ tag: LATER });
    const later = `mon-prep-${meetingPrepKey({ tag: LATER })}`;
    expect((await fired({ nowIso: "2026-10-02T04:35:00.000Z", openIds: [] })).actions).toEqual([
      `posted ${later}`,
      `noted ${later}`,
    ]);
    const sooner: MeetingTag = { ...TAG, taggedIso: "2026-10-02T04:40:00.000Z" };
    tagged({ tag: sooner });
    const soonerId = `mon-prep-${meetingPrepKey({ tag: sooner })}`;
    expect((await fired({ nowIso: "2026-10-02T04:45:00.000Z", openIds: [later] })).actions).toEqual([
      `posted ${soonerId}`,
      `noted ${soonerId}`,
      `settled ${later}`,
    ]);
    const back = await fired({ nowIso: "2026-10-02T05:01:00.000Z", openIds: [soonerId] });
    expect(back.actions).toEqual([`settled ${soonerId}`, `posted ${later}.2`, `noted ${later}.2`]);
    expect(back.raised).toBe(1);
  });

  it("holds a later meeting's card the owner snoozed when the pass departs it for a sooner one, like their Done", async () => {
    tagged({ tag: LATER });
    const later = `mon-prep-${meetingPrepKey({ tag: LATER })}`;
    expect((await fired({ nowIso: "2026-10-02T04:35:00.000Z", openIds: [] })).actions[0]).toBe(`posted ${later}`);
    unwrap(
      recordSnooze({
        home,
        record: {
          choice: "1h",
          id: later,
          pressedIso: "2026-10-02T04:36:00.000Z",
          untilIso: "2026-10-02T05:36:00.000Z",
        },
      }),
    );
    const sooner: MeetingTag = { ...TAG, taggedIso: "2026-10-02T04:40:00.000Z" };
    tagged({ tag: sooner });
    const soonerId = `mon-prep-${meetingPrepKey({ tag: sooner })}`;
    expect((await fired({ nowIso: "2026-10-02T04:45:00.000Z", openIds: [later] })).actions).toEqual([
      `posted ${soonerId}`,
      `noted ${soonerId}`,
      `settled ${later}`,
    ]);
    expect(await fired({ nowIso: "2026-10-02T05:01:00.000Z", openIds: [soonerId] })).toEqual({
      actions: [`settled ${soonerId}`],
      raised: 0,
    });
  });

  it("settles a card whose meeting started even while the ledger cannot be read", async () => {
    tagged();
    const id = `mon-prep-${meetingPrepKey({ tag: TAG })}`;
    expect((await fired({ nowIso: ASKED, openIds: [] })).actions[0]).toBe(`posted ${id}`);
    writeFileSync(stateHomePaths({ home }).pageMeetings, "not json\n");
    // The unreadable ledger is still reported as the monitor's own refusal; the card it can no longer judge settles.
    expect((await fired({ nowIso: "2026-10-02T05:01:00.000Z", openIds: [id] })).actions).toEqual([
      "refused meeting-prep-due",
      `settled ${id}`,
    ]);
  });
});
