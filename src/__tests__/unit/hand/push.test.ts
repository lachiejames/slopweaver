import { describe, expect, it } from "vitest";

import { outstandingSubjects } from "../../../cli/commands/hand/push.js";
import { noteEyebrow } from "../../../hand/note/eyebrow.js";
import { parsePushRow } from "../../../hand/push/ledger.js";
import { decidePush, handStepSubject, type PushSubject, waitingAskSubject } from "../../../hand/push/select.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { buildPushNotice, fitLine, notifyCommandLines } from "./pushHelpers.js";

function subject(over: Partial<PushSubject> = {}): PushSubject {
  return {
    headline: "Sign in to Google Cloud",
    id: "hand:gcloud-signin",
    kind: "hand-step",
    tier: "fleet-blocked",
    ...over,
  };
}

/** A built step with the given id and whatever else a case varies. */
function step({ id, ...over }: { id: string } & Partial<HandStepDraft>): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id,
        postedBy: "workspace:129",
        postedIso: "2026-09-19T04:35:44.113Z",
        unblocks: "#885",
        what: "Pick the code owners on #885",
        witness: `slopweaver hand done ${id}`,
        ...over,
      },
    }),
  );
}

describe("outstandingSubjects — the one ranking: what blocks a colleague leads, a check-in ends", () => {
  it("leads with the work step and a person's waiting ask, then the fleet's step, then the check-in", () => {
    // The shape the owner met: a dogfood check-in posted first, work blocked on the owner posted after it.
    const subjects = outstandingSubjects({
      asks: [{ headline: "Approve the Vanta request", id: "C123/1700000000.1", kind: "go-ahead" }],
      steps: [
        step({ checkIn: true, id: "try-now-page", what: "Open the new Now page and say whether it reads right" }),
        step({ id: "chair-respawn", what: "Say whether the chair may re-spawn itself" }),
        step({ context: "work", id: "owners-885" }),
      ],
    });
    expect(subjects.map((s) => s.id)).toEqual([
      "hand:owners-885",
      "ask:C123/1700000000.1",
      "hand:chair-respawn",
      "hand:try-now-page",
    ]);
    expect(subjects.map((s) => s.tier)).toEqual(["team-blocked", "team-blocked", "fleet-blocked", "check-in"]);
  });

  it("keeps each register's oldest-first order within a tier", () => {
    const subjects = outstandingSubjects({ asks: [], steps: [step({ id: "first-one" }), step({ id: "second-one" })] });
    expect(subjects.map((s) => s.id)).toEqual(["hand:first-one", "hand:second-one"]);
  });

  it("answers nothing waiting with nothing", () => {
    expect(outstandingSubjects({ asks: [], steps: [] })).toEqual([]);
  });
});

describe("the note's eyebrow reads as the ranking places the step", () => {
  it("says CHECK-IN on a step its poster said is one", () => {
    expect(noteEyebrow({ step: step({ checkIn: true, id: "try-now-page" }) })).toBe("SLOPWEAVER \u00b7 CHECK-IN");
  });

  it("says ONE STEP on every other step", () => {
    expect(noteEyebrow({ step: step({ id: "owners-885" }) })).toBe("SLOPWEAVER \u00b7 ONE STEP");
  });
});

describe("decidePush — arrival only, and no clock anywhere", () => {
  it("sends on a first look at a fresh install", () => {
    const decision = decidePush({ before: { ids: [] }, outstanding: [subject()] });
    expect(decision.send).toBe(true);
    expect(decision.record).toBe(true);
    expect(decision.arrived.map((s) => s.id)).toEqual(["hand:gcloud-signin"]);
    expect(decision.why).toBe("1 new of 1 outstanding — sending one notification");
  });

  it("is SILENT on the same set looked at again, however many times", () => {
    const before = { ids: ["hand:gcloud-signin"] };
    const decision = decidePush({ before, outstanding: [subject()] });
    expect(decision.send).toBe(false);
    expect(decision.record).toBe(false);
    expect(decision.why).toBe("1 outstanding, none new — the owner already knows, so nothing is sent");
  });

  it("sends only about the member that ARRIVED, not the one the owner already knows", () => {
    const decision = decidePush({
      before: { ids: ["hand:gcloud-signin"] },
      outstanding: [subject(), subject({ headline: "Pick code owners on #885", id: "hand:owners-885" })],
    });
    expect(decision.arrived.map((s) => s.id)).toEqual(["hand:owners-885"]);
    expect(decision.why).toBe("1 new of 2 outstanding — sending one notification");
  });

  it("records a departure WITHOUT sending, so the same subject can push again later", () => {
    const decision = decidePush({ before: { ids: ["hand:gcloud-signin"] }, outstanding: [] });
    expect(decision.send).toBe(false);
    expect(decision.record).toBe(true);
    expect(decision.why).toBe("nothing new; 1 cleared — recording the set and sending nothing");
  });

  it("does nothing at all when nothing is waiting and nothing was", () => {
    const decision = decidePush({ before: { ids: [] }, outstanding: [] });
    expect(decision.send).toBe(false);
    expect(decision.record).toBe(false);
    expect(decision.why).toBe("nothing is waiting on the owner");
  });

  it("keeps the caller's order and re-sorts by nothing", () => {
    const ask = waitingAskSubject({
      ask: { headline: "Approve the Vanta request", id: "C123/1700000000.1", kind: "go-ahead" },
    });
    const posted = handStepSubject({ step: step({ id: "owners-885" }) });
    const decision = decidePush({ before: { ids: [] }, outstanding: [posted, ask] });
    expect(decision.outstanding.map((s) => s.id)).toEqual(["hand:owners-885", "ask:C123/1700000000.1"]);
  });
});

describe("buildPushNotice — the schema refuses, it never truncates", () => {
  it("uses the owner's own words for a blocked sign-in", () => {
    const notice = unwrap(
      buildPushNotice({
        arrived: [subject({ headline: "Sign in to Datadog", id: "ask:C1/1.2", kind: "sign-in" })],
        noteShown: false,
        outstandingCount: 1,
      }),
    );
    expect(notice.title).toBe("A live thing is blocked");
    expect(notice.subtitle).toBe("Sign in to Datadog");
    expect(notice.body).toBe("Come sign in");
  });

  it("points a hand step at the note that is already on screen", () => {
    const notice = unwrap(buildPushNotice({ arrived: [subject()], noteShown: true, outstandingCount: 1 }));
    expect(notice.title).toBe("One step needs your hand");
    expect(notice.body).toBe("The note is on screen, top right");
  });

  it("points a hand step at the menu bar list when its note did not come up", () => {
    const notice = unwrap(buildPushNotice({ arrived: [subject()], noteShown: false, outstandingCount: 1 }));
    expect(notice.body).toBe("It is in the menu bar list");
  });

  it("collapses several arrivals into ONE banner naming the count", () => {
    const notice = unwrap(
      buildPushNotice({
        arrived: [subject(), subject({ id: "hand:owners-885" }), subject({ id: "hand:vanta" })],
        noteShown: true,
        outstandingCount: 5,
      }),
    );
    expect(notice.title).toBe("3 things need your hand");
    expect(notice.body).toBe("The note is on screen, top right · 5 waiting in all");
  });

  it("says nothing about a total that is only what arrived", () => {
    const notice = unwrap(buildPushNotice({ arrived: [subject()], noteShown: true, outstandingCount: 1 }));
    expect(notice.body.includes("waiting in all")).toBe(false);
  });

  it("refuses an empty arrival rather than posting a nag", () => {
    const error = unwrapErr(buildPushNotice({ arrived: [], noteShown: true, outstandingCount: 3 }));
    expect(error.code).toBe("INVALID_FIELD");
    expect(error.message).toContain("a banner with nothing new in it is a nag");
  });

  it("cuts a long headline at a word boundary, and never mid-word", () => {
    expect(fitLine({ cap: 20, text: "Sign in to Google Cloud so the deploy finishes" })).toBe("Sign in to Google");
    expect(fitLine({ cap: 60, text: "short" })).toBe("short");
  });
});

describe("notifyCommand — every value travels as argv", () => {
  it("passes the three lines positionally after one CONSTANT program", () => {
    const lines = notifyCommandLines({
      body: "Come sign in",
      subtitle: 'they said "});" and left',
      title: "A live thing is blocked",
    });
    expect(lines.file).toBe("osascript");
    expect(lines.args.slice(0, 2)).toEqual(["-l", "JavaScript"]);
    expect(lines.args.slice(4)).toEqual(["A live thing is blocked", 'they said "});" and left', "Come sign in"]);
    expect(lines.args[3]!.includes("they said")).toBe(false);
  });

  it("emits the SAME program byte for byte whatever the lines say", () => {
    const tame = notifyCommandLines({ body: "b", subtitle: "s", title: "t" });
    const hostile = notifyCommandLines({
      body: "'; $(whoami); '",
      subtitle: 'they said "});" and left',
      title: "\u0000\n\\",
    });
    expect(hostile.args[3]).toBe(tame.args[3]);
    expect(tame.args[3]).toContain("app.displayNotification(argv[2]");
  });
});

describe("parsePushRow", () => {
  it("reads a complete row", () => {
    const row = unwrap(
      parsePushRow({
        line: '{"atIso":"2026-09-19T05:01:03.704Z","outstanding":["hand:a"],"sent":true}',
        lineNumber: 1,
      }),
    );
    expect(row.outstanding).toEqual(["hand:a"]);
    expect(row.sent).toBe(true);
  });

  it("refuses a row whose `sent` is missing, naming the line", () => {
    const error = unwrapErr(parsePushRow({ line: '{"atIso":"x","outstanding":[]}', lineNumber: 7 }));
    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("line 7");
  });

  it("refuses an `outstanding` holding something that is not a string", () => {
    const error = unwrapErr(parsePushRow({ line: '{"atIso":"x","outstanding":[1],"sent":false}', lineNumber: 2 }));
    expect(error.code).toBe("CORRUPT_ROW");
    expect(error.message).toContain("holds only strings");
  });
});
