/**
 * The streaming edge of `session fallbacks` — the shipped reader run over the REAL frozen transcript bytes,
 * rather than over lines a test handed it. This is the half `sessions/modelFallback.test.ts` cannot cover:
 * that the file is read whole, from byte zero, and that a record 32 lines in is reached.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { judgeTranscriptFile } from "../../../../../cli/commands/session/fallbacks.js";

/** The frozen head of a real seat-fallback transcript. */
const FIXTURE = join(import.meta.dirname, "../../../../fixtures/sessions/seat-fallback-29b955c3.jsonl");

/** A throwaway directory for the transcripts a case writes itself. */
let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "seat-fallbacks-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe("judgeTranscriptFile", () => {
  it("reaches the fallback record 32 lines into the real file and reports the seat DEMOTED", () => {
    expect(judgeTranscriptFile({ path: FIXTURE })).toStrictEqual({
      verdict: {
        fallback: {
          atIso: "2026-09-15T12:03:00.259Z",
          category: "cyber",
          fallbackModel: "claude-opus-4-8",
          originalModel: "claude-opus-5",
        },
        kind: "demoted",
      },
    });
  });

  it("reports a transcript no fallback ever touched as none", () => {
    const path = join(dir, "clean.jsonl");
    writeFileSync(path, `${JSON.stringify({ message: { model: "claude-opus-5" }, type: "assistant" })}\n`, "utf8");

    expect(judgeTranscriptFile({ path })).toStrictEqual({ verdict: { kind: "none" } });
  });

  it("says why rather than reporting clean when the file is not there", () => {
    const judged = judgeTranscriptFile({ path: join(dir, "missing.jsonl") });

    expect("unreadable" in judged).toBe(true);
    expect((judged as { unreadable: string }).unreadable).toContain("its transcript could not be read");
  });

  it("reads an empty transcript as none rather than as unreadable", () => {
    const path = join(dir, "empty.jsonl");
    writeFileSync(path, "", "utf8");

    expect(judgeTranscriptFile({ path })).toStrictEqual({ verdict: { kind: "none" } });
  });
});
