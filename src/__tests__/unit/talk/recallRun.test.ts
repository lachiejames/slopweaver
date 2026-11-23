/*
 * `talk recall`'s body over a temp home: a search narrowed to the calls prints the counts with every other source
 * NOT SEARCHED (null, never zero), its pointer opens the turn, and a malformed pointer is a usage error. The
 * knowledge source is never asked here, so no store is reached.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseRecallArgs } from "../../../cli/commands/talk/recallArgs.js";
import { talkRecall } from "../../../cli/commands/talk/recallRun.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../cli/exitCodes.js";
import { rulingArchiveDir } from "../../../handover/archivedRulings.js";
import { unwrap } from "../../../lib/result.js";
import { callsDir } from "../../../talk/callStore.js";
import { RecallErrors } from "../../../talk/recallErrors.js";

const CALL = "7e0b1556-4864-42a6-bd10-675d331b2942";
const POINTER = `talk-call:${CALL}#turn_000000000000000000014`;

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "talk-recall-run-"));
  mkdirSync(callsDir({ home }), { recursive: true });
  const segment = {
    atIso: "2026-10-08T00:08:05.463Z",
    final: true,
    id: "turn_000000000000000000014",
    kind: "segment",
    text: "maybe we don't even sync Xero automatically",
    who: "owner",
  };
  appendFileSync(join(callsDir({ home }), `${CALL}.jsonl`), `${JSON.stringify(segment)}\n`);
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Run the verb's body over the home, collecting what it prints and what it refuses. */
async function run({
  rest,
}: {
  rest: readonly string[];
}): Promise<{ code: number; lines: string[]; failed: string[] }> {
  const lines: string[] = [];
  const failed: string[] = [];
  const code = await talkRecall({
    args: unwrap(parseRecallArgs({ rest: [...rest, "--home", home] })),
    fail: (message) => {
      failed.push(message);
    },
    out: (line) => {
      lines.push(line);
    },
  });
  return { code, failed, lines };
}

describe("talk recall", () => {
  it("searches only the source asked for and says the rest were not searched", async () => {
    const { code, lines } = await run({ rest: ["--words", "xero sync", "--source", "calls", "--json"] });
    expect(code).toBe(EXIT_OK);
    const answer = JSON.parse(lines[0]!) as { counts: unknown; hits: { pointer: string }[] };
    expect(answer.counts).toEqual({ calls: 1, knowledge: null, rulings: null, steers: null });
    expect(answer.hits.map((hit) => hit.pointer)).toEqual([POINTER]);
  });

  it("prints a person's lines naming the counts and each unsearched source", async () => {
    const { lines } = await run({ rest: ["--words", "xero", "--source", "calls"] });
    expect(lines[0]).toBe("talk recall: xero — calls 1, steers null, rulings null, knowledge null; 0 not shown");
    expect(lines.slice(-2)).toEqual([
      "  not searched — knowledge: not asked for: --source calls",
      "  not searched — supervisor-chat: what the owner TYPED into the supervisor chat is not in this search; supervisor_history reads its last day",
    ]);
  });

  it("prints a source read in part as a floor, never as a bare exact count", async () => {
    mkdirSync(dirname(rulingArchiveDir({ home })), { recursive: true });
    writeFileSync(rulingArchiveDir({ home }), "not a directory");
    const { lines } = await run({ rest: ["--words", "xero", "--source", "rulings"] });
    expect(lines[0]).toBe("talk recall: xero — calls null, steers null, rulings 0, knowledge null; 0 not shown");
    expect(lines.filter((line) => line.startsWith("  incomplete — rulings is at least its count: "))).toHaveLength(1);
    expect(lines.find((line) => line.startsWith("  incomplete"))).toContain("ENOTDIR");
  });

  it("opens the pointer a search printed", async () => {
    const { code, lines } = await run({ rest: ["--open", POINTER] });
    expect(code).toBe(EXIT_OK);
    expect(lines).toContain("> maybe we don't even sync Xero automatically");
  });

  it("refuses a malformed pointer as a usage error, and a missing record as a failure", async () => {
    const malformed = await run({ rest: ["--open", "file:/etc/passwd"] });
    expect(malformed.code).toBe(EXIT_USAGE);
    expect(malformed.failed).toEqual([
      RecallErrors.pointerMalformed({ pointer: "file:/etc/passwd", why: "unknown scheme file" }).message,
    ]);
    const missing = await run({ rest: ["--open", `talk-call:${CALL}#turn_missing`] });
    expect(missing.code).toBe(EXIT_ERROR);
    expect(missing.failed[0]).toContain("which is not there");
  });
});
