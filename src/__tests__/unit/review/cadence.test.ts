/**
 * The bump cadence. The boundary cases are the point: an hour early must refuse, exactly a business day must
 * pass, a weekend never counts, and the owner's own message in the DM must never read as the reviewer's reply.
 */
import { describe, expect, it } from "vitest";

import {
  BUMP_AFTER_BUSINESS_HOURS,
  bumpVerdict,
  followUpChoices,
  type ReviewerActivity,
} from "../../../review/cadence.js";

/** A Tuesday morning in Melbourne — a weekday, so a plain 24 hours later is also 24 business hours later. */
const SENT = "2026-09-29T00:00:00.000Z";
const TARGET = "U-REVIEWER";

/** A Friday late afternoon in Melbourne — seven business hours are left in the week. */
const FRIDAY_SENT = "2026-09-25T07:00:00.000Z";

/** The verdict for a chase sent at {@link SENT}, with `now` and activity varied per case. */
function verdictAt({ nowIso, activity }: { nowIso: string; activity: ReviewerActivity }) {
  return bumpVerdict({ activity, lastSentIso: SENT, nowIso, targetSlackUserId: TARGET });
}

/** The verdict for a silent chase sent late on a Friday, read at `nowIso`. */
function fridayVerdictAt({ nowIso }: { nowIso: string }) {
  return bumpVerdict({ activity: { kind: "silent" }, lastSentIso: FRIDAY_SENT, nowIso, targetSlackUserId: TARGET });
}

describe("bumpVerdict", () => {
  it("is due at exactly the 24-business-hour boundary", () => {
    const verdict = verdictAt({ activity: { kind: "silent" }, nowIso: "2026-09-30T00:00:00.000Z" });

    expect(verdict.kind).toBe("due");
  });

  it("is NOT due one second before the boundary", () => {
    const verdict = verdictAt({ activity: { kind: "silent" }, nowIso: "2026-09-29T23:59:59.000Z" });

    expect(verdict.kind).toBe("too-soon");
  });

  it("names when it becomes eligible, so the owner is told rather than left guessing", () => {
    const verdict = verdictAt({ activity: { kind: "silent" }, nowIso: "2026-09-29T10:00:00.000Z" });

    expect(verdict).toEqual({
      eligibleAtIso: "2026-09-30T00:00:00.000Z",
      kind: "too-soon",
      why: "24 business hours of silence is the bar, weekends excluded; not bump-eligible until 2026-09-30T00:00:00.000Z",
    });
  });

  it("is NOT due on the Saturday after a Friday-afternoon ask, a calendar day later", () => {
    // Saturday late afternoon: 24 calendar hours, 7 business hours. The rule: nobody reviews on the weekend.
    expect(fridayVerdictAt({ nowIso: "2026-09-26T07:00:00.000Z" }).kind).toBe("too-soon");
  });

  it("is NOT due late on the Sunday, nor one second before Monday's matching hour", () => {
    expect(fridayVerdictAt({ nowIso: "2026-09-27T13:00:00.000Z" }).kind).toBe("too-soon");
    expect(fridayVerdictAt({ nowIso: "2026-09-28T06:59:59.000Z" }).kind).toBe("too-soon");
  });

  it("is due at Monday 17:00, the Friday's seven hours plus Monday's seventeen", () => {
    expect(fridayVerdictAt({ nowIso: "2026-09-28T07:00:00.000Z" })).toEqual({
      eligibleSinceIso: "2026-09-28T07:00:00.000Z",
      kind: "due",
      silentSinceIso: FRIDAY_SENT,
    });
  });

  it("names Monday, not Saturday, as when a Friday ask becomes eligible", () => {
    expect(fridayVerdictAt({ nowIso: "2026-09-26T07:00:00.000Z" })).toMatchObject({
      eligibleAtIso: "2026-09-28T07:00:00.000Z",
    });
  });

  it("reports the reviewer's own reply as replied", () => {
    const activity: ReviewerActivity = { atIso: "2026-09-29T01:00:00.000Z", bySlackUserId: TARGET, kind: "replied" };
    const verdict = verdictAt({ activity, nowIso: "2026-10-02T00:00:00.000Z" });

    expect(verdict.kind).toBe("replied");
  });

  it("does NOT treat somebody else's message in the DM as the reviewer replying", () => {
    // The measured trap: the owner types anything in that DM, so the newest message is the owner's. A timestamp-only
    // rule reads that as a reply and suppresses every future bump, permanently and silently.
    const activity: ReviewerActivity = { atIso: "2026-09-29T01:00:00.000Z", bySlackUserId: "U-OWNER", kind: "replied" };
    const verdict = verdictAt({ activity, nowIso: "2026-09-30T00:00:00.000Z" });

    expect(verdict.kind).toBe("due");
  });

  it("stays too-soon when somebody else spoke and the day has not elapsed", () => {
    const activity: ReviewerActivity = { atIso: "2026-09-29T01:00:00.000Z", bySlackUserId: "U-OWNER", kind: "replied" };
    const verdict = verdictAt({ activity, nowIso: "2026-09-29T12:00:00.000Z" });

    expect(verdict.kind).toBe("too-soon");
  });

  it("reports unknown, never silence, when nothing could be established", () => {
    const verdict = verdictAt({
      activity: { kind: "unknown", reason: "the DM could not be read" },
      nowIso: "2026-10-07T00:00:00.000Z",
    });

    expect(verdict.kind).toBe("unknown");
  });

  it("carries the reason for an unknown through to the owner", () => {
    const verdict = verdictAt({
      activity: { kind: "unknown", reason: "missing im:history" },
      nowIso: "2026-10-07T00:00:00.000Z",
    });

    expect(verdict).toMatchObject({ why: "could not tell whether they replied: missing im:history" });
  });

  it("is unknown rather than due when the last send is not a readable instant", () => {
    const verdict = bumpVerdict({
      activity: { kind: "silent" },
      lastSentIso: "not-a-date",
      nowIso: "2026-10-07T00:00:00.000Z",
      targetSlackUserId: TARGET,
    });

    expect(verdict).toEqual({ kind: "unknown", why: "the last send or the current time is not a readable instant" });
  });

  it("is unknown rather than due when NOW is not a readable instant", () => {
    const verdict = verdictAt({ activity: { kind: "silent" }, nowIso: "whenever" });

    expect(verdict.kind).toBe("unknown");
  });

  it("becomes due again a business day after a SECOND send — there is no bump ceiling", () => {
    // The owner's rule: chasing twice is normal. A counter that eventually refused the owner would be the defect.
    const secondSend = "2026-09-30T00:00:00.000Z";
    const verdict = bumpVerdict({
      activity: { kind: "silent" },
      lastSentIso: secondSend,
      nowIso: "2026-10-01T00:00:00.000Z",
      targetSlackUserId: TARGET,
    });

    expect(verdict.kind).toBe("due");
  });

  it("is still due on a fourth day of silence, with no terminal refusal", () => {
    const verdict = bumpVerdict({
      activity: { kind: "silent" },
      lastSentIso: "2026-10-01T00:00:00.000Z",
      nowIso: "2026-10-02T00:00:00.000Z",
      targetSlackUserId: TARGET,
    });

    expect(verdict.kind).toBe("due");
  });

  it("honours an explicit, longer window instead of the default — the cases the owner would wait longer on", () => {
    const verdict = bumpVerdict({
      activity: { kind: "silent" },
      afterBusinessHours: 48,
      lastSentIso: SENT,
      nowIso: "2026-09-30T00:00:00.000Z",
      targetSlackUserId: TARGET,
    });

    expect(verdict).toMatchObject({ eligibleAtIso: "2026-10-01T00:00:00.000Z", kind: "too-soon" });
  });

  it("defaults the window to a business day", () => {
    expect(BUMP_AFTER_BUSINESS_HOURS).toBe(24);
  });

  it("reports what it was silent since, so the owner card can say it", () => {
    const verdict = verdictAt({ activity: { kind: "silent" }, nowIso: "2026-10-01T00:00:00.000Z" });

    expect(verdict).toMatchObject({ silentSinceIso: SENT });
  });
});

describe("followUpChoices", () => {
  it("offers exactly the two the owner named", () => {
    const [first, second] = followUpChoices({ login: "ada" });

    expect(first.kind).toBe("bump");
    expect(second.kind).toBe("ask-different");
  });

  it("names the person in the bump choice", () => {
    const [first] = followUpChoices({ login: "ada" });

    expect(first).toMatchObject({ login: "ada" });
  });

  it("does NOT name a candidate for ask-different, because ownership is not ours to guess", () => {
    const [, second] = followUpChoices({ login: "ada" });

    expect(Object.keys(second).toSorted()).toEqual(["kind", "why"]);
  });

  it("offers no widen-to-team-group choice — a group ping reaches people the owner never chose", () => {
    const kinds = followUpChoices({ login: "ada" }).map((choice) => choice.kind);

    expect(kinds).toEqual(["bump", "ask-different"]);
  });
});
