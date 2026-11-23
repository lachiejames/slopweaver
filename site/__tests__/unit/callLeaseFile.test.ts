import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeCallLease } from "../../lib/callLeaseFile";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** A fresh hold directory. */
function holdDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-call-lease-"));
  dirs.push(dir);
  return dir;
}

describe("writeCallLease", () => {
  it("replaces a lease with its whole new contents and leaves only the final file", async () => {
    const dir = holdDir();
    await writeCallLease({ dir, lease: { callId: "c1", untilMs: 1 } });
    await writeCallLease({ dir, lease: { callId: "c1", untilMs: 2 } });
    expect(JSON.parse(readFileSync(join(dir, "calls", "c1.json"), "utf8"))).toEqual({ callId: "c1", untilMs: 2 });
    expect(readdirSync(join(dir, "calls"))).toEqual(["c1.json"]);
  });

  it("lets concurrent beats for one call all land, each staged under its own name", async () => {
    const dir = holdDir();
    await Promise.all(
      Array.from({ length: 40 }, (_, beat) => writeCallLease({ dir, lease: { callId: "c1", untilMs: beat } })),
    );
    expect(JSON.parse(readFileSync(join(dir, "calls", "c1.json"), "utf8"))).toMatchObject({ callId: "c1" });
    expect(readdirSync(join(dir, "calls"))).toEqual(["c1.json"]);
  });

  it("removes its staged file when the rename fails, and leaves the target as it was", async () => {
    const dir = holdDir();
    const occupied = join(dir, "calls", "c1.json");
    mkdirSync(occupied, { recursive: true });
    writeFileSync(join(occupied, "keep"), "x");
    await expect(writeCallLease({ dir, lease: { callId: "c1", untilMs: 1 } })).rejects.toThrow();
    expect(readdirSync(join(dir, "calls"))).toEqual(["c1.json"]);
    expect(readdirSync(occupied)).toEqual(["keep"]);
  });
});
