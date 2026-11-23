/**
 * The runners behind the written-down call — `talk transcript` and `talk calls` — driven through their real argv
 * over a throwaway `--home`, so a verb the manifest can dispatch is one the suite runs. What `transcript` appended is
 * read back through the store, and every refusal is decided before a byte is written.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runTalkCalls } from "../../../cli/commands/talk/callsRun.js";
import { runTalkThread } from "../../../cli/commands/talk/threadRun.js";
import { runTalkTranscript } from "../../../cli/commands/talk/transcriptRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { unwrap } from "../../../lib/result.js";
import { readCalls } from "../../../talk/callStore.js";

const CALL = "a0000041-0000-4000-8000-000000000044";

/** The full argv a verb receives: `[node, bin, "talk", <verb>, ...rest]`. */
const argvFor = ({ verb, rest }: { verb: string; rest: readonly string[] }): readonly string[] => [
  "node",
  "slopweaver",
  "talk",
  verb,
  ...rest,
];

const LINES = [
  { atIso: "2026-09-25T02:30:00.000Z", kind: "open", model: "m", sessionId: "sess", voice: "cedar" },
  { atIso: "2026-09-25T02:31:00.000Z", final: false, id: "s-1", kind: "segment", text: "and merge the", who: "owner" },
];

let home = "";
let batch = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-call-runs-"));
  batch = join(home, "batch.jsonl");
  writeFileSync(batch, LINES.map((line) => `${JSON.stringify(line)}\n`).join(""));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("runTalkTranscript", () => {
  it("appends the batch to the call's own 0600 file, which reads back as a dropped call", async () => {
    const code = await runTalkTranscript(
      argvFor({ rest: ["--call", CALL, "--entries-file", batch, "--home", home, "--json"], verb: "transcript" }),
    );
    expect(code).toBe(EXIT_OK);
    expect(statSync(join(home, "talk", "calls", `${CALL}.jsonl`)).mode & 0o777).toBe(0o600);
    const read = unwrap(readCalls({ home, keep: { limit: 5 } }));
    expect(read.calls.map((call) => [call.callId, call.ended, call.segments.map((segment) => segment.text)])).toEqual([
      [CALL, undefined, ["and merge the"]],
    ]);
  });

  it("refuses a call id that is not a v4 UUID before writing anything", async () => {
    const code = await runTalkTranscript(
      argvFor({ rest: ["--call", "../escape", "--entries-file", batch, "--home", home], verb: "transcript" }),
    );
    expect(code).toBe(EXIT_USAGE);
    expect(unwrap(readCalls({ home, keep: { limit: 5 } })).calls).toEqual([]);
  });

  it("refuses the whole batch when one line is not a call line", async () => {
    writeFileSync(batch, `${JSON.stringify(LINES[0])}\n{"kind":"shell"}\n`);
    const code = await runTalkTranscript(
      argvFor({ rest: ["--call", CALL, "--entries-file", batch, "--home", home], verb: "transcript" }),
    );
    expect(code).toBe(EXIT_USAGE);
    expect(unwrap(readCalls({ home, keep: { limit: 5 } })).calls).toEqual([]);
  });

  // A well-formed batch whose append failed is the route's 503, which keeps the owner's words on the page.
  it("exits an error, not a usage refusal, when a well-formed batch could not be written", async () => {
    mkdirSync(join(home, "talk"), { recursive: true });
    writeFileSync(join(home, "talk", "calls"), "not a directory");
    const code = await runTalkTranscript(
      argvFor({ rest: ["--call", CALL, "--entries-file", batch, "--home", home], verb: "transcript" }),
    );
    expect(code).toBe(EXIT_ERROR);
  });

  it("masks a credential in a tool answer and a denylist word before either reaches the call file", async () => {
    const token = "ghp_" + "Z".repeat(30);
    const answered = {
      answer: `token ${token} for AcmeSecretWord`,
      atIso: "2026-09-25T02:31:30.000Z",
      detail: "read a thread",
      kind: "tool",
      name: "read_slack_thread",
      refused: false,
    };
    writeFileSync(join(home, "hygiene-denylist.txt"), "acmesecretword\n");
    writeFileSync(batch, [...LINES, answered].map((line) => `${JSON.stringify(line)}\n`).join(""));
    const code = await runTalkTranscript(
      argvFor({ rest: ["--call", CALL, "--entries-file", batch, "--home", home, "--json"], verb: "transcript" }),
    );
    expect(code).toBe(EXIT_OK);
    const stored = readFileSync(join(home, "talk", "calls", `${CALL}.jsonl`), "utf8");
    expect([stored.includes(token), stored.toLowerCase().includes("acmesecretword")]).toEqual([false, false]);
    expect(stored).toContain('"answer":"token [REDACTED:github-oauth-token] for [REDACTED:denylist]"');
    // The witness: the batch the verb read did carry both.
    expect(readFileSync(batch, "utf8")).toContain(token);
  });

  // The store stamps each segment line with `storedIso` after masking, so a denylist word only that stamp
  // carries is judged where the bytes are written, and refuses the append before the call is even indexed.
  it("refuses, writing nothing, a batch whose line carries a denylist word only once the store stamps it", async () => {
    writeFileSync(join(home, "hygiene-denylist.txt"), "storedIso\n");
    // The witness: what the verb read carries no such word, so masking had nothing to mask.
    expect(readFileSync(batch, "utf8").toLowerCase()).not.toContain("storediso");
    const code = await runTalkTranscript(
      argvFor({ rest: ["--call", CALL, "--entries-file", batch, "--home", home], verb: "transcript" }),
    );
    expect(code).toBe(EXIT_ERROR);
    expect([
      existsSync(join(home, "talk", "calls", `${CALL}.jsonl`)),
      existsSync(join(home, "talk", "call-index.txt")),
    ]).toEqual([false, false]);
  });

  it("appends nothing and exits an error the page retries when the denylist cannot be read", async () => {
    mkdirSync(join(home, "hygiene-denylist.txt"));
    const code = await runTalkTranscript(
      argvFor({ rest: ["--call", CALL, "--entries-file", batch, "--home", home], verb: "transcript" }),
    );
    expect(code).toBe(EXIT_ERROR);
    expect(unwrap(readCalls({ home, keep: { limit: 5 } })).calls).toEqual([]);
  });
});

describe("runTalkCalls", () => {
  it("reads a home with no call written as nothing, not a failure", () => {
    expect(runTalkCalls(argvFor({ rest: ["--home", home, "--json"], verb: "calls" }))).toBe(EXIT_OK);
  });

  it("refuses a limit past its bound", () => {
    expect(runTalkCalls(argvFor({ rest: ["--home", home, "--limit", "500"], verb: "calls" }))).toBe(EXIT_USAGE);
  });
});

describe("runTalkThread", () => {
  it("reads a home with no call, and one with a call written, without failing", async () => {
    const before = runTalkThread(argvFor({ rest: ["--home", home, "--json"], verb: "thread" }));
    await runTalkTranscript(
      argvFor({ rest: ["--call", CALL, "--entries-file", batch, "--home", home], verb: "transcript" }),
    );
    const after = runTalkThread(argvFor({ rest: ["--home", home, "--json"], verb: "thread" }));
    expect([before, after]).toEqual([EXIT_OK, EXIT_OK]);
  });

  it("refuses a turn count past its bound", () => {
    expect(runTalkThread(argvFor({ rest: ["--home", home, "--turns", "5000"], verb: "thread" }))).toBe(EXIT_USAGE);
  });

  it("exits an error when the call directory cannot be read", () => {
    mkdirSync(join(home, "talk"), { recursive: true });
    writeFileSync(join(home, "talk", "calls"), "not a directory");
    expect(runTalkThread(argvFor({ rest: ["--home", home, "--json"], verb: "thread" }))).toBe(EXIT_ERROR);
  });
});
