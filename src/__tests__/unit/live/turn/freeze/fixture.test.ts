/**
 * The fixture manifest, the event selection `--through` performs, and the home substitution that makes a
 * committed fixture relocatable.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import {
  FIXTURE_SCHEMA_VERSION,
  kindOf,
  parseFixtureManifest,
  recordsAWithheldKind,
  selectAskEvents,
  selectCompletionLines,
  substituteHome,
} from "../../../../../live/turn/freeze/fixture.js";
import { HOME_PLACEHOLDER } from "../../../../../live/turn/freeze/redact.js";

/** One ask's log, plus a second ask's row interleaved the way the real append-only log interleaves them. */
const LOG = [
  '{"channel":"C1","messageTs":"1.1","kind":"captured","userId":"U1","tsIso":"2026-08-28T01:00:00.000Z"}',
  '{"channel":"C2","messageTs":"2.2","kind":"captured","userId":"U9","tsIso":"2026-08-28T01:00:05.000Z"}',
  '{"channel":"C1","messageTs":"1.1","kind":"dispatched","tsIso":"2026-08-28T01:01:00.000Z"}',
  '{"channel":"C1","messageTs":"1.1","kind":"dispatch-failed","tsIso":"2026-08-28T01:02:00.000Z"}',
  '{"channel":"C1","messageTs":"1.1","kind":"failed","tsIso":"2026-08-28T01:03:00.000Z"}',
].join("\n");

const MANIFEST = {
  ask: { askedBy: "UFIXTUREAB", channel: "CFIXTUREAA", messageTs: "1.1", threadTs: "1.1" },
  excluded: ["packet.md — prose"],
  files: ["home/live/slack/asks.jsonl"],
  frozenAtIso: "2026-08-28T09:00:00.000Z",
  incident: "the sweep abandoned a live worker",
  regresses: ["stalled-session-still-reported-as-in-flight"],
  replayNowIso: "2026-08-28T01:01:00.000Z",
  reviewRounds: 5,
  schemaVersion: FIXTURE_SCHEMA_VERSION,
  slug: "an-incident",
  syntheticIdCount: 4,
  through: "dispatched",
  withheldEventKinds: ["dispatch-failed", "failed"],
};

describe("selectAskEvents", () => {
  it("keeps only the named ask's own rows", () => {
    expect(selectAskEvents({ channel: "C1", messageTs: "1.1", text: LOG, through: undefined }).kept).toHaveLength(4);
  });

  it("keeps every row when no kind is named", () => {
    expect(selectAskEvents({ channel: "C1", messageTs: "1.1", text: LOG, through: undefined }).withheldKinds).toEqual(
      [],
    );
  });

  it("truncates after the last event of the named kind", () => {
    const selected = selectAskEvents({ channel: "C1", messageTs: "1.1", text: LOG, through: "dispatched" });
    expect(selected.kept.map((line) => kindOf({ line }))).toEqual(["captured", "dispatched"]);
  });

  it("names the kinds it withheld, in log order", () => {
    expect(
      selectAskEvents({ channel: "C1", messageTs: "1.1", text: LOG, through: "dispatched" }).withheldKinds,
    ).toEqual(["dispatch-failed", "failed"]);
  });

  it("withholds nothing when the named kind never occurred", () => {
    const selected = selectAskEvents({ channel: "C1", messageTs: "1.1", text: LOG, through: "answered" });
    expect(selected.kept).toHaveLength(4);
    expect(selected.withheldKinds).toEqual([]);
  });

  it("answers empty for an ask the log does not hold", () => {
    expect(selectAskEvents({ channel: "C3", messageTs: "9.9", text: LOG, through: undefined }).kept).toEqual([]);
  });

  it("skips a malformed line rather than aborting", () => {
    const selected = selectAskEvents({
      channel: "C1",
      messageTs: "1.1",
      text: `not json\n${LOG}`,
      through: undefined,
    });
    expect(selected.kept).toHaveLength(4);
  });
});

describe("kindOf", () => {
  it("reads the kind off a well-formed line", () => {
    expect(kindOf({ line: '{"kind":"dispatched"}' })).toBe("dispatched");
  });

  it("answers undefined for a line that declares none", () => {
    expect(kindOf({ line: '{"channel":"C1"}' })).toBeUndefined();
  });

  it("answers undefined for a line that will not parse", () => {
    expect(kindOf({ line: "{" })).toBeUndefined();
  });
});

describe("substituteHome", () => {
  it("resolves every placeholder to the throwaway home", () => {
    expect(substituteHome({ home: "/tmp/h", text: `${HOME_PLACEHOLDER}/a ${HOME_PLACEHOLDER}/b` })).toBe(
      "/tmp/h/a /tmp/h/b",
    );
  });

  it("leaves text with no placeholder untouched", () => {
    expect(substituteHome({ home: "/tmp/h", text: "nothing to do" })).toBe("nothing to do");
  });
});

describe("parseFixtureManifest", () => {
  it("accepts a complete manifest", () => {
    expect(unwrap(parseFixtureManifest({ value: MANIFEST })).slug).toBe("an-incident");
  });

  it("accepts a manifest with no --through, since the whole log was kept", () => {
    const { through, ...rest } = MANIFEST;
    expect(unwrap(parseFixtureManifest({ value: { ...rest, withheldEventKinds: [] } })).through).toBeUndefined();
    expect(through).toBe("dispatched");
  });

  it("refuses an unknown schema version rather than reading it as this one", () => {
    expect(unwrapErr(parseFixtureManifest({ value: { ...MANIFEST, schemaVersion: 99 } })).join(" ")).toContain(
      "Invalid input",
    );
  });

  it("refuses a field nobody declared", () => {
    expect(unwrapErr(parseFixtureManifest({ value: { ...MANIFEST, realChannel: "x" } })).join(" ")).toContain(
      "Unrecognized key",
    );
  });

  it("carries the register classes the fixture regresses", () => {
    expect(unwrap(parseFixtureManifest({ value: MANIFEST })).regresses).toEqual([
      "stalled-session-still-reported-as-in-flight",
    ]);
  });

  it("accepts an empty regresses list, since most frozen turns are not an instance of a named class", () => {
    expect(unwrap(parseFixtureManifest({ value: { ...MANIFEST, regresses: [] } })).regresses).toEqual([]);
  });

  it("refuses a manifest that declares no regresses at all, so the field cannot be quietly skipped", () => {
    const { regresses, ...rest } = MANIFEST;
    expect(unwrapErr(parseFixtureManifest({ value: rest }))).toHaveLength(1);
    expect(regresses).toEqual(["stalled-session-still-reported-as-in-flight"]);
  });

  it("refuses a manifest missing the asker", () => {
    const { askedBy, ...ask } = MANIFEST.ask;
    expect(unwrapErr(parseFixtureManifest({ value: { ...MANIFEST, ask } }))).toHaveLength(1);
    expect(askedBy).toBe("UFIXTUREAB");
  });
});

describe("recordsAWithheldKind", () => {
  it("is false when the file declares no kind at all", () => {
    expect(recordsAWithheldKind({ markerKind: undefined, withheldKinds: ["failed"] })).toBe(false);
  });

  it("is false when nothing was withheld — the whole log was kept", () => {
    expect(recordsAWithheldKind({ markerKind: "failed", withheldKinds: [] })).toBe(false);
  });

  it("is TRUE for the turn marker the freeze carried past its own --through", () => {
    // `--through dispatched` withheld the `failed` lifecycle event and then copied a turn-marker file
    // reading `"kind": "failed"` — the fixture claimed to be the state before the defect while carrying
    // what the defect wrote.
    expect(recordsAWithheldKind({ markerKind: "failed", withheldKinds: ["failed", "answered"] })).toBe(true);
  });

  it("is false for a kind that survived the truncation", () => {
    expect(recordsAWithheldKind({ markerKind: "ready", withheldKinds: ["failed", "answered"] })).toBe(false);
  });
});

describe("selectAskEvents — the --not-after cut", () => {
  it("drops every row stamped after the instant, and names the kinds it withheld", () => {
    const selected = selectAskEvents({
      channel: "C1",
      messageTs: "1.1",
      notAfter: "2026-08-28T01:01:30.000Z",
      text: LOG,
      through: undefined,
    });

    expect(selected.kept.map((line) => kindOf({ line }))).toEqual(["captured", "dispatched"]);
    expect(selected.withheldKinds).toEqual(["dispatch-failed", "failed"]);
  });

  it("composes with --through, reporting both halves of what it withheld", () => {
    const selected = selectAskEvents({
      channel: "C1",
      messageTs: "1.1",
      notAfter: "2026-08-28T01:01:30.000Z",
      text: LOG,
      through: "dispatch-failed",
    });

    expect(selected.kept.map((line) => kindOf({ line }))).toEqual(["captured", "dispatched"]);
    expect(selected.withheldKinds.toSorted()).toEqual(["dispatch-failed", "failed"]);
  });

  it("keeps every row when the instant is not readable as one, rather than emptying the fixture", () => {
    const selected = selectAskEvents({
      channel: "C1",
      messageTs: "1.1",
      notAfter: "not an instant",
      text: LOG,
      through: undefined,
    });

    expect(selected.kept).toHaveLength(4);
    expect(selected.withheldKinds).toEqual([]);
  });

  it("keeps a row that declares no tsIso at all", () => {
    const selected = selectAskEvents({
      channel: "C1",
      messageTs: "1.1",
      notAfter: "2026-08-28T01:00:30.000Z",
      text: [LOG, '{"channel":"C1","messageTs":"1.1","kind":"undated"}'].join("\n"),
      through: undefined,
    });

    expect(selected.kept.map((line) => kindOf({ line }))).toEqual(["captured", "undated"]);
  });
});

describe("selectCompletionLines", () => {
  /** One completion ledger line for an ask, stamped at an instant. */
  function line({ channel, messageTs, tsIso }: { channel: string; messageTs: string; tsIso: string }): string {
    return JSON.stringify({
      completion: { askIdentity: { channel, messageTs, threadTs: "1.0" }, workingTs: "2.0" },
      kind: "turn-completed",
      schemaVersion: 1,
      tsIso,
    });
  }

  const MINE_EARLY = line({ channel: "C1", messageTs: "10.1", tsIso: "2026-09-07T08:56:23.277Z" });
  const MINE_LATE = line({ channel: "C1", messageTs: "10.1", tsIso: "2026-09-07T09:22:31.434Z" });
  const OTHER_ASK = line({ channel: "C1", messageTs: "99.9", tsIso: "2026-09-07T08:00:00.000Z" });

  it("keeps only this ask's lines at or before the window, in ledger order", () => {
    const text = [OTHER_ASK, MINE_EARLY, "not json", "", MINE_LATE].join("\n");

    expect(
      selectCompletionLines({ channel: "C1", messageTs: "10.1", notAfterIso: "2026-09-07T08:56:23.278Z", text }),
    ).toEqual([MINE_EARLY]);
  });

  it("keeps every line of the ask when the window instant does not parse", () => {
    const text = [MINE_EARLY, MINE_LATE].join("\n");

    expect(selectCompletionLines({ channel: "C1", messageTs: "10.1", notAfterIso: "not an instant", text })).toEqual([
      MINE_EARLY,
      MINE_LATE,
    ]);
  });

  it("keeps nothing from an empty ledger", () => {
    expect(
      selectCompletionLines({ channel: "C1", messageTs: "10.1", notAfterIso: "2026-09-07T08:56:23.278Z", text: "" }),
    ).toEqual([]);
  });

  /** An answered turn of ANOTHER ask in the same thread, carrying fields a projection must not forward. */
  function predecessor({
    answerTs,
    channel,
    messageTs,
    threadTs,
  }: {
    answerTs: string;
    channel: string;
    messageTs: string;
    threadTs: string;
  }): string {
    return JSON.stringify({
      completion: {
        askIdentity: { channel, messageTs, threadTs },
        primary: { answerTs, kind: "answered" },
        provenance: { modelId: "opus", sessionId: "example-password-not-a-real-secret" },
        secondaryFailures: [{ kind: "reap", reason: "example-password-not-a-real-secret" }],
        turnId: "turn-earlier",
        workingTs: "3.0",
      },
      kind: "turn-completed",
      schemaVersion: 1,
      tsIso: "2026-09-07T08:30:00.000Z",
    });
  }

  const PREDECESSOR = predecessor({ answerTs: "8.8", channel: "C1", messageTs: "9.9", threadTs: "1.0" });

  it("keeps a same-thread answered predecessor, rebuilt from named fields only", () => {
    const kept = selectCompletionLines({
      channel: "C1",
      messageTs: "10.1",
      notAfterIso: "2026-09-07T08:56:23.278Z",
      text: [PREDECESSOR, MINE_EARLY].join("\n"),
      threadTs: "1.0",
    });

    expect(kept).toEqual([
      JSON.stringify({
        completion: {
          askIdentity: { channel: "C1", messageTs: "9.9", threadTs: "1.0" },
          primary: { answerTs: "8.8", kind: "answered" },
          provenance: { modelId: "projected-predecessor" },
          secondaryFailures: [],
          turnId: "turn-earlier",
          workingTs: "3.0",
        },
        kind: "turn-completed",
        schemaVersion: 1,
        tsIso: "2026-09-07T08:30:00.000Z",
      }),
      MINE_EARLY,
    ]);
  });

  it("carries nothing a predecessor's unprojected fields held", () => {
    const kept = selectCompletionLines({
      channel: "C1",
      messageTs: "10.1",
      notAfterIso: "2026-09-07T08:56:23.278Z",
      text: PREDECESSOR,
      threadTs: "1.0",
    });

    // Falsifiable on both halves: the INPUT carries the string, so a projection that copied bytes reddens.
    expect(PREDECESSOR).toContain("example-password-not-a-real-secret");
    expect(kept.join("\n")).not.toContain("example-password-not-a-real-secret");
  });

  it("keeps no predecessor when no thread is given", () => {
    expect(
      selectCompletionLines({
        channel: "C1",
        messageTs: "10.1",
        notAfterIso: "2026-09-07T08:56:23.278Z",
        text: PREDECESSOR,
      }),
    ).toEqual([]);
  });

  it("keeps no predecessor from another thread or another channel", () => {
    const elsewhere = [
      predecessor({ answerTs: "8.8", channel: "C1", messageTs: "9.9", threadTs: "77.7" }),
      predecessor({ answerTs: "8.8", channel: "C2", messageTs: "9.9", threadTs: "1.0" }),
    ].join("\n");

    expect(
      selectCompletionLines({
        channel: "C1",
        messageTs: "10.1",
        notAfterIso: "2026-09-07T08:56:23.278Z",
        text: elsewhere,
        threadTs: "1.0",
      }),
    ).toEqual([]);
  });

  it("keeps no predecessor that never answered — there is nothing a correction could supersede", () => {
    const withheld = JSON.stringify({
      completion: {
        askIdentity: { channel: "C1", messageTs: "9.9", threadTs: "1.0" },
        primary: { kind: "withheld", noticeTs: "8.8" },
        turnId: "turn-earlier",
        workingTs: "3.0",
      },
      kind: "turn-completed",
      schemaVersion: 1,
      tsIso: "2026-09-07T08:30:00.000Z",
    });

    expect(
      selectCompletionLines({
        channel: "C1",
        messageTs: "10.1",
        notAfterIso: "2026-09-07T08:56:23.278Z",
        text: withheld,
        threadTs: "1.0",
      }),
    ).toEqual([]);
  });

  it("cuts a predecessor at the window exactly as it cuts the ask's own lines", () => {
    expect(
      selectCompletionLines({
        channel: "C1",
        messageTs: "10.1",
        notAfterIso: "2026-09-07T08:29:59.999Z",
        text: PREDECESSOR,
        threadTs: "1.0",
      }),
    ).toEqual([]);
  });
});
