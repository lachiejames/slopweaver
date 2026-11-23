/**
 * Which kind of correction each turn of the owner's names: a read journalled per turn, folded into one trail per kind.
 */
import { describe, expect, it } from "vitest";

import { parseProfileSteersArgs } from "../../../cli/commands/profile/steersArgs.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import type { OwnerUtterance } from "../../../profile/ownerWords.js";
import {
  cuedKinds,
  foldSteerVerdicts,
  parseSteerVerdicts,
  quoteIsVerbatim,
  SLACK_STEER_KINDS,
  STEER_RESIDUE,
  type SteerPoint,
  type SteerVerdict,
  steerKindsReading,
  steerVerdictLine,
  unreadSteerCandidates,
} from "../../../profile/steerKinds.js";
import { quietDays, steerKindsLines } from "../../../profile/steerKindsLines.js";
import { withoutRelayTwins } from "../../../profile/steerRelayTwins.js";

/** The install's own bot handle in these tests. */
const OWN = ["acme-bot"];

/** One turn of the owner's. */
function turn({ anchor, atIso, text }: { anchor: string; atIso: string; text: string }): OwnerUtterance {
  return { anchor, atIso, chars: text.length, cut: "none", how: "spoken", text, where: "console-call" };
}

const DUMP = turn({
  anchor: "talk-call:c1#t1",
  atIso: "2026-09-01T00:00:00.000Z",
  text: "That Slack draft had em dashes again, get rid of them.\nAlso attach the screenshot as proof next time.",
});
const LATER = turn({
  anchor: "talk-call:c1#t2",
  atIso: "2026-09-20T00:00:00.000Z",
  text: "I haven't given a steer about em dashes on a Slack message in ages.",
});
const UNCUED = turn({ anchor: "talk-call:c1#t3", atIso: "2026-09-21T00:00:00.000Z", text: "Merge the PR please." });
const OFF_SLACK = turn({
  anchor: "talk-call:c1#t4",
  atIso: "2026-09-22T00:00:00.000Z",
  text: "Tag the Datadog monitor.",
});

const JUDGED = "2026-10-05T00:00:00.000Z";

const DUMP_DASH: SteerVerdict = {
  anchor: DUMP.anchor,
  judgedAtIso: JUDGED,
  kind: "em-dashes",
  quote: "had em dashes again, get rid of them.",
  says: "corrects",
  turnAtIso: DUMP.atIso,
};
const DUMP_PROOF: SteerVerdict = {
  anchor: DUMP.anchor,
  judgedAtIso: JUDGED,
  kind: "proof",
  quote: "attach the screenshot as proof",
  says: "corrects",
  turnAtIso: DUMP.atIso,
};
const LATER_STOPPED: SteerVerdict = {
  anchor: LATER.anchor,
  judgedAtIso: JUDGED,
  kind: "em-dashes",
  quote: "I haven't given a steer about em dashes on a Slack message in ages.",
  says: "stopped",
  turnAtIso: LATER.atIso,
};

describe("cuedKinds", () => {
  it("offers a turn naming Slack for every kind whose cue it holds", () => {
    expect(cuedKinds({ botHandles: OWN, text: DUMP.text })).toEqual(["em-dashes", "proof"]);
  });

  it("offers nothing for a cue with no word placing it on Slack, nor for a Slack turn with no cue", () => {
    expect(cuedKinds({ botHandles: OWN, text: OFF_SLACK.text })).toEqual([]);
    expect(cuedKinds({ botHandles: OWN, text: "send the slack message" })).toEqual([]);
  });

  it("places a turn on Slack by the bot's role or its handle, never by a word merely ending in bot", () => {
    expect(cuedKinds({ botHandles: OWN, text: "acme-bot is too verbose" })).toEqual(["length"]);
    expect(cuedKinds({ botHandles: OWN, text: "the bot is too verbose" })).toEqual(["length"]);
    expect(cuedKinds({ botHandles: OWN, text: "the robot is too verbose" })).toEqual([]);
  });

  it("never places a turn on Slack by a `-bot` handle the install did not declare as its own", () => {
    expect(cuedKinds({ botHandles: OWN, text: "github-bot is too verbose" })).toEqual([]);
    expect(cuedKinds({ botHandles: [], text: "acme-bot is too verbose" })).toEqual([]);
  });

  it("has a cue for every kind it draws", () => {
    expect(SLACK_STEER_KINDS.length).toBeGreaterThan(0);
    expect(SLACK_STEER_KINDS.filter((kind) => kind.cues.length === 0)).toEqual([]);
  });
});

describe("quoteIsVerbatim", () => {
  it("takes a run of the turn across a line break, whitespace aside", () => {
    expect(quoteIsVerbatim({ quote: "get rid of them. Also attach", text: DUMP.text })).toBe(true);
  });

  it("refuses a paraphrase and an empty quote", () => {
    expect(quoteIsVerbatim({ quote: "remove the em dashes", text: DUMP.text })).toBe(false);
    expect(quoteIsVerbatim({ quote: "  ", text: DUMP.text })).toBe(false);
  });
});

describe("parseSteerVerdicts", () => {
  it("reads back every line it writes, and names a line that will not read by its number", () => {
    const nothing: SteerVerdict = {
      anchor: UNCUED.anchor,
      judgedAtIso: JUDGED,
      says: "nothing",
      turnAtIso: UNCUED.atIso,
    };
    const lines = [steerVerdictLine({ verdict: DUMP_DASH }), "{not json", "", steerVerdictLine({ verdict: nothing })];
    expect(parseSteerVerdicts({ lines })).toEqual({ unparsed: [2], verdicts: [DUMP_DASH, nothing] });
  });

  it("refuses a kind the page does not draw and a key nobody declared", () => {
    const lines = [JSON.stringify({ ...DUMP_DASH, kind: "fonts" }), JSON.stringify({ ...DUMP_DASH, colour: "green" })];
    expect(parseSteerVerdicts({ lines }).unparsed).toEqual([1, 2]);
  });
});

describe("foldSteerVerdicts", () => {
  it("lets a later read of one turn's kind replace the earlier, a withdrawal remove it, and counts the turn read", () => {
    const fold = foldSteerVerdicts({
      verdicts: [
        DUMP_DASH,
        { ...DUMP_DASH, quote: "em dashes again" },
        DUMP_PROOF,
        { anchor: DUMP.anchor, judgedAtIso: JUDGED, kind: "proof", says: "withdrawn" },
      ],
    });
    expect(fold.standing.map((one) => [one.kind, one.quote])).toEqual([["em-dashes", "em dashes again"]]);
    expect([...fold.read]).toEqual([DUMP.anchor]);
  });

  it("counts a turn read as naming nothing as read, and draws no point for it", () => {
    const fold = foldSteerVerdicts({
      verdicts: [{ anchor: UNCUED.anchor, judgedAtIso: JUDGED, says: "nothing", turnAtIso: UNCUED.atIso }],
    });
    expect([fold.standing, [...fold.read]]).toEqual([[], [UNCUED.anchor]]);
  });
});

describe("unreadSteerCandidates", () => {
  it("offers only cued turns no read has touched, oldest first", () => {
    const unread = unreadSteerCandidates({
      botHandles: OWN,
      read: new Set([DUMP.anchor]),
      utterances: [LATER, UNCUED, DUMP, OFF_SLACK],
    });
    expect(unread.map((one) => [one.anchor, one.cued])).toEqual([[LATER.anchor, ["em-dashes"]]]);
  });

  it("orders several unread turns oldest first, whatever order they arrive in", () => {
    const unread = unreadSteerCandidates({ botHandles: OWN, read: new Set(), utterances: [LATER, UNCUED, DUMP] });
    expect(unread.map((one) => one.anchor)).toEqual([DUMP.anchor, LATER.anchor]);
  });
});

describe("steerKindsReading", () => {
  const reading = steerKindsReading({
    botHandles: OWN,
    gaps: ["supervisor: the chain starts at 2026-08-10"],
    nowIso: "2026-10-05T12:00:00.000Z",
    sinceIso: "2026-08-06T12:00:00.000Z",
    unparsed: [],
    utterances: [DUMP, LATER, UNCUED],
    verdicts: [DUMP_DASH, DUMP_PROOF],
  });

  it("puts one voice dump on two charts, each quoting its own words with the turn whole behind it", () => {
    const dash = reading.kinds.find((one) => one.kind === "em-dashes")!;
    const proof = reading.kinds.find((one) => one.kind === "proof")!;
    expect(dash.points).toEqual([
      { anchor: DUMP.anchor, atIso: DUMP.atIso, quote: DUMP_DASH.quote, says: "corrects", text: DUMP.text },
    ]);
    expect(proof.points.map((point) => point.quote)).toEqual(["attach the screenshot as proof"]);
  });

  it("leaves a corrected kind open until a turn of the owner's says it stopped", () => {
    expect(reading.kinds.find((one) => one.kind === "em-dashes")!.stoppedIso).toBeUndefined();
    const confirmed = steerKindsReading({
      botHandles: OWN,
      gaps: [],
      nowIso: "2026-10-05T12:00:00.000Z",
      sinceIso: "2026-08-06T12:00:00.000Z",
      unparsed: [],
      utterances: [DUMP, LATER],
      verdicts: [DUMP_DASH, LATER_STOPPED],
    });
    const dash = confirmed.kinds.find((one) => one.kind === "em-dashes")!;
    expect([dash.lastCorrectedIso, dash.stoppedIso]).toEqual([DUMP.atIso, LATER.atIso]);
  });

  it("does not let a word that it stopped stand over a correction made after it", () => {
    const reopened = steerKindsReading({
      botHandles: OWN,
      gaps: [],
      nowIso: "2026-10-05T12:00:00.000Z",
      sinceIso: "2026-08-06T12:00:00.000Z",
      unparsed: [],
      utterances: [],
      verdicts: [LATER_STOPPED, { ...DUMP_DASH, anchor: "talk-call:c1#t9", turnAtIso: "2026-09-30T00:00:00.000Z" }],
    });
    expect(reopened.kinds.find((one) => one.kind === "em-dashes")!.stoppedIso).toBeUndefined();
  });

  it("draws only turns inside the window, and counts only those as read", () => {
    const narrow = steerKindsReading({
      botHandles: OWN,
      gaps: [],
      nowIso: "2026-10-05T12:00:00.000Z",
      sinceIso: "2026-09-10T00:00:00.000Z",
      unparsed: [],
      utterances: [LATER],
      verdicts: [DUMP_DASH, LATER_STOPPED],
    });
    const dash = narrow.kinds.find((one) => one.kind === "em-dashes")!;
    expect(dash.points.map((point) => point.anchor)).toEqual([LATER.anchor]);
    expect([dash.lastCorrectedIso, dash.stoppedIso, narrow.read]).toEqual([undefined, LATER.atIso, 1]);
  });

  it("never draws a verdict whose quote the turn does not hold, and names it under the gaps", () => {
    const forged = steerKindsReading({
      botHandles: OWN,
      gaps: [],
      nowIso: "2026-10-05T12:00:00.000Z",
      sinceIso: "2026-08-06T12:00:00.000Z",
      unparsed: [],
      utterances: [DUMP],
      verdicts: [{ ...DUMP_DASH, quote: "the em dashes are fine now" }, DUMP_PROOF],
    });
    expect(forged.kinds.find((one) => one.kind === "em-dashes")!.points).toEqual([]);
    expect(forged.kinds.find((one) => one.kind === "proof")!.points.length).toBe(1);
    expect(forged.gaps).toEqual([
      `journal: ${DUMP.anchor} no longer holds the em-dashes quote verbatim, so it is not drawn`,
    ]);
  });

  it("counts the turns read and the cued ones nobody has read, so a zero is never silent", () => {
    expect([reading.read, reading.unread]).toEqual([1, 1]);
    expect(reading.residue).toEqual(STEER_RESIDUE);
  });

  it("prints days since the last correction, never a verdict on it, and what was not read", () => {
    const lines = steerKindsLines({ reading });
    expect(lines.slice(0, 3)).toEqual([
      "Slack steers since 2026-08-06 · 1 turn(s) read · 1 cued turn(s) not yet read",
      "Em dashes                    1 · last 2026-09-01 · nothing observed for 34 day(s)",
      "Other voice rules            0",
    ]);
    expect(lines).toContain("not read: supervisor: the chain starts at 2026-08-10");
  });

  it("marks the owner's own word that a kind stopped, and names the journal lines that would not read", () => {
    const stopped = steerKindsReading({
      botHandles: OWN,
      gaps: [],
      nowIso: "2026-10-05T12:00:00.000Z",
      sinceIso: "2026-08-06T12:00:00.000Z",
      unparsed: [3, 7],
      utterances: [DUMP, LATER],
      verdicts: [DUMP_DASH, LATER_STOPPED],
    });
    const lines = steerKindsLines({ reading: stopped });
    expect(lines[1]).toBe(
      `Em dashes                    1 · last 2026-09-01 · nothing observed for 34 day(s) · the owner said it stopped ${LATER.atIso.slice(0, 10)}`,
    );
    expect(lines).toContain("journal line(s) that would not read: 3, 7");
  });
});

describe("withoutRelayTwins", () => {
  const stretch: SteerPoint = {
    anchor: "talk-call:c2#t1",
    atIso: "2026-10-04T03:00:00.000Z",
    quote: "a wall of text",
    says: "corrects",
  };
  const relayAt = ({ anchor, atIso }: { anchor: string; atIso: string }): SteerPoint => ({
    anchor,
    atIso,
    quote: "reads like a wall of text",
    says: "corrects",
  });

  it("drops a relay a call stretch says the same way within ten minutes, so one turn is one point", () => {
    const twin = relayAt({ anchor: "talk:r1", atIso: "2026-10-04T03:04:23.000Z" });
    expect(withoutRelayTwins({ points: [twin, stretch] })).toEqual([stretch]);
  });

  it("keeps a relay just past ten minutes from a stretch, and one beside a stretch that says it differently", () => {
    const alone = relayAt({ anchor: "talk:r2", atIso: "2026-10-04T03:10:01.000Z" });
    const stopped: SteerPoint = { ...stretch, anchor: "talk-call:c2#t2", says: "stopped" };
    const unlike = relayAt({ anchor: "talk:r3", atIso: "2026-10-04T05:00:30.000Z" });
    const points = [stretch, alone, { ...stopped, atIso: "2026-10-04T05:00:00.000Z" }, unlike];
    expect(withoutRelayTwins({ points }).map((point) => point.anchor)).toEqual([
      "talk-call:c2#t1",
      "talk:r2",
      "talk-call:c2#t2",
      "talk:r3",
    ]);
  });

  it("never drops a call stretch or a chair turn, whatever lands beside it", () => {
    const chair: SteerPoint = { ...stretch, anchor: "transcript:s#u" };
    expect(withoutRelayTwins({ points: [chair, stretch] })).toEqual([chair, stretch]);
  });
});

describe("quietDays", () => {
  it("counts whole days and never goes below zero", () => {
    expect(quietDays({ nowIso: "2026-10-05T12:00:00.000Z", sinceIso: "2026-10-03T13:00:00.000Z" })).toBe(1);
    expect(quietDays({ nowIso: "2026-10-05T12:00:00.000Z", sinceIso: "2026-10-06T00:00:00.000Z" })).toBe(0);
  });
});

describe("parseProfileSteersArgs", () => {
  it("reads a judgement naming a kind", () => {
    const parsed = parseProfileSteersArgs({
      rest: ["judge", "talk-call:c1#t1", "--kind", "proof", "--says", "corrects", "--quote", "attach it"],
    });
    expect(unwrap(parsed)).toEqual({
      anchor: "talk-call:c1#t1",
      home: undefined,
      judgement: { kind: "proof", mode: "names", quote: "attach it", says: "corrects" },
      mode: "judge",
      now: undefined,
    });
  });

  it("refuses a kind the page does not draw, a half judgement, and a flag another mode owns", () => {
    expect(unwrapErr(parseProfileSteersArgs({ rest: ["judge", "a", "--kind", "fonts"] }))).toEqual({
      code: "UNKNOWN_KIND",
      kind: "fonts",
      message: "--kind fonts is not one of em-dashes, voice, length, stakeholders, proof, place, withheld",
    });
    expect(unwrapErr(parseProfileSteersArgs({ rest: ["judge", "a", "--kind", "proof"] })).code).toBe(
      "JUDGEMENT_INCOMPLETE",
    );
    expect(unwrapErr(parseProfileSteersArgs({ rest: ["unread", "--kind", "proof", "--quote", "x"] }))).toEqual({
      code: "FOREIGN_FLAGS",
      flags: ["kind", "quote"],
      message: "--kind, --quote is not a flag unread takes",
    });
  });

  it("refuses a judgement that says nothing yet names a kind, and a withdrawal naming none", () => {
    expect(unwrapErr(parseProfileSteersArgs({ rest: ["judge", "a", "--nothing", "--kind", "proof"] })).code).toBe(
      "NOTHING_TAKES_NO_KIND",
    );
    expect(unwrapErr(parseProfileSteersArgs({ rest: ["judge", "a", "--withdraw"] })).code).toBe("WITHDRAW_NEEDS_KIND");
    expect(unwrap(parseProfileSteersArgs({ rest: ["judge", "a", "--withdraw", "--kind", "proof"] })).mode).toBe(
      "judge",
    );
  });

  it("refuses an empty quote, a second anchor, an operand to unread, a bad limit and an unknown mode", () => {
    const quoted = ["judge", "a", "--kind", "proof", "--says", "corrects", "--quote", "  "];
    expect(unwrapErr(parseProfileSteersArgs({ rest: quoted })).code).toBe("EMPTY_QUOTE");
    expect(unwrapErr(parseProfileSteersArgs({ rest: ["judge", "a", "b", "--nothing"] })).code).toBe("BAD_OPERANDS");
    expect(unwrapErr(parseProfileSteersArgs({ rest: ["unread", "x"] })).message).toBe("unread takes no operand");
    expect(unwrapErr(parseProfileSteersArgs({ rest: ["unread", "--limit", "501"] }))).toEqual({
      code: "BAD_LIMIT",
      message: "--limit 501 is not a whole number from 1 to 500",
      raw: "501",
    });
    expect(unwrapErr(parseProfileSteersArgs({ rest: ["tally"] })).code).toBe("UNKNOWN_MODE");
  });

  it("reads unread with its limit", () => {
    expect(unwrap(parseProfileSteersArgs({ rest: ["unread", "--limit", "5", "--since", "7d"] }))).toEqual({
      home: undefined,
      json: false,
      limit: 5,
      mode: "unread",
      now: undefined,
      since: "7d",
      until: undefined,
    });
  });

  it("reads the bare reading with its default window", () => {
    expect(unwrap(parseProfileSteersArgs({ rest: ["--json"] }))).toEqual({
      home: undefined,
      json: true,
      mode: "reading",
      now: undefined,
      since: "60d",
      until: undefined,
    });
  });
});
