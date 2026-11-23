/**
 * The attach-upload standing over a set of journals — pure, every journal built inline. Closed until a live ruling
 * permits it, closed on any gap, reversed by a later ruling of the other verdict.
 */
import { describe, expect, it } from "vitest";

import {
  type AttachUploadRulingOnRow,
  attachUploadRefusalLines,
  attachUploadStanding,
  attachUploadStandingLine,
  latestAttachUploadRuling,
} from "../../../handover/attachUploadRuling.js";
import type { AttachUploadVerdict } from "../../../handover/attachUploadRulingTypes.js";
import type { RulingEvent, RunEvent } from "../../../handover/ledger.js";

/** A ruling decided at `decidedIso` that carries the attach-upload half, typed as the standing names it. */
function ruling({
  backfilledFrom,
  decidedIso,
  verdict,
}: {
  backfilledFrom?: string;
  decidedIso: string;
  verdict: AttachUploadVerdict;
}): AttachUploadRulingOnRow["ruling"] {
  return {
    anchor: `talk:${decidedIso}`,
    atIso: decidedIso,
    attachUpload: { verdict },
    decidedIso,
    kind: "ruling",
    ruling: `pictures ${verdict}`,
    ...(backfilledFrom === undefined ? {} : { backfilledFrom }),
  };
}

const STARTED: RunEvent = { atIso: "2026-11-22T00:00:00.000Z", branch: "a-row", docHash: "h", kind: "started" };
const EARLY = "2026-11-22T01:00:00.000Z";
const LATE = "2026-11-22T02:00:00.000Z";

/** A live ruling that says nothing about attach upload. */
const SILENT_ON_UPLOAD: RulingEvent = {
  anchor: `talk:${EARLY}`,
  atIso: EARLY,
  decidedIso: EARLY,
  kind: "ruling",
  ruling: "ship the briefing",
};

describe("latestAttachUploadRuling", () => {
  it("answers nothing when no live ruling carries the half", () => {
    const events = [STARTED, SILENT_ON_UPLOAD];
    expect(latestAttachUploadRuling({ journals: [{ events, slug: "a-row" }] })).toBe(undefined);
  });

  it("takes the latest by decision instant across rows, whichever row is walked first", () => {
    const later = ruling({ decidedIso: LATE, verdict: "refused" });
    const journals = [
      { events: [later], slug: "row-b" },
      { events: [ruling({ decidedIso: EARLY, verdict: "permitted" })], slug: "row-a" },
    ];
    expect(latestAttachUploadRuling({ journals })).toEqual({ ruling: later, slug: "row-b" });
  });

  it("breaks an equal decision instant by the instant each was recorded, whichever row is walked first", () => {
    const recordedLater = { ...ruling({ decidedIso: EARLY, verdict: "refused" }), atIso: LATE };
    const journals = [
      { events: [recordedLater], slug: "row-a" },
      { events: [ruling({ decidedIso: EARLY, verdict: "permitted" })], slug: "row-b" },
    ];
    expect(latestAttachUploadRuling({ journals })!.slug).toBe("row-a");
  });

  it("breaks a tie on both instants by walk order, the later line winning", () => {
    const journals = [
      { events: [ruling({ decidedIso: EARLY, verdict: "permitted" })], slug: "row-a" },
      { events: [ruling({ decidedIso: EARLY, verdict: "refused" })], slug: "row-b" },
    ];
    expect(latestAttachUploadRuling({ journals })!.slug).toBe("row-b");
  });

  it("never counts a reconstruction, on either verdict", () => {
    const events = [ruling({ backfilledFrom: LATE, decidedIso: LATE, verdict: "permitted" })];
    expect(latestAttachUploadRuling({ journals: [{ events, slug: "a-row" }] })).toBe(undefined);
  });
});

describe("attachUploadStanding", () => {
  it("is refused as unruled when nothing rules on attach upload", () => {
    expect(attachUploadStanding({ gaps: [], journals: [] })).toEqual({ because: "unruled", kind: "refused" });
  });

  it("is permitted by a live permitting ruling", () => {
    const permit = ruling({ decidedIso: EARLY, verdict: "permitted" });
    const standing = attachUploadStanding({ gaps: [], journals: [{ events: [permit], slug: "a-row" }] });
    expect(standing).toEqual({ by: { ruling: permit, slug: "a-row" }, kind: "permitted" });
  });

  it("is refused again by a later refusing ruling, with no release recorded", () => {
    const refuse = ruling({ decidedIso: LATE, verdict: "refused" });
    const events = [ruling({ decidedIso: EARLY, verdict: "permitted" }), refuse];
    const standing = attachUploadStanding({ gaps: [], journals: [{ events, slug: "a-row" }] });
    expect(standing).toEqual({ because: "ruled", by: { ruling: refuse, slug: "a-row" }, kind: "refused" });
  });

  it("is permitted again by a later permitting ruling", () => {
    const permit = ruling({ decidedIso: LATE, verdict: "permitted" });
    const events = [ruling({ decidedIso: EARLY, verdict: "refused" }), permit];
    const standing = attachUploadStanding({ gaps: [], journals: [{ events, slug: "a-row" }] });
    expect(standing).toEqual({ by: { ruling: permit, slug: "a-row" }, kind: "permitted" });
  });

  it("is refused on any gap, even over a permitting ruling", () => {
    const permit = ruling({ decidedIso: EARLY, verdict: "permitted" });
    const gaps = ["runs/b.jsonl: line 3 would not decode"];
    const standing = attachUploadStanding({ gaps, journals: [{ events: [permit], slug: "a-row" }] });
    expect(standing).toEqual({ because: "unreadable", gaps, kind: "refused" });
  });
});

describe("attachUploadRefusalLines", () => {
  it("names the rule, the deciding ruling and the one permitting command, and offers no hatch", () => {
    const refuse = ruling({ decidedIso: EARLY, verdict: "refused" });
    const lines = attachUploadRefusalLines({
      standing: { because: "ruled", by: { ruling: refuse, slug: "a-row" }, kind: "refused" },
    });
    expect([
      lines[0],
      lines[2],
      lines[3],
      lines.at(-1),
      lines.some((line) => line.includes("SLOPWEAVER_ALLOW")),
    ]).toEqual([
      "refused: attach-upload: `slopweaver github attach upload` sends no picture or recording off this machine",
      "  the owner ruled it refused on a-row: pictures refused",
      `    where: talk:${EARLY}`,
      '  way past: slopweaver handover rule <slug> --anchor <where the owner said it> --words "<the owner\'s words>" ' +
        "--attach-upload permitted",
      false,
    ]);
  });

  it("lists every gap when a journal would not read", () => {
    const lines = attachUploadRefusalLines({
      standing: { because: "unreadable", gaps: ["one", "two"], kind: "refused" },
    });
    expect(lines.slice(2, 5)).toEqual([
      "  a journal naming the attach-upload ruling would not read whole, so the latest word is unknown:",
      "    one",
      "    two",
    ]);
  });
});

describe("attachUploadStandingLine", () => {
  it("says which way attach upload stands and why, one line each", () => {
    const permit = ruling({ decidedIso: EARLY, verdict: "permitted" });
    expect([
      attachUploadStandingLine({ standing: { by: { ruling: permit, slug: "a-row" }, kind: "permitted" } }),
      attachUploadStandingLine({ standing: { because: "unruled", kind: "refused" } }),
      attachUploadStandingLine({ standing: { because: "unreadable", gaps: ["x"], kind: "refused" } }),
    ]).toEqual([
      `attach upload is permitted by the owner's ruling on a-row (talk:${EARLY})`,
      "attach upload is refused: no ruling on this install permits it",
      "attach upload is refused: a journal naming its ruling would not read whole",
    ]);
  });
});
