/*
 * The transcript's page-to-file lag: the store stamps each segment line as it appends
 * it, and the gap to the page's own stamp is the half of a stall that is ours.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { transcriptLag, transcriptLagPhrase } from "../../../talk/callLag.js";
import type { CallEntry } from "../../../talk/callRecord.js";
import { appendCallEntries, callsDir, readCallEntries } from "../../../talk/callStore.js";

const CALL = "a0000041-0000-4000-8000-000000000044";

const said = ({ id, atIso, storedIso }: { id: string; atIso: string; storedIso?: string }): CallEntry => ({
  atIso,
  final: true,
  id,
  kind: "segment",
  text: "the pool is exhausted",
  who: "owner",
  ...(storedIso === undefined ? {} : { storedIso }),
});

describe("transcriptLag", () => {
  it("names the worst page-to-file gap over the stamped lines and where it was", () => {
    const lag = transcriptLag({
      entries: [
        said({ atIso: "2026-10-22T10:42:00.000Z", id: "s-1", storedIso: "2026-10-22T10:42:00.400Z" }),
        said({ atIso: "2026-10-22T10:42:05.000Z", id: "s-2", storedIso: "2026-10-22T10:43:17.000Z" }),
        said({ atIso: "2026-10-22T10:43:20.000Z", id: "s-3", storedIso: "2026-10-22T10:43:20.900Z" }),
      ],
    });
    expect(lag).toEqual({ stamped: 3, worstAtIso: "2026-10-22T10:42:05.000Z", worstMs: 72_000 });
  });

  it("counts nothing on lines written before the store stamped", () => {
    const lag = transcriptLag({ entries: [said({ atIso: "2026-10-22T10:42:00.000Z", id: "s-1" })] });
    expect(lag).toEqual({ stamped: 0, worstAtIso: undefined, worstMs: undefined });
    expect(transcriptLagPhrase({ lag })).toBe(undefined);
  });

  it("says the stall beyond the worst gap was upstream of the page", () => {
    const phrase = transcriptLagPhrase({ lag: { stamped: 4, worstAtIso: "2026-10-22T10:42:05.000Z", worstMs: 1250 } });
    expect(phrase).toBe(
      "transcript: page to file at most 1.3 s (at 2026-10-22T10:42:05.000Z, over 4 line(s)); " +
        "a longer stall happened before the page heard the owner, in OpenAI's transcription",
    );
  });
});

describe("appendCallEntries stamps the store's instant", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "sw-lag-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("writes storedIso on a segment line, overwriting one the page sent, and on nothing else", () => {
    const step: CallEntry = {
      atIso: "2026-10-22T10:42:01.000Z",
      event: { attempt: 1, delayMs: 0, kind: "scheduled", total: 5 },
      kind: "reconnect",
    };
    const appended = appendCallEntries({
      callId: CALL,
      entries: [said({ atIso: "2026-10-22T10:42:00.000Z", id: "s-1", storedIso: "2000-01-01T00:00:00.000Z" }), step],
      home,
      nowIso: () => "2026-10-22T10:42:03.000Z",
      pid: 101,
      startOf: (pid) => (pid === 101 ? { running: true, start: "t101" } : { running: false, start: undefined }),
    });
    expect(unwrap(appended).appended).toBe(2);
    const lines = readFileSync(join(callsDir({ home }), `${CALL}.jsonl`), "utf8")
      .trim()
      .split("\n");
    expect(lines.map((line) => (JSON.parse(line) as { storedIso?: string }).storedIso)).toEqual([
      "2026-10-22T10:42:03.000Z",
      undefined,
    ]);
    const lag = transcriptLag({ entries: unwrap(readCallEntries({ callId: CALL, home })) });
    expect(lag).toEqual({ stamped: 1, worstAtIso: "2026-10-22T10:42:00.000Z", worstMs: 3000 });
  });
});
