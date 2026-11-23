/*
 * What a row is scored and graded on: `prUnverified`, `prLastMovedIso`, the ranker's `prReadings`, and the
 * provider-fact evidence `prEvidence` attaches.
 */
import { describe, expect, it } from "vitest";

import { prLastMovedIso } from "../../../../sessionStart/githubLeg.js";
import { AGE_DAYS_CAP, prEvidence, prReadings, prUnverified } from "../../../../sessionStart/githubLegReadings.js";
import { BOT_IDS, mention, NOW, review, state } from "./fixtures.js";

describe("prUnverified", () => {
  it("is false when the recommendation is bounded", () => {
    expect(prUnverified({ state: state() })).toBe(false);
  });

  it("is true when the recommendation itself is unknown", () => {
    expect(prUnverified({ state: state({ recommendation: "unknown" }) })).toBe(true);
  });

  it("is false on an unknown CodeRabbit read, which is advisory and withholds nothing", () => {
    expect(prUnverified({ state: state({ codeRabbit: "unknown" }) })).toBe(false);
  });
});

describe("prLastMovedIso", () => {
  it("measures silence from the newest named ask while it sits with somebody", () => {
    const asked = mention({ atIso: "2026-08-25T00:00:00.000Z" });
    const pushedLater = state({
      slack: { asked: "yes", asks: [asked], bounded: true, mentioned: "yes", mentions: [asked], why: "" },
      updatedAtIso: "2026-08-31T00:00:00.000Z",
    });
    expect(prLastMovedIso({ botIds: BOT_IDS, state: pushedLater, whose: { party: "other", who: "A Colleague" } })).toBe(
      "2026-08-25T00:00:00.000Z",
    );
  });

  it("measures from the last push once the ask has been answered, not from the ask", () => {
    // Otherwise the hours a reviewer took to reply are reported as hours the owner has sat on their answer.
    const asked = mention({ atIso: "2026-08-25T00:00:00.000Z" });
    const answered = state({
      bump: { kind: "replied", why: "they have replied, so there is nothing to chase" },
      slack: { asked: "yes", asks: [asked], bounded: true, mentioned: "yes", mentions: [asked], why: "" },
      updatedAtIso: "2026-08-31T00:00:00.000Z",
    });
    expect(prLastMovedIso({ botIds: BOT_IDS, state: answered, whose: { party: "owner" } })).toBe(
      "2026-08-31T00:00:00.000Z",
    );
  });

  it("falls back to the last push when no ask named anybody", () => {
    const noAsks = state({ slack: { asked: "no", asks: [], bounded: true, mentioned: "no", mentions: [], why: "" } });
    expect(prLastMovedIso({ botIds: BOT_IDS, state: noAsks, whose: { party: "owner" } })).toBe(
      "2026-08-30T00:00:00.000Z",
    );
  });
});

describe("prReadings", () => {
  it("does not claim somebody is stopped on the owner without a review that landed", () => {
    expect(prReadings({ nowIso: NOW, state: state(), whose: { party: "owner" } }).stoppedOnOwner).toBe(0);
  });

  it("claims it once a human reviewed after the ask, which hands it back to the owner", () => {
    const reviewed = state({ reviewedSinceAsk: [review({ login: "a-colleague" })] });
    expect(prReadings({ nowIso: NOW, state: reviewed, whose: { party: "owner" } }).stoppedOnOwner).toBe(5);
  });

  it("never reads drift, so a stale CodeRabbit verdict cannot win a row's explanation", () => {
    const stale = state({ codeRabbit: "stale" });
    expect(prReadings({ nowIso: NOW, state: stale, whose: { party: "owner" } }).drift).toBe(0);
  });

  it("reads no drift on an ordinary pull request either", () => {
    expect(prReadings({ nowIso: NOW, state: state(), whose: { party: "owner" } }).drift).toBe(0);
  });

  it("never dresses a CI signal as a priority the owner set", () => {
    expect(prReadings({ nowIso: NOW, state: state({ ci: "red" }), whose: { party: "owner" } }).explicitPriority).toBe(
      0,
    );
  });

  it("caps age at the ranker's own cap", () => {
    const old = state({ updatedAtIso: "2026-01-01T00:00:00.000Z" });
    expect(prReadings({ nowIso: NOW, state: old, whose: { party: "owner" } }).age).toBe(AGE_DAYS_CAP);
  });

  it("reports zero age for a pull request pushed after the run's own instant", () => {
    const future = state({ updatedAtIso: "2026-09-09T00:00:00.000Z" });
    expect(prReadings({ nowIso: NOW, state: future, whose: { party: "owner" } }).age).toBe(0);
  });

  it("says one act finishes a chase", () => {
    const readings = prReadings({ nowIso: NOW, state: state(), whose: { party: "other", who: "A Colleague" } });
    expect(readings.distanceToDone).toBe(3);
  });

  it("says a blocked pull request is further from done than one ready to go out", () => {
    const red = state({ ci: "red", recommendation: "blocked" });
    expect(prReadings({ nowIso: NOW, state: red, whose: { party: "owner" } }).distanceToDone).toBe(1);
  });

  it("says a draft is two acts from done, because it needs undrafting and then asking", () => {
    const draft = state({ recommendation: "still-draft", undrafted: false });
    expect(prReadings({ nowIso: NOW, state: draft, whose: { party: "owner" } }).distanceToDone).toBe(2);
  });
});

describe("prEvidence", () => {
  it("grades the row a provider fact and names who was asked", () => {
    const evidence = prEvidence({ state: state(), whose: { party: "other", who: "A Colleague" } });
    expect(evidence).toEqual([
      {
        grade: "provider-fact",
        showsResolved: false,
        source: "https://github.com/acme/widgets/pull/7",
        what: "open since its last push at 2026-08-30T00:00:00.000Z, CI green, and A Colleague was asked to review it in Slack",
      },
    ]);
  });

  it("says plainly that nobody reachable was asked when nobody was", () => {
    const evidence = prEvidence({ state: state(), whose: { ownerAlreadyActed: false, party: "nobody" } });
    expect(evidence[0]!.what).toBe(
      "open since its last push at 2026-08-30T00:00:00.000Z, CI green, and nobody a bump could reach has been asked to review it in Slack",
    );
  });
});
