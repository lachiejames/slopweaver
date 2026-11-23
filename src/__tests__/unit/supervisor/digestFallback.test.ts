/**
 * `jsonFellBackToTextLines` — tick open naming every completed JSON reading the digest could only read as text,
 * over the REAL `digestReadings` reading real files: a `close-done.json` with a monitor's FIRING line ahead
 * of its document is named, and a parsed document, a text reading and one that never completed are not.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { digestReadings } from "../../../cli/commands/supervisor/tickFiles.js";
import { jsonFellBackToTextLines } from "../../../supervisor/digestFallback.js";
import type { ReadingOutcome } from "../../../supervisor/scratch/tickCapture.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "digest-fallback-"));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

const exited = { durationMs: 1, exitCode: 0, kind: "exited" as const };
const timedOut = { durationMs: 9, kind: "timed-out" as const, signal: "SIGKILL" as const, timeoutMs: 8 };

/** One reading's outcome, completed and exited 0 unless told otherwise. */
function outcome({ name, file, argv }: { name: string; file: string; argv: readonly string[] }): ReadingOutcome {
  return { argv, bytes: 1, child: exited, completed: true, errFile: `${name}.err`, exitCode: 0, file, name };
}

describe("jsonFellBackToTextLines", () => {
  it("names a completed JSON reading a stray stdout line made unparseable, and nothing else", () => {
    writeFileSync(join(dir, "cmux.json"), '{"workspaces":[]}');
    writeFileSync(join(dir, "close-done.json"), 'steer-at-risk  FIRING over 1\n{"counts":{}}\n');
    writeFileSync(join(dir, "events.txt"), "nothing new\n");
    writeFileSync(join(dir, "depth.json"), "{not json");
    const readings: readonly ReadingOutcome[] = [
      outcome({ argv: ["cmux", "list", "--json"], file: "cmux.json", name: "cmux" }),
      outcome({ argv: ["session", "close-done", "--json"], file: "close-done.json", name: "close-done" }),
      outcome({ argv: ["events", "tail"], file: "events.txt", name: "events" }),
      {
        ...outcome({ argv: ["session", "watch", "--json-report"], file: "watch-report.json", name: "watch-report" }),
        child: timedOut,
        completed: false,
        exitCode: null,
      },
      outcome({ argv: ["session", "depth", "--json"], file: "depth.json", name: "depth" }),
    ];
    const digested = digestReadings({ dir, readings });
    const closeDone = digested.get("close-done") as { kind: string; text: string };
    const depth = digested.get("depth") as { kind: string; text: string };
    expect([closeDone.kind, depth.kind]).toEqual(["text", "text"]);

    expect(jsonFellBackToTextLines({ digested, readings })).toEqual([
      `close-done.json is NOT one JSON document, so the digest reads it as text — ${closeDone.text}. ` +
        "Something wrote to `slopweaver session close-done --json`'s stdout besides its document; " +
        "the tick draft refuses a document of the wrong shape, so this reading stops the tick until it parses.",
      `depth.json is NOT one JSON document, so the digest reads it as text — ${depth.text}. ` +
        "Something wrote to `slopweaver session depth --json`'s stdout besides its document; " +
        "the tick draft refuses a document of the wrong shape, so this reading stops the tick until it parses.",
    ]);
    expect(closeDone.text).toContain("close-done.json");
  });

  it("says nothing of a completed reading that printed nothing, which the draft already leaves out", () => {
    writeFileSync(join(dir, "standing.json"), "");
    const readings = [
      { ...outcome({ argv: ["session", "standing", "--json"], file: "standing.json", name: "standing" }), bytes: 0 },
    ];
    const digested = digestReadings({ dir, readings });
    expect(digested.get("standing")!.kind).toBe("text");
    expect(jsonFellBackToTextLines({ digested, readings })).toEqual([]);
  });

  it("names a file two readings share ONCE, with both verbs that could have written it", () => {
    writeFileSync(join(dir, "bump-drive-a-b-c.json"), "{not json");
    const readings = [
      outcome({
        argv: ["github", "bump-drive", "--repo", "a-b/c"],
        file: "bump-drive-a-b-c.json",
        name: "bump-drive-a-b-c",
      }),
      outcome({
        argv: ["github", "bump-drive", "--repo", "a/b-c"],
        file: "bump-drive-a-b-c.json",
        name: "bump-drive-a-b-c",
      }),
    ];
    const digested = digestReadings({ dir, readings });
    const text = (digested.get("bump-drive-a-b-c") as { text: string }).text;

    expect(jsonFellBackToTextLines({ digested, readings })).toEqual([
      `bump-drive-a-b-c.json is NOT one JSON document, so the digest reads it as text — ${text}. ` +
        "Something wrote to `slopweaver github bump-drive --repo a-b/c` or `slopweaver github bump-drive --repo a/b-c`'s " +
        "stdout besides its document; " +
        "the tick draft refuses a document of the wrong shape, so this reading stops the tick until it parses.",
    ]);
  });

  it("judges a shared file by its LAST reading, so an earlier non-empty one cannot flag an empty file", () => {
    writeFileSync(join(dir, "bump-drive-a-b-c.json"), "");
    const readings = [
      outcome({
        argv: ["github", "bump-drive", "--repo", "a-b/c"],
        file: "bump-drive-a-b-c.json",
        name: "bump-drive-a-b-c",
      }),
      {
        ...outcome({
          argv: ["github", "bump-drive", "--repo", "a/b-c"],
          file: "bump-drive-a-b-c.json",
          name: "bump-drive-a-b-c",
        }),
        bytes: 0,
      },
    ];
    const digested = digestReadings({ dir, readings });
    expect(digested.get("bump-drive-a-b-c")!.kind).toBe("text");

    expect(jsonFellBackToTextLines({ digested, readings })).toEqual([]);
  });

  it("says nothing when every completed JSON reading parsed", () => {
    writeFileSync(join(dir, "close-done.json"), '{"counts":{}}\n');
    const readings = [
      outcome({ argv: ["session", "close-done", "--json"], file: "close-done.json", name: "close-done" }),
    ];
    expect(jsonFellBackToTextLines({ digested: digestReadings({ dir, readings }), readings })).toEqual([]);
  });
});
