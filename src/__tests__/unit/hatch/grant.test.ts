import { describe, expect, it } from "vitest";
import {
  buildHatchGrant,
  HATCH_GRANT_WINDOW_MS,
  liveHatchGrant,
  parseHatchGrantJournal,
  parseHatchGrantLine,
} from "../../../hatch/grant.js";

const ISSUED = "2026-09-10T04:00:00.000Z";
const GRANT = buildHatchGrant({
  claudeSessionId: "session-a",
  hatchId: "wall",
  issuedAtIso: ISSUED,
  reason: "the owner asked for exactly this sequence",
});

describe("a journalled hatch grant", () => {
  it("expires 30 minutes after it is issued", () => {
    expect(GRANT.expiresAtIso).toBe("2026-09-10T04:30:00.000Z");
    expect(HATCH_GRANT_WINDOW_MS).toBe(1_800_000);
  });

  it("keeps the reason, which is what it buys over an ambient variable", () => {
    expect(GRANT.reason).toBe("the owner asked for exactly this sequence");
  });

  it("is open inside its window", () => {
    const live = liveHatchGrant({
      claudeSessionId: "session-a",
      grants: [GRANT],
      hatchId: "wall",
      nowIso: "2026-09-10T04:29:59.000Z",
    });
    expect(live!.hatchId).toBe("wall");
  });

  it("is closed one second past it", () => {
    expect(
      liveHatchGrant({
        claudeSessionId: "session-a",
        grants: [GRANT],
        hatchId: "wall",
        nowIso: "2026-09-10T04:30:01.000Z",
      }),
    ).toBeUndefined();
  });

  it("is closed before it was issued, so a grant dated ahead of the clock opens nothing yet", () => {
    const at = ({ nowIso }: { nowIso: string }) =>
      liveHatchGrant({ claudeSessionId: "session-a", grants: [GRANT], hatchId: "wall", nowIso });
    expect(at({ nowIso: "2026-09-10T03:59:59.000Z" })).toBeUndefined();
    expect(at({ nowIso: ISSUED })!.hatchId).toBe("wall");
  });

  it("is never transferable to another session", () => {
    expect(
      liveHatchGrant({ claudeSessionId: "session-b", grants: [GRANT], hatchId: "wall", nowIso: ISSUED }),
    ).toBeUndefined();
  });

  it("opens exactly one hatch, never a blanket", () => {
    expect(
      liveHatchGrant({ claudeSessionId: "session-a", grants: [GRANT], hatchId: "voice-rules", nowIso: ISSUED }),
    ).toBeUndefined();
  });

  it("takes the LAST matching grant, so re-taking one extends the window", () => {
    const later = buildHatchGrant({
      claudeSessionId: "session-a",
      hatchId: "wall",
      issuedAtIso: "2026-09-10T04:20:00.000Z",
      reason: "still the same drip",
    });
    const live = liveHatchGrant({
      claudeSessionId: "session-a",
      grants: [GRANT, later],
      hatchId: "wall",
      nowIso: "2026-09-10T04:40:00.000Z",
    });
    expect(live!.reason).toBe("still the same drip");
  });

  it("closes rather than throwing on an unparseable instant", () => {
    expect(
      liveHatchGrant({ claudeSessionId: "session-a", grants: [GRANT], hatchId: "wall", nowIso: "not a date" }),
    ).toBeUndefined();
  });

  it("round-trips through the journal", () => {
    expect(parseHatchGrantJournal({ text: `${JSON.stringify(GRANT)}\n` })).toEqual([GRANT]);
  });

  it("drops a blank, a malformed and an incomplete line rather than failing the read", () => {
    const text = ["", "not json", '{"hatchId":"wall"}', JSON.stringify(GRANT)].join("\n");
    expect(parseHatchGrantJournal({ text })).toEqual([GRANT]);
  });

  it("reads nothing out of a line missing its session", () => {
    const { claudeSessionId, ...rest } = GRANT;
    expect(parseHatchGrantLine({ line: JSON.stringify(rest) })).toBeUndefined();
    expect(claudeSessionId).toBe("session-a");
  });
});
