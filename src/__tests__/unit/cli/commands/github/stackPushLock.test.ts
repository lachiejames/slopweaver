/**
 * `--wait` is the only thing this seam decides, so what is asserted is that a caller who passes neither flag
 * reaches the plain acquisition: the same handle, and not one line of waiting output.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireOperationLock } from "../../../../../admit/operationLock.js";
import { takeStackPushLock } from "../../../../../cli/commands/github/stackPushLock.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const NO_WAIT = { timeoutSeconds: 540, wait: false } as const;
const NOW = "2026-09-20T03:00:00.000Z";

/** The two edges this seam reads: a frozen clock, and an output sink that records instead of printing. */
function depsRecording({ lines }: { lines: string[] }): {
  now: () => Date;
  out: (input: { readonly line: string }) => void;
} {
  return {
    now: () => new Date(NOW),
    out: ({ line }) => {
      lines.push(line);
    },
  };
}

describe("takeStackPushLock", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "stack-push-lock-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("takes a free lock without --wait, and prints nothing while doing it", async () => {
    const lines: string[] = [];
    const result = await takeStackPushLock({
      deps: depsRecording({ lines }),
      home,
      key: "lachiejames/slopweaver",
      wait: NO_WAIT,
    });
    expect(result.isOk()).toBe(true);
    expect(lines).toEqual([]);
    unwrap(result).release();
  });

  it("hands back the plain refusal without --wait when the lock is already held", async () => {
    const holder = acquireOperationLock({ home, key: "lachiejames/slopweaver", nowIso: NOW });
    expect(holder.isOk()).toBe(true);
    const lines: string[] = [];
    const result = await takeStackPushLock({
      deps: depsRecording({ lines }),
      home,
      key: "lachiejames/slopweaver",
      wait: NO_WAIT,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toContain(`held by pid ${String(process.pid)}`);
    expect(lines).toEqual([]);
    unwrap(holder).release();
  });
});
