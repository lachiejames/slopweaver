/**
 * A load or refresh slot's holder is judged by its real process identity — proved against real processes and the
 * real `/bin/ps`, not a modelled one.
 *
 * Two shapes the unit lane cannot make. A ZOMBIE — exited, unreaped, still answering signal 0 and still printing its
 * original start stamp — is `sleep 0` backgrounded by a shell that then `exec`s a longer `sleep`, which never waits
 * for it (the shape `admit/zombieHolder.test.ts` uses). And a slot this process writes must record the very stamp
 * the probe reads back, or every live holder would read reused.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type LoadSlot, leaseFromMarker, slotMarker } from "../../../lib/loadSlotMarker.js";
import { acquireLoadSlot, liveSlots } from "../../../lib/loadSlots.js";
import { lstartMs } from "../../../lib/lstart.js";
import { processIdentityOf } from "../../../lib/processIdentity.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

/** A fresh slot directory, removed after the test. */
function slotDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "slot-identity-"));
  cleanups.push(() => rmSync(dir, { force: true, recursive: true }));
  return dir;
}

/** A zombie's pid, and the parent that withholds `wait` from it until it is killed. */
async function zombie(): Promise<{ pid: number; parent: ChildProcess }> {
  const parent = spawn("sh", ["-c", "sleep 0 & echo $!; exec sleep 30"], { stdio: ["ignore", "pipe", "ignore"] });
  cleanups.push(() => parent.kill());
  const pid = await new Promise<number>((resolve) => {
    parent.stdout.once("data", (chunk: Buffer) => resolve(Number(chunk.toString("utf8").trim())));
  });
  // `sleep 0` exits at once; give it the moment it takes before it is read.
  await new Promise((resolve) => setTimeout(resolve, 300));
  return { parent, pid };
}

describe("processIdentityOf over real processes", () => {
  it("reads this process as running, not a zombie, with a start stamp lstart parses", () => {
    const self = processIdentityOf({ pid: process.pid });
    expect(self.running).toBe(true);
    expect(self.zombie).toBe(false);
    expect(lstartMs({ text: self.start! })).toBeGreaterThan(0);
  });

  it("reads a zombie as running AND a zombie, start stamp intact", async () => {
    const { pid } = await zombie();
    const held = processIdentityOf({ pid });
    expect(held.running).toBe(true);
    expect(held.zombie).toBe(true);
    expect(lstartMs({ text: held.start! })).toBeGreaterThan(0);
  });
});

/** Plant lane 0 of a slot directory held by `slot`, replacing whatever marker it held. */
function plantLane({ dir, slot }: { dir: string; slot: LoadSlot }): void {
  const lane = join(dir, "lane-0");
  rmSync(lane, { force: true, recursive: true });
  mkdirSync(lane, { recursive: true });
  writeFileSync(join(lane, slotMarker({ lease: { limit: 1, slot } })), "");
}

describe("liveSlots over real processes", () => {
  it("reads a zombie holder as no holder, though its pid answers signal 0 and its recorded stamp still matches", async () => {
    const { pid } = await zombie();
    const dir = slotDir();
    const start = processIdentityOf({ pid }).start!;
    plantLane({ dir, slot: { ceilingMib: 4096, pid, start, startedAtIso: "2026-11-06T00:00:00.000Z" } });
    expect(liveSlots({ dir })).toEqual([]);
  });

  it("keeps a live holder whose recorded stamp is its real one, and not the same pid under another stamp", () => {
    const dir = slotDir();
    const start = processIdentityOf({ pid: process.ppid }).start!;
    plantLane({ dir, slot: { ceilingMib: 4096, pid: process.ppid, start, startedAtIso: "2026-11-06T00:00:00.000Z" } });
    expect(liveSlots({ dir }).map((slot) => slot.pid)).toEqual([process.ppid]);
    plantLane({
      dir,
      slot: {
        ceilingMib: 4096,
        pid: process.ppid,
        start: "Thu Jan  1 00:00:00 1970",
        startedAtIso: "2026-11-06T00:00:00.000Z",
      },
    });
    expect(liveSlots({ dir })).toEqual([]);
  });

  it("records the very stamp the probe reads back, so this process's own slot reads live", () => {
    const dir = slotDir();
    expect(acquireLoadSlot({ ceilingMib: 4096, dir, limit: 1 }).admitted).toBe(true);
    const [marker] = readdirSync(join(dir, "lane-0"));
    expect(leaseFromMarker({ marker: marker! })!.slot.start).toBe(processIdentityOf({ pid: process.pid }).start);
    expect(liveSlots({ dir }).map((slot) => slot.pid)).toEqual([process.pid]);
  });
});
