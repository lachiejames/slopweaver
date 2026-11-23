/**
 * Each part's decoder judges its lines with its own domain's schema and refuses the whole part on a bad one.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { importedSteerEventId } from "../../../../profile/steerMeasurementRecords.js";
import { partDecoder } from "../../../../store/transfer/decode.js";
import { STORE_EXPORT_PARTS, type StoreExportPartKind } from "../../../../store/transfer/parts.js";

import {
  DIRECTIVES,
  MEMORY_LINE,
  OWNER,
  RECALL_LINE,
  STANDING_ASK_LINES,
  STEER_LINE,
  STEER_RECORDED_ENVELOPE_LINE,
  steerEnvelopeLine,
  VOICE_LINE,
} from "./fixtures.js";

/** Feed lines to a fresh decoder, stopping at the first refusal, then finish it; the part's own version by default. */
function decode({
  kind,
  lines,
  schemaVersion = STORE_EXPORT_PARTS.find((spec) => spec.kind === kind)!.exportSchemaVersion,
}: {
  kind: StoreExportPartKind;
  lines: readonly string[];
  schemaVersion?: number | null;
}): ReturnType<ReturnType<typeof partDecoder>["finish"]> {
  const decoder = partDecoder({ kind, schemaVersion });
  for (const [at, text] of lines.entries()) {
    const fed = decoder.line({ number: at + 1, text });
    if (fed.isErr()) {
      return fed.map(() => ({ retained: [], rows: 0 }));
    }
  }
  return decoder.finish();
}

describe("partDecoder", () => {
  it("counts every non-blank line of a per-line part, ignoring the trailing empty line", () => {
    expect(unwrap(decode({ kind: "memories", lines: [MEMORY_LINE, MEMORY_LINE, ""] })).rows).toBe(2);
    expect(unwrap(decode({ kind: "memory-recalls", lines: [RECALL_LINE, ""] })).rows).toBe(1);
    expect(unwrap(decode({ kind: "owner-voice", lines: [VOICE_LINE, ""] })).rows).toBe(1);
  });

  it("refuses a memory line the restore decoder refuses, naming the part", () => {
    const refused = unwrapErr(decode({ kind: "memories", lines: [MEMORY_LINE, '{"claim":"half a row"}'] }));
    expect(refused.code).toBe("PART_UNDECODABLE");
    expect(refused.message).toContain("memories does not decode");
  });

  it("refuses a voice line that is not JSON, naming the line", () => {
    expect(unwrapErr(decode({ kind: "owner-voice", lines: [VOICE_LINE, "{"] })).message).toContain(
      "line 2 is not JSON",
    );
  });

  it("reads an owner profile of null as no row, and a portable owner as one", () => {
    expect(unwrap(decode({ kind: "owner-profile", lines: ["null", ""] })).rows).toBe(0);
    expect(unwrap(decode({ kind: "owner-profile", lines: [JSON.stringify(OWNER), ""] })).rows).toBe(1);
    const unnamed = JSON.stringify({ ...OWNER, displayName: "" });
    expect(unwrap(decode({ kind: "owner-profile", lines: [unnamed, ""] })).rows).toBe(1);
  });

  it("refuses an owner profile that carries a store-local field", () => {
    const local = JSON.stringify({ ...OWNER, personId: "p-1" });
    expect(unwrapErr(decode({ kind: "owner-profile", lines: [local] })).message).toContain("personId");
  });

  it("counts a directive overlay's directives and corrections, and refuses a duplicate id", () => {
    expect(unwrap(decode({ kind: "owner-directives", lines: [JSON.stringify(DIRECTIVES, null, 2)] })).rows).toBe(2);
    const twice = { ...DIRECTIVES, directives: [DIRECTIVES.directives[0], DIRECTIVES.directives[0]] };
    expect(unwrapErr(decode({ kind: "owner-directives", lines: [JSON.stringify(twice)] })).code).toBe(
      "PART_UNDECODABLE",
    );
  });

  it("counts the asks the journal folds to, not its events, and refuses a journal whose fold breaks", () => {
    expect(unwrap(decode({ kind: "standing-asks", lines: [STANDING_ASK_LINES[0], ""] })).rows).toBe(1);
    expect(unwrap(decode({ kind: "standing-asks", lines: [...STANDING_ASK_LINES, ""] })).rows).toBe(0);
    const orphan = unwrapErr(decode({ kind: "standing-asks", lines: [STANDING_ASK_LINES[1]] }));
    expect(orphan.code).toBe("PART_UNDECODABLE");
  });

  it("keeps every line of a v1 steer part, keyed as its legacy import, and counts only the lines that parse", () => {
    const steers = unwrap(
      decode({ kind: "steer-verdicts", lines: [STEER_LINE, "", '{"says":"maybe"}', ""], schemaVersion: 1 }),
    );
    const envelopes = steers.retained.map((entry) => entry.payload);
    expect(steers.rows).toBe(1);
    expect(envelopes).toEqual([
      JSON.parse(steerEnvelopeLine({ sourceOrdinal: 1 })),
      {
        eventId: importedSteerEventId({ exactLine: '{"says":"maybe"}', sourceOrdinal: 3 }),
        exactText: '{"says":"maybe"}',
        parseStatus: "unparsed",
        schemaVersion: 2,
        sourceOrdinal: 3,
      },
    ]);
    expect(steers.retained.map((entry) => entry.summary)).toEqual([
      "nothing slack:acme/C0FIXTURE/1760000000.000100",
      "unparsed line at sequence 3",
    ]);
  });

  it("counts every envelope of a v2 steer part, and keys each by its event id", () => {
    const lines = [steerEnvelopeLine({ sourceOrdinal: 1 }), STEER_RECORDED_ENVELOPE_LINE, ""];
    const steers = unwrap(decode({ kind: "steer-verdicts", lines }));
    expect(steers.rows).toBe(2);
    expect(steers.retained.map((entry) => entry.key)).toEqual([
      importedSteerEventId({ exactLine: STEER_LINE, sourceOrdinal: 1 }),
      "steer-event-aaaaaaaa-0000-4000-8000-000000000001",
    ]);
  });

  it("fingerprints a steer measurement the same whether a v1 line or its v2 envelope carried it", () => {
    const fromV1 = unwrap(decode({ kind: "steer-verdicts", lines: [STEER_LINE], schemaVersion: 1 })).retained[0]!;
    const fromV2 = unwrap(decode({ kind: "steer-verdicts", lines: [steerEnvelopeLine({ sourceOrdinal: 1 })] }))
      .retained[0]!;
    expect([fromV2.key, fromV2.fingerprint]).toEqual([fromV1.key, fromV1.fingerprint]);
  });

  it("refuses a v2 steer part holding a journal line, or an envelope whose legacy id its place does not mint", () => {
    expect(unwrapErr(decode({ kind: "steer-verdicts", lines: [STEER_LINE] })).message).toContain(
      "line 1 is not a v2 envelope",
    );
    const moved = JSON.stringify({ ...JSON.parse(steerEnvelopeLine({ sourceOrdinal: 1 })), sourceOrdinal: 2 });
    expect(unwrapErr(decode({ kind: "steer-verdicts", lines: [moved] })).message).toContain(
      "its legacy id is not the one its line and source ordinal mint",
    );
  });

  it("reads an unmanifested steer part by what its lines are, and refuses one mixing the two", () => {
    const v1 = unwrap(decode({ kind: "steer-verdicts", lines: [STEER_LINE, "not json"], schemaVersion: null }));
    const v2 = unwrap(decode({ kind: "steer-verdicts", lines: [STEER_RECORDED_ENVELOPE_LINE], schemaVersion: null }));
    expect([v1.rows, v1.retained.length, v2.rows]).toEqual([1, 2, 1]);
    const mixed = [STEER_RECORDED_ENVELOPE_LINE, STEER_LINE];
    expect(unwrapErr(decode({ kind: "steer-verdicts", lines: mixed, schemaVersion: null })).message).toContain(
      "line 2 is a v1 line in a part of v2 lines",
    );
  });

  it("refuses an unmanifested envelope whose fields contradict, never reading it as a journal line", () => {
    const contradictory = JSON.stringify({
      ...JSON.parse(STEER_RECORDED_ENVELOPE_LINE),
      exactText: "not json",
      parseStatus: "parsed",
    });

    expect(
      unwrapErr(decode({ kind: "steer-verdicts", lines: [contradictory], schemaVersion: null })).message,
    ).toContain("line 1 is not a v2 envelope");
  });

  it("refuses an envelope naming two event ids, which JSON.parse would read as the second, manifested or not", () => {
    const first = JSON.parse(STEER_RECORDED_ENVELOPE_LINE).eventId;
    const twoIds = STEER_RECORDED_ENVELOPE_LINE.replace(
      `"eventId":"${first}"`,
      `"eventId":"steer-event-bbbbbbbb-0000-4000-8000-000000000002","eventId":"${first}"`,
    );

    expect(twoIds).not.toBe(STEER_RECORDED_ENVELOPE_LINE);
    expect(
      [2, null].map(
        (schemaVersion) => unwrapErr(decode({ kind: "steer-verdicts", lines: [twoIds], schemaVersion })).message,
      ),
    ).toEqual([
      expect.stringContaining("line 1 is not a v2 envelope: it is not the line its fields write"),
      expect.stringContaining("line 1 is not a v2 envelope: it is not the line its fields write"),
    ]);
  });

  it("refuses an envelope respelled with spaces, since only the exporter writes a v2 line", () => {
    const spaced = JSON.stringify(JSON.parse(STEER_RECORDED_ENVELOPE_LINE), null, 1).replaceAll("\n", "");

    expect(spaced).not.toBe(STEER_RECORDED_ENVELOPE_LINE);
    expect(unwrapErr(decode({ kind: "steer-verdicts", lines: [spaced] })).message).toContain(
      "it is not the line its fields write",
    );
  });

  it("refuses an unmanifested junk line that carries schemaVersion, and reads it once a manifest names v1", () => {
    const junk = '{"schemaVersion":1}';

    expect(unwrapErr(decode({ kind: "steer-verdicts", lines: [junk], schemaVersion: null })).message).toContain(
      "line 1 is not a v2 envelope",
    );
    expect(
      unwrap(decode({ kind: "steer-verdicts", lines: [junk], schemaVersion: 1 })).retained.map((entry) => entry.key),
    ).toEqual([importedSteerEventId({ exactLine: junk, sourceOrdinal: 1 })]);
  });

  it("refuses a steer part at a version this build does not read", () => {
    expect(unwrapErr(decode({ kind: "steer-verdicts", lines: [STEER_LINE], schemaVersion: 3 })).message).toContain(
      "this build does not read schema v3",
    );
  });

  it("keeps one entry per logical row, keyed the way its own domain keys it", () => {
    expect(unwrap(decode({ kind: "memories", lines: [MEMORY_LINE] })).retained.map((entry) => entry.key)).toEqual([
      "bbbbbbbb-0000-4000-8000-000000000001",
    ]);
    expect(unwrap(decode({ kind: "owner-voice", lines: [VOICE_LINE] })).retained.map((entry) => entry.key)).toEqual([
      "slack/all-sent",
    ]);
    const directives = unwrap(decode({ kind: "owner-directives", lines: [JSON.stringify(DIRECTIVES)] })).retained;
    expect(directives.map((entry) => entry.key)).toEqual(["directive:d-one", "directive:d-two"]);
    expect(directives[0]!.summary).toBe("draft first, never post directly");
    expect(unwrap(decode({ kind: "standing-asks", lines: [STANDING_ASK_LINES[0]] })).retained[0]!.summary).toBe(
      "standing ask org-intel, covers findings",
    );
  });

  it("fingerprints a memory by its logical content, not its seq or the spelling of its instants", () => {
    const one = unwrap(decode({ kind: "memories", lines: [MEMORY_LINE] })).retained[0]!;
    const row = JSON.parse(MEMORY_LINE) as Record<string, unknown>;
    const renumbered = JSON.stringify({ ...row, createdAt: "2026-10-01T09:00:01Z", seq: 99 });
    const same = unwrap(decode({ kind: "memories", lines: [renumbered] })).retained[0]!;
    const changed = unwrap(decode({ kind: "memories", lines: [JSON.stringify({ ...row, claim: "it does not" })] }))
      .retained[0]!;
    expect(same.fingerprint).toBe(one.fingerprint);
    expect(changed.fingerprint).not.toBe(one.fingerprint);
    expect(changed.key).toBe(one.key);
  });
});
