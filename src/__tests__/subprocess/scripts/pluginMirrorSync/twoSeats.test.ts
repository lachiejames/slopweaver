/**
 * Two plugin roots booting against one plugin-data root: each keeps its own layout, and the prune frees only a
 * stale one.
 */

import { existsSync, mkdirSync, readdirSync, readlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";
import {
  currentTree,
  FILES_PER_DIR,
  fileCount,
  fixture,
  holdLock,
  LAST_BOOTED_A_MONTH_AGO,
  LONG_DEAD,
  mirrorRoot,
  runOnce,
  useFixtureCleanup,
} from "./harness.js";

useFixtureCleanup();

describe("two seats with different hook layouts", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  /**
   * Give a fixture root a script only IT has, so "whose tree is this" is answerable by a file's existence
   * rather than by a count. A bare file count cannot tell two same-sized layouts apart, which is exactly the
   * pair the per-root layout produced — ten small shims against one.
   *
   * @param name the script's base name, which is also the marker
   * @returns nothing
   */
  function giveOwnHook({ root, name }: { root: string; name: string }): void {
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "scripts", `${name}.sh`), `#!/bin/sh\necho ${name}\n`, { mode: 0o755 });
  }

  it("leaves each seat resolving its OWN layout after the other has booted over the top", () => {
    const seatOld = fixture();
    const seatNew = fixture();
    // ONE plugin-data root, which is the whole point: the host hands every seat running this plugin the
    // same directory, so isolation has to come from the key rather than from where the mirror lives.
    const data = seatOld.data;
    giveOwnHook({ name: "hook-old", root: seatOld.root });
    giveOwnHook({ name: "hook-new", root: seatNew.root });

    runOnce({ bin: seatOld.bin, data, root: seatOld.root });
    runOnce({ bin: seatNew.bin, data, root: seatNew.root });

    const oldCurrent = join(mirrorRoot({ data, root: seatOld.root }), "current");
    const newCurrent = join(mirrorRoot({ data, root: seatNew.root }), "current");
    // Both halves of each seat are asserted. Presence alone would pass on a mirror holding the union of the
    // two layouts, which is not isolation — it is the shared tree with more files in it.
    expect(existsSync(join(oldCurrent, "scripts", "hook-old.sh"))).toBe(true);
    expect(existsSync(join(oldCurrent, "scripts", "hook-new.sh"))).toBe(false);
    expect(existsSync(join(newCurrent, "scripts", "hook-new.sh"))).toBe(true);
    expect(existsSync(join(newCurrent, "scripts", "hook-old.sh"))).toBe(false);
  });

  it("keeps the first seat's mirror COMPLETE after the second boots, not merely present", () => {
    const seatOld = fixture();
    const seatNew = fixture();
    const data = seatOld.data;
    runOnce({ bin: seatOld.bin, data, root: seatOld.root });
    runOnce({ bin: seatNew.bin, data, root: seatNew.root });
    expect(currentTree({ data, root: seatOld.root })).toEqual({
      slot: ".slot-a",
      src: FILES_PER_DIR,
      templates: FILES_PER_DIR,
    });
  });

  it("points the pre-per-root path at the newest boot, so a session frozen on it still resolves", () => {
    const seatOld = fixture();
    const seatNew = fixture();
    const data = seatOld.data;
    giveOwnHook({ name: "hook-old", root: seatOld.root });
    giveOwnHook({ name: "hook-new", root: seatNew.root });
    runOnce({ bin: seatOld.bin, data, root: seatOld.root });
    runOnce({ bin: seatNew.bin, data, root: seatNew.root });
    // Last-boot-wins, exactly as it was before the key existed — this link is the migration window for the
    // commands already frozen in open sessions, not a second mirror. It is a symlink to a symlink, so the
    // witness is that a file of the newest seat's layout is reachable THROUGH it.
    expect(readlinkSync(join(data, "mirror", "current"))).toBe(`by-root${seatNew.root}/current`);
    expect(existsSync(join(data, "mirror", "current", "scripts", "hook-new.sh"))).toBe(true);
  });

  it("prunes a root nothing has booted against for a week, and never the one booting", () => {
    const seatGone = fixture();
    const seatLive = fixture();
    const data = seatGone.data;
    runOnce({ bin: seatGone.bin, data, root: seatGone.root });
    // Backdate the marker every successful build writes. The script reads THAT file rather than the root's
    // existence, because a plugin root can be pruned out from under a session that is still running.
    utimesSync(
      join(mirrorRoot({ data, root: seatGone.root }), ".last-sync"),
      LAST_BOOTED_A_MONTH_AGO,
      LAST_BOOTED_A_MONTH_AGO,
    );
    runOnce({ bin: seatLive.bin, data, root: seatLive.root });
    // What the root OWNS goes, not its directory: roots nest, so removing the directory would take any live
    // worktree root standing inside it. Every asserted name is one the script itself creates, so the disk
    // (two 74 MiB slots) is what is actually freed.
    expect(readdirSync(mirrorRoot({ data, root: seatGone.root }))).toEqual([]);
    expect(existsSync(join(mirrorRoot({ data, root: seatLive.root }), ".last-sync"))).toBe(true);
  });

  it("never prunes a stale root whose lock stands, since that root is copying right now", () => {
    const seatBuilding = fixture();
    const seatLive = fixture();
    const data = seatBuilding.data;
    runOnce({ bin: seatBuilding.bin, data, root: seatBuilding.root });
    const marker = join(mirrorRoot({ data, root: seatBuilding.root }), ".last-sync");
    utimesSync(marker, LAST_BOOTED_A_MONTH_AGO, LAST_BOOTED_A_MONTH_AGO);
    // A holder waiting on the copy lock, or mid-copy: its marker is only rewritten at the flip. Found by review,
    // The prune took both of such a root's slots and it then flipped onto a partial one.
    holdLock({ data, root: seatBuilding.root });
    runOnce({ bin: seatLive.bin, data, root: seatLive.root });
    expect(readlinkSync(join(mirrorRoot({ data, root: seatBuilding.root }), "current"))).toBe(".slot-a");
    expect(existsSync(marker)).toBe(true);
  });

  it("prunes a stale root whose lock is old enough to prove its holder died, leaving that lock standing", () => {
    const seatDead = fixture();
    const seatLive = fixture();
    const data = seatDead.data;
    runOnce({ bin: seatDead.bin, data, root: seatDead.root });
    const marker = join(mirrorRoot({ data, root: seatDead.root }), ".last-sync");
    utimesSync(marker, LAST_BOOTED_A_MONTH_AGO, LAST_BOOTED_A_MONTH_AGO);
    // A SIGKILLed build: no EXIT trap ran, so its lock outlives it, and a removed worktree or a superseded cache
    // version never boots again to break it. MEASURED: 16 such locks pinning their slots for good.
    const lock = holdLock({ data, root: seatDead.root });
    utimesSync(lock, LONG_DEAD, LONG_DEAD);
    runOnce({ bin: seatLive.bin, data, root: seatLive.root });
    expect(readdirSync(mirrorRoot({ data, root: seatDead.root }))).toEqual([".sync.lock"]);
  });

  it("frees a stale OUTER root without taking the live worktree root nested inside its mirror", () => {
    const outer = fixture();
    const nested = fixture({ under: join(outer.root, ".claude", "worktrees.noindex", "live-branch") });
    const data = outer.data;
    runOnce({ bin: outer.bin, data, root: outer.root });
    runOnce({ bin: nested.bin, data, root: nested.root });
    // Only the OUTER root goes stale. The nested one booted just now, so it is a live seat by the only
    // measure the script has — and `rm -rf` of the outer directory would have taken its whole mirror with
    // it, leaving that seat's frozen hook commands resolving to nothing. That is the 127 this script exists
    // to prevent, arriving from the sweep meant to protect the disk.
    utimesSync(
      join(mirrorRoot({ data, root: outer.root }), ".last-sync"),
      LAST_BOOTED_A_MONTH_AGO,
      LAST_BOOTED_A_MONTH_AGO,
    );

    runOnce({ bin: nested.bin, data, root: nested.root });

    expect(existsSync(join(mirrorRoot({ data, root: outer.root }), ".slot-a"))).toBe(false);
    expect(existsSync(join(mirrorRoot({ data, root: outer.root }), ".last-sync"))).toBe(false);
    // Its SECOND boot, so the slot it alternated onto is the witness that the sweep left a working mirror
    // behind rather than merely a directory.
    expect(currentTree({ data, root: nested.root })).toEqual({
      slot: ".slot-b",
      src: FILES_PER_DIR,
      templates: FILES_PER_DIR,
    });
  });

  it("keeps a root whose last boot is recent, so pruning cannot reach a live seat", () => {
    const seatOther = fixture();
    const seatLive = fixture();
    const data = seatOther.data;
    runOnce({ bin: seatOther.bin, data, root: seatOther.root });
    runOnce({ bin: seatLive.bin, data, root: seatLive.root });
    expect(existsSync(mirrorRoot({ data, root: seatOther.root }))).toBe(true);
  });

  it("never walks INTO a slot to find a marker, so a file named .last-sync in one is not a root", () => {
    const seat = fixture();
    const data = seat.data;
    runOnce({ bin: seat.bin, data, root: seat.root });
    // The witness is a decoy the walk would have to have ENTERED a slot to see, backdated past the
    // seven-day keep — so this reddens by DAMAGE rather than by silence. The unbounded walk found it,
    // took its dirname, saw a path that is not MIRROR_ROOT, and rm -rf'd a directory inside the LIVE
    // mirror. MEASURED on the owner's tree: 864,565 entries visited to find 64 markers.
    const decoyDir = join(mirrorRoot({ data, root: seat.root }), ".slot-a", "src", "sub");
    const decoy = join(decoyDir, ".last-sync");
    writeFileSync(decoy, "");
    utimesSync(decoy, LAST_BOOTED_A_MONTH_AGO, LAST_BOOTED_A_MONTH_AGO);

    runOnce({ bin: seat.bin, data, root: seat.root });

    expect(existsSync(decoy)).toBe(true);
    expect(fileCount({ dir: decoyDir })).toBe(FILES_PER_DIR + 1);
  });

  it("still prunes a root NESTED inside another root's mirror, which is every worktree on this fleet", () => {
    const outer = fixture();
    // The real shape: a worktree's plugin root is a path under the checkout's own plugin root, so its
    // mirror directory sits INSIDE the checkout's mirror directory. 63 of the 64 roots on the owner's
    // machine are this. A walk bounded by -maxdepth, or one that stopped at the first marker it found,
    // would never reach this marker and would silently turn the seven-day prune off for the whole fleet.
    const nested = fixture({ under: join(outer.root, ".claude", "worktrees.noindex", "some-branch") });
    const data = outer.data;
    runOnce({ bin: nested.bin, data, root: nested.root });
    expect(existsSync(mirrorRoot({ data, root: nested.root }))).toBe(true);
    utimesSync(
      join(mirrorRoot({ data, root: nested.root }), ".last-sync"),
      LAST_BOOTED_A_MONTH_AGO,
      LAST_BOOTED_A_MONTH_AGO,
    );

    runOnce({ bin: outer.bin, data, root: outer.root });

    // The marker is the exact witness: the sweep removes it, so its absence says the walk REACHED this
    // root. Under a `-maxdepth` bound derived from the booting root's own key it is still standing, which
    // is the regression this case exists to catch.
    expect(existsSync(join(mirrorRoot({ data, root: nested.root }), ".last-sync"))).toBe(false);
    expect(existsSync(join(mirrorRoot({ data, root: nested.root }), ".slot-a"))).toBe(false);
    expect(existsSync(join(mirrorRoot({ data, root: outer.root }), ".last-sync"))).toBe(true);
  });
});
