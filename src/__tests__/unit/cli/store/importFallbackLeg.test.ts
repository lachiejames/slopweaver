/**
 * The `codex-fallback` leg of `store import-fleet`, run with no connection — what a dry run projects.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runFallbackLeg } from "../../../../cli/commands/store/importFallbackLeg.js";

const homes: string[] = [];
afterEach(() => {
  for (const dir of homes.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "import-fallback-"));
  homes.push(home);
  return home;
}

/** One request directory, with a receipt beside it when one is given. */
function requestDir({
  home,
  requestId,
  request,
  receipt,
}: {
  home: string;
  requestId: string;
  request: string;
  receipt: string | undefined;
}): void {
  const dir = join(home, "codex-fallback", requestId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "request.json"), request);
  if (receipt !== undefined) {
    writeFileSync(join(dir, "receipt.json"), receipt);
  }
}

describe("runFallbackLeg", () => {
  it("reports an install with no codex-fallback directory as an absent source, not a failure", async () => {
    const home = freshHome();
    const outcome = await runFallbackLeg({ client: undefined, home });
    expect(outcome).toEqual({
      absentSource: join(home, "codex-fallback"),
      leg: "codex-fallback",
      projected: 0,
      refused: [],
      unreadableLines: 0,
      written: 0,
    });
  });

  it("projects every request directory, answered or pending, and skips a folder that holds no request", async () => {
    const home = freshHome();
    requestDir({ home, receipt: '{"receiptId":"r"}', request: '{"requestId":"a"}', requestId: "a" });
    requestDir({ home, receipt: undefined, request: '{"requestId":"b"}', requestId: "b" });
    mkdirSync(join(home, "codex-fallback", "answers"), { recursive: true });
    writeFileSync(join(home, "codex-fallback", "answers", "plan-answer.json"), "{}");
    const outcome = await runFallbackLeg({ client: undefined, home });
    expect(outcome.projected).toBe(2);
    expect(outcome.refused).toEqual([]);
    expect(outcome.written).toBe(0);
  });

  it("names a document the store cannot hold verbatim, and still projects the rest", async () => {
    const home = freshHome();
    requestDir({ home, receipt: undefined, request: '{"requestId":"ok"}', requestId: "ok" });
    requestDir({ home, receipt: "a\u0000b", request: '{"requestId":"nul"}', requestId: "nul" });
    const outcome = await runFallbackLeg({ client: undefined, home });
    expect(outcome.projected).toBe(1);
    expect(outcome.refused.map((refusal) => refusal.code)).toEqual(["UNSTORABLE_FALLBACK_DOCUMENT"]);
    expect(outcome.refused[0]!.message).toBe(
      `${join(home, "codex-fallback", "nul")} cannot be stored as a Claude fallback document verbatim: it holds a NUL byte`,
    );
  });

  it("refuses a receipt that is not valid UTF-8 rather than store its lenient decode, and still projects the rest", async () => {
    const home = freshHome();
    requestDir({ home, receipt: undefined, request: '{"requestId":"ok"}', requestId: "ok" });
    requestDir({ home, receipt: undefined, request: '{"requestId":"bad"}', requestId: "bad" });
    const receiptPath = join(home, "codex-fallback", "bad", "receipt.json");
    writeFileSync(receiptPath, new Uint8Array([0x7b, 0x80, 0x7d]));
    const outcome = await runFallbackLeg({ client: undefined, home });
    expect(outcome.projected).toBe(1);
    expect(outcome.refused.map((refusal) => refusal.code)).toEqual(["UNSTORABLE_FALLBACK_DOCUMENT"]);
    expect(outcome.refused[0]!.message).toBe(
      `${receiptPath} cannot be stored as a Claude fallback document verbatim: it is not valid UTF-8`,
    );
  });
});
