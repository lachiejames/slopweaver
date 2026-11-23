/**
 * The manifest a freeze writes beside its fixture: identity and counts read off the redacted record set, the rest
 * supplied, and the freeze clock injected so the whole document is assertable.
 */
import { describe, expect, it } from "vitest";

import type { SelectedEvents } from "../../../../../live/turn/freeze/fixture.js";
import { fixtureManifestFor, readStringFieldOfLine } from "../../../../../live/turn/freeze/manifest.js";
import type { FixtureIdMap } from "../../../../../live/turn/freeze/redact.js";

/**
 * Workspace-id-shaped values are assembled from parts so no committed line carries one — the same reason
 * `redact.test.ts` gives. Every one is invented.
 */
const rawId = ({ prefix, body }: { prefix: string; body: string }): string => `${prefix}${body}`;
const A_CHANNEL = rawId({ body: "0QWERTY12", prefix: "C" });
const AN_ASKER = rawId({ body: "0ZXCVBN34", prefix: "U" });
const A_BYSTANDER = rawId({ body: "0ASDFGH56", prefix: "U" });
const MESSAGE_TS = "1789046247.801199";
const HOME = "/tmp/fixture-home";
const FROZEN_AT = "2030-01-02T03:04:05.006Z";

const CAPTURED = JSON.stringify({
  kind: "captured",
  channel: A_CHANNEL,
  messageTs: MESSAGE_TS,
  threadTs: MESSAGE_TS,
  userId: AN_ASKER,
});
const DISPATCHED = JSON.stringify({
  kind: "dispatched",
  channel: A_CHANNEL,
  messageTs: MESSAGE_TS,
  threadTs: MESSAGE_TS,
});

const STANDING_EXCLUSIONS = [
  "reviews/*/packet.md — free prose composed for a human reviewer; no replay assertion reads it",
  "profile.json — the owner's own persona and chrome; a replay needs neither, and an asker-tag duty is " +
    "decided from the ask's own userId",
  "thread-files/* — attachments, deliberately unredacted where they live and never committable",
  "live/slack/detectives/*/*/*.md — detective briefs and reports, prose quoting what each detective read; " +
    "the wave's wave.json is carried instead",
];

/** The frozen files: a standing and an archived verdict, and two near-misses neither of which is a round. */
const FILES = [
  { contents: "", relativePath: "live/slack/asks.jsonl" },
  { contents: "{}", relativePath: "live/slack/reviews/CFIXTUREAA-1/verdict.json" },
  {
    contents: "{}",
    relativePath: "live/slack/reviews/CFIXTUREAA-1/verdict-superseded-ws-1-2026-09-10T13-34-39-172Z.json",
  },
  { contents: "{}", relativePath: "live/slack/reviews/CFIXTUREAA-1/verdict-superseded-no-instant.json" },
  { contents: "{}", relativePath: "live/slack/turns/verdict.json" },
];

describe("readStringFieldOfLine", () => {
  it("reads one string field of a JSON line", () => {
    expect(readStringFieldOfLine({ field: "kind", line: DISPATCHED })).toBe("dispatched");
  });

  it("answers undefined for a malformed line, a non-object line, a non-string field and an absent field", () => {
    expect(readStringFieldOfLine({ field: "kind", line: "{torn" })).toBeUndefined();
    expect(readStringFieldOfLine({ field: "kind", line: JSON.stringify(["dispatched"]) })).toBeUndefined();
    expect(readStringFieldOfLine({ field: "kind", line: JSON.stringify({ kind: 3 }) })).toBeUndefined();
    expect(readStringFieldOfLine({ field: "userId", line: DISPATCHED })).toBeUndefined();
  });
});

describe("fixtureManifestFor", () => {
  it("describes the redacted fixture with synthetic identity, the review-round count and the injected clock", () => {
    const ids: FixtureIdMap = new Map();
    const selected: SelectedEvents = { kept: [CAPTURED, DISPATCHED], withheldKinds: ["answered", "settled"] };
    const manifest = fixtureManifestFor({
      denylist: ["acme"],
      files: FILES,
      home: HOME,
      ids,
      incident: `the acme ask in ${A_CHANNEL} lost its lease while ${A_BYSTANDER} watched`,
      lastKept: DISPATCHED,
      nowIso: () => FROZEN_AT,
      regresses: ["lease-lost"],
      replayNowIso: "2026-09-10T13:34:39.172Z",
      selected,
      skipped: [`${HOME}/live/slack/thread-files/${A_CHANNEL}-${MESSAGE_TS} — attachments are never frozen`],
      slug: "lost-lease",
      through: "dispatched",
    });
    expect(manifest).toStrictEqual({
      ask: { askedBy: "UFIXTUREAB", channel: "CFIXTUREAA", messageTs: MESSAGE_TS, threadTs: MESSAGE_TS },
      excluded: [
        ...STANDING_EXCLUSIONS,
        `\${SLOPWEAVER_HOME}/live/slack/thread-files/CFIXTUREAA-${MESSAGE_TS} — attachments are never frozen`,
      ],
      files: FILES.map((file) => `home/${file.relativePath}`),
      frozenAtIso: FROZEN_AT,
      incident: "the [redacted-word] ask in CFIXTUREAA lost its lease while UFIXTUREAC watched",
      regresses: ["lease-lost"],
      replayNowIso: "2026-09-10T13:34:39.172Z",
      reviewRounds: 2,
      schemaVersion: 1,
      slug: "lost-lease",
      syntheticIdCount: 3,
      through: "dispatched",
      withheldEventKinds: ["answered", "settled"],
    });
  });

  it("samples the clock once, after the ask identity is redacted and before the incident note is", () => {
    const ids: FixtureIdMap = new Map();
    const idCountsWhenSampled: number[] = [];
    fixtureManifestFor({
      denylist: [],
      files: [],
      home: HOME,
      ids,
      incident: `seen by ${A_BYSTANDER}`,
      lastKept: DISPATCHED,
      nowIso: () => {
        idCountsWhenSampled.push(ids.size);
        return FROZEN_AT;
      },
      regresses: [],
      replayNowIso: FROZEN_AT,
      selected: { kept: [CAPTURED, DISPATCHED], withheldKinds: [] },
      skipped: [],
      slug: "s",
      through: undefined,
    });
    expect(idCountsWhenSampled).toEqual([2]);
    expect(ids.size).toBe(3);
  });

  it("states `(absent)` for an asker never captured, and carries no `through` key when none was given", () => {
    const manifest = fixtureManifestFor({
      denylist: [],
      files: [],
      home: HOME,
      ids: new Map(),
      incident: "cut before capture",
      lastKept: DISPATCHED,
      nowIso: () => FROZEN_AT,
      regresses: [],
      replayNowIso: FROZEN_AT,
      selected: { kept: [DISPATCHED], withheldKinds: [] },
      skipped: [],
      slug: "no-capture",
      through: undefined,
    });
    expect(manifest.ask).toEqual({
      askedBy: "(absent)",
      channel: "CFIXTUREAA",
      messageTs: MESSAGE_TS,
      threadTs: MESSAGE_TS,
    });
    expect(Object.keys(manifest).toSorted()).toEqual([
      "ask",
      "excluded",
      "files",
      "frozenAtIso",
      "incident",
      "regresses",
      "replayNowIso",
      "reviewRounds",
      "schemaVersion",
      "slug",
      "syntheticIdCount",
      "withheldEventKinds",
    ]);
    expect(manifest.reviewRounds).toBe(0);
  });

  it("states `(absent)` for every identity field when the last kept line will not parse", () => {
    const manifest = fixtureManifestFor({
      denylist: [],
      files: [],
      home: HOME,
      ids: new Map(),
      incident: "torn log",
      lastKept: "{torn",
      nowIso: () => FROZEN_AT,
      regresses: [],
      replayNowIso: FROZEN_AT,
      selected: { kept: ["{torn"], withheldKinds: [] },
      skipped: [],
      slug: "torn",
      through: undefined,
    });
    expect(manifest.ask).toEqual({
      askedBy: "(absent)",
      channel: "(absent)",
      messageTs: "(absent)",
      threadTs: "(absent)",
    });
  });
});
