import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CorpusRecord } from "../../../../corpus/types.js";
import { unwrap } from "../../../../lib/result.js";
import { currentVersions, scanCorpusMentions } from "../../../../review/slackEvidenceScan.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { IDENTITY, LINKING, slackRecord } from "./harness.js";

describe("currentVersions", () => {
  it("lets an edited copy that removed the link speak for the message, whatever order the copies were read in", () => {
    const original = slackRecord({ sourceId: "C1:1.0", text: LINKING });
    const redacted = slackRecord({ edited: true, sourceId: "C1:1.0", text: "This message has been redacted" });
    const forward = currentVersions({ records: [original, redacted] });
    const backward = currentVersions({ records: [redacted, original] });
    expect(forward.current.map((record) => record.text)).toEqual(["This message has been redacted"]);
    expect(backward.current.map((record) => record.text)).toEqual(["This message has been redacted"]);
    expect([...forward.disagreeing]).toEqual([]);
  });

  it("reports two edited copies that disagree as unordered, because hygiene erased the edit time", () => {
    const a = slackRecord({ edited: true, sourceId: "C1:1.0", text: LINKING });
    const b = slackRecord({ edited: true, sourceId: "C1:1.0", text: "never mind" });
    expect([...currentVersions({ records: [a, b] }).disagreeing]).toEqual(["C1:1.0"]);
  });

  it("keeps every disagreeing copy, so one read last that dropped the link cannot erase the mention", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-versions-"));
    try {
      const dir = join(stateHomePaths({ home }).corpus.bronze, "slack");
      mkdirSync(dir, { recursive: true });
      const linking = slackRecord({ sourceId: "C1:1.0", text: LINKING });
      const later = slackRecord({ sourceId: "C1:1.0", text: "sorry, wrong channel" });
      writeFileSync(join(dir, "a.jsonl"), `${JSON.stringify(linking)}\n`);
      writeFileSync(join(dir, "b.jsonl"), `${JSON.stringify(later)}\n`);
      const scanned = scanCorpusMentions({
        home,
        identity: IDENTITY,
        refs: [{ number: 1, owner: "o", repo: "r" }],
      });
      expect(unwrap(scanned).map((m) => [m.prKey, m.versionsDisagree])).toEqual([["o/r#1", true]]);
    } finally {
      rmSync(home, { force: true, recursive: true });
    }
  });

  it("treats identical copies and a reply's own spelling of the same message as one agreeing message", () => {
    const top = slackRecord({ sourceId: "C1:2.0", text: LINKING });
    const again = slackRecord({ sourceId: "C1:2.0", text: LINKING });
    const reply = slackRecord({ kind: "comment", sourceId: "C1:1.0:reply:2.0", text: LINKING });
    const resolved = currentVersions({ records: [top, again, reply] });
    expect(resolved.current.length).toBe(1);
    expect([...resolved.disagreeing]).toEqual([]);
  });

  it("versions a legacy message copy with no raw payload too, so it cannot certify beside a copy that disagrees", () => {
    const legacy: CorpusRecord = {
      container: "slack/C1",
      kind: "message",
      refs: [],
      source: "slack",
      sourceId: "C1:4.0",
      text: LINKING,
      tsIso: "2026-09-01T00:00:00.000Z",
      url: "https://x.slack.com/archives/C1/p1",
    };
    const later = slackRecord({ sourceId: "C1:4.0", text: "sorry, wrong channel" });
    expect([...currentVersions({ records: [legacy, later] }).disagreeing]).toEqual(["C1:4.0"]);
  });

  it("keeps a pin that is its message's only copy", () => {
    const pin: CorpusRecord = {
      container: "slack/C1",
      kind: "pin",
      refs: [],
      source: "slack",
      sourceId: "C1:pin:3.0",
      text: LINKING,
      tsIso: "2026-09-01T00:00:00.000Z",
      url: "https://x.slack.com/archives/C1/p1",
    };
    expect(currentVersions({ records: [pin] }).current).toEqual([pin]);
  });

  it("lets an edited message beat a stale pin, so the pin cannot speak for words the edit removed", () => {
    const pin: CorpusRecord = {
      author: "Ada Owner",
      container: "slack/C1",
      kind: "pin",
      refs: [],
      source: "slack",
      sourceId: "C1:pin:5.0",
      text: LINKING,
      tsIso: "2026-09-01T00:00:00.000Z",
      url: "https://x.slack.com/archives/C1/p5",
    };
    const edited = slackRecord({ edited: true, sourceId: "C1:5.0", text: "sorry, wrong channel" });
    const resolved = currentVersions({ records: [pin, edited] });
    expect(resolved.current).toEqual([edited]);
    expect([...resolved.disagreeing]).toEqual([]);
  });

  it("lets an edited pin's words beat the crawl's stale copy, under the message's own identity", () => {
    const stale = slackRecord({ sourceId: "C1:6.0", text: LINKING });
    const editedPin: CorpusRecord = {
      ...slackRecord({ edited: true, sourceId: "C1:pin:6.0", text: "sorry, wrong channel" }),
      kind: "pin",
    };
    expect(currentVersions({ records: [stale, editedPin] }).current).toEqual([
      { ...stale, raw: editedPin.raw, text: "sorry, wrong channel" },
    ]);
    const unlinked = slackRecord({ sourceId: "C1:7.0", text: "sorry, wrong channel" });
    const linkingPin: CorpusRecord = {
      ...slackRecord({ edited: true, sourceId: "C1:pin:7.0", text: LINKING }),
      kind: "pin",
    };
    expect(currentVersions({ records: [linkingPin, unlinked] }).current).toEqual([
      { ...unlinked, raw: linkingPin.raw, text: LINKING },
    ]);
  });

  it("lets the message copy speak when a pin agrees with it, since only the message names its author as an id", () => {
    const message = slackRecord({ sourceId: "C1:8.0", text: LINKING });
    const pin: CorpusRecord = {
      ...slackRecord({ sourceId: "C1:pin:8.0", text: LINKING }),
      author: "Ada Owner",
      kind: "pin",
    };
    expect(currentVersions({ records: [message, pin] }).current).toEqual([message]);
  });
});
