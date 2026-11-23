import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { callOpenings, ownTranscriptCallIds } from "../../../../../cli/commands/desktop/e2eCallEvidenceRead.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { appendCallEntries, callsDir } from "../../../../../talk/callStore.js";

const OPENED = "6c1d9e2f-3a4b-4c5d-8e6f-7a8b9c0d1e01";
const TORN = "6c1d9e2f-3a4b-4c5d-8e6f-7a8b9c0d1e02";
const SILENT = "6c1d9e2f-3a4b-4c5d-8e6f-7a8b9c0d1e03";
const AT = "2026-11-04T12:52:49.000Z";

const segment = ({ id, who, text }: { id: string; who: "owner" | "voice"; text: string }) => ({
  atIso: AT,
  final: true,
  id,
  kind: "segment" as const,
  text,
  who,
});

describe("ownTranscriptCallIds", () => {
  it("adds a transcript the store gained unseen to the tracked ones, once each, never one from before", () => {
    expect(
      ownTranscriptCallIds({
        before: new Set(["owner-earlier"]),
        now: ["owner-earlier", "tracked", "recovered"],
        seen: [],
        tracked: ["tracked"],
      }),
    ).toEqual(["tracked", "recovered"]);
  });

  it("keeps a transcript an earlier read saw whose file is gone by the final read (Codex r11-seams)", () => {
    expect(
      ownTranscriptCallIds({
        before: new Set(["owner-earlier"]),
        now: ["owner-earlier", "tracked"],
        seen: ["recovered", "tracked"],
        tracked: ["tracked"],
      }),
    ).toEqual(["tracked", "recovered"]);
  });
});

describe("callOpenings", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-call-openings-"));
    unwrap(
      appendCallEntries({
        callId: OPENED,
        entries: [
          segment({ id: "a", text: "Hello.", who: "owner" }),
          segment({ id: "b", text: " Hi! I'm ChatGPT.", who: "voice" }),
        ],
        home,
      }),
    );
    unwrap(appendCallEntries({ callId: SILENT, entries: [segment({ id: "a", text: "Hello.", who: "owner" })], home }));
    unwrap(appendCallEntries({ callId: TORN, entries: [segment({ id: "b", text: " Hey.", who: "voice" })], home }));
    appendFileSync(join(callsDir({ home }), `${TORN}.jsonl`), '{"kind":"segment","text":"I\'m Chat\n');
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("judges each handed call's first final voice segment, and names one the voice never finished", () => {
    expect(unwrap(callOpenings({ callIds: [OPENED, SILENT], home }))).toEqual([
      {
        callId: OPENED,
        faults: [
          { kind: "product-name", words: "ChatGPT" },
          { kind: "self-introduction", words: "I'm ChatGPT" },
        ],
        text: "Hi! I'm ChatGPT.",
      },
      { callId: SILENT, faults: [], text: undefined },
    ]);
  });

  it("refuses a call this run wrote whose file is gone, never reading it as a call with nothing said (Codex)", () => {
    const gone = "6c1d9e2f-3a4b-4c5d-8e6f-7a8b9c0d1e04";
    const refused = unwrapErr(callOpenings({ callIds: [OPENED, gone], home }));
    expect([refused.code, refused.message]).toEqual([
      "EVIDENCE_UNREADABLE",
      `could not read the call evidence at call ${gone}: its call file holds no lines, though this run wrote to it`,
    ]);
  });

  it("refuses a call with a line that did not parse, never judging the lines around it clean (Codex)", () => {
    const refused = unwrapErr(callOpenings({ callIds: [TORN], home }));
    expect([refused.code, refused.message]).toEqual([
      "EVIDENCE_UNREADABLE",
      `could not read the call evidence at call ${TORN}: 1 line(s) did not parse, and the voice's opening may be one of them`,
    ]);
  });
});
