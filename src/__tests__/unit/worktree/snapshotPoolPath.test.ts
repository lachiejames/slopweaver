import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseOperationalWorktrees, parseWorktreeListPorcelain } from "../../../cmux/worktreeList.js";
import {
  isSnapshotPoolSlot,
  isSnapshotPoolTree,
  SNAPSHOT_POOL_DIR,
  SNAPSHOT_POOL_IDENTITY_FILE,
  SNAPSHOT_POOL_SLOTS,
  snapshotPoolRoot,
} from "../../../worktree/snapshotPoolPath.js";

const SLOT_TREE = "/private/var/folders/x/T/slopweaver-snap-pool/0123456789abcdef/slot-3/tree";

describe("snapshotPoolRoot", () => {
  it("keys one repository's pool by a 16-hex digest of its common git dir", () => {
    const root = snapshotPoolRoot({ commonGitDir: "/repo/.git", poolParent: "/tmp" });

    expect(root).toMatch(new RegExp(`^/tmp/${SNAPSHOT_POOL_DIR}/[0-9a-f]{16}$`));
    expect(snapshotPoolRoot({ commonGitDir: "/repo/.git", poolParent: "/tmp" })).toBe(root);
  });

  it("gives two repositories two pools", () => {
    const one = snapshotPoolRoot({ commonGitDir: "/one/.git", poolParent: "/tmp" });
    const two = snapshotPoolRoot({ commonGitDir: "/two/.git", poolParent: "/tmp" });

    expect(one === two).toBe(false);
  });

  it("caps a pool at eight slots", () => {
    expect(SNAPSHOT_POOL_SLOTS).toBe(8);
  });
});

describe("isSnapshotPoolTree", () => {
  it("recognises a slot's tree, with or without a trailing slash", () => {
    expect(isSnapshotPoolTree({ path: SLOT_TREE })).toBe(true);
    expect(isSnapshotPoolTree({ path: `${SLOT_TREE}/` })).toBe(true);
  });

  it("recognises the tree of a path snapshotPoolRoot built", () => {
    const root = snapshotPoolRoot({ commonGitDir: "/repo/.git", poolParent: "/tmp" });

    expect(isSnapshotPoolTree({ path: `${root}/slot-0/tree` })).toBe(true);
  });

  it("leaves every near miss visible", () => {
    const misses = [
      "/private/var/folders/x/T/slopweaver-snap-AbC123/tree",
      "/private/var/folders/x/T/slopweaver-snap-pool/0123456789abcdef/slot-3",
      "/private/var/folders/x/T/slopweaver-snap-pool/0123456789abcdef/slot-3/tree/src",
      "/private/var/folders/x/T/slopweaver-snap-pool/0123456789ABCDEF/slot-3/tree",
      "/private/var/folders/x/T/slopweaver-snap-pool/0123456789abcde/slot-3/tree",
      "/Users/me/dev/repo/.claude/worktrees.noindex/tree",
    ];

    expect(misses.filter((path) => isSnapshotPoolTree({ path }))).toEqual([]);
  });
});

describe("isSnapshotPoolSlot and parseOperationalWorktrees", () => {
  let parent: string;

  beforeEach(() => {
    parent = mkdtempSync(join(tmpdir(), "pool-reader-"));
  });

  afterEach(() => {
    rmSync(parent, { force: true, recursive: true });
  });

  /** A slot tree path under a pool root, with the pool's own files on disk only when `minted`. */
  const slotTree = ({ minted, slot }: { minted: boolean; slot: string }): string => {
    const poolRoot = snapshotPoolRoot({ commonGitDir: "/repo/.git", poolParent: parent });
    mkdirSync(join(poolRoot, slot, "tree"), { recursive: true });
    if (minted) {
      writeFileSync(join(poolRoot, SNAPSHOT_POOL_IDENTITY_FILE), "/repo/.git");
      writeFileSync(join(poolRoot, slot, "state.free"), "");
    }
    return join(poolRoot, slot, "tree");
  };

  it("drops only a slot the pool minted, keeping order and every other worktree", () => {
    const minted = slotTree({ minted: true, slot: "slot-0" });
    const text = [
      "worktree /Users/me/dev/repo\nHEAD aaaa\nbranch refs/heads/main",
      `worktree ${minted}\nHEAD bbbb\ndetached`,
      "worktree /private/var/folders/x/T/slopweaver-snap-AbC123/tree\nHEAD cccc\ndetached",
      "worktree /Users/me/dev/repo/.claude/worktrees.noindex/feature\nHEAD dddd\nbranch refs/heads/feature",
    ].join("\n\n");

    expect(parseWorktreeListPorcelain({ text })).toHaveLength(4);
    expect(parseOperationalWorktrees({ repository: null, text }).map((worktree) => worktree.path)).toEqual([
      "/Users/me/dev/repo",
      "/private/var/folders/x/T/slopweaver-snap-AbC123/tree",
      "/Users/me/dev/repo/.claude/worktrees.noindex/feature",
    ]);
  });

  it("keeps a worktree on a branch even at a minted slot's path", () => {
    const minted = slotTree({ minted: true, slot: "slot-2" });
    const text = `worktree ${minted}\nHEAD bbbb\nbranch refs/heads/topic`;

    expect(isSnapshotPoolSlot({ path: minted })).toBe(true);
    expect(parseOperationalWorktrees({ repository: null, text }).map((worktree) => worktree.branch)).toEqual(["topic"]);
  });

  it("keeps a bare record at a minted slot's path, since git did not call it detached", () => {
    const minted = slotTree({ minted: true, slot: "slot-7" });
    const text = `worktree ${minted}\nbare`;

    expect(isSnapshotPoolSlot({ path: minted })).toBe(true);
    expect(parseOperationalWorktrees({ repository: null, text }).map((worktree) => worktree.path)).toEqual([minted]);
  });

  it("keeps a worktree whose path is a minted slot's plus a trailing space", () => {
    const minted = slotTree({ minted: true, slot: "slot-6" });
    const text = `worktree ${minted} \nHEAD bbbb\ndetached`;

    expect(parseOperationalWorktrees({ repository: null, text }).map((worktree) => worktree.path)).toEqual([
      `${minted} `,
    ]);
  });

  it("keeps an ordinary worktree placed at a pool-shaped path the pool never minted", () => {
    const lookalike = slotTree({ minted: false, slot: "slot-3" });
    const text = `worktree ${lookalike}\nHEAD bbbb\ndetached`;

    expect(isSnapshotPoolTree({ path: lookalike })).toBe(true);
    expect(isSnapshotPoolSlot({ path: lookalike })).toBe(false);
    expect(parseOperationalWorktrees({ repository: null, text }).map((worktree) => worktree.path)).toEqual([lookalike]);
  });

  it("keeps a worktree beside forged pool files: an index past the cap or zero-padded, a stray marker, a mismatched identity", () => {
    const poolRoot = snapshotPoolRoot({ commonGitDir: "/repo/.git", poolParent: parent });
    const forge = ({ marker, slot }: { marker: string; slot: string }): string => {
      mkdirSync(join(poolRoot, slot, "tree"), { recursive: true });
      writeFileSync(join(poolRoot, slot, marker), "");
      return join(poolRoot, slot, "tree");
    };
    mkdirSync(poolRoot, { recursive: true });
    writeFileSync(join(poolRoot, SNAPSHOT_POOL_IDENTITY_FILE), "/repo/.git");
    const pastCap = forge({ marker: "state.free", slot: "slot-99" });
    const leadingZero = forge({ marker: "state.free", slot: "slot-00" });
    const notAUuid = forge({ marker: `state.busy.123.000000000000.${"0".repeat(36)}`, slot: "slot-1" });
    const strayMarker = forge({ marker: "state.anything", slot: "slot-2" });
    const twoMarkers = forge({ marker: "state.free", slot: "slot-4" });
    writeFileSync(join(poolRoot, "slot-4", "state.busy.1.000000000000.00000000-0000-4000-8000-000000000000"), "");
    const genuine = forge({ marker: "state.free", slot: "slot-5" });
    // Read while the identity still matches, so each forgery is refused for its own reason.
    const hidden = [pastCap, leadingZero, notAUuid, strayMarker, twoMarkers].filter((path) =>
      isSnapshotPoolSlot({ path }),
    );
    const genuineBefore = isSnapshotPoolSlot({ path: genuine });
    writeFileSync(join(poolRoot, SNAPSHOT_POOL_IDENTITY_FILE), "/another/.git");

    expect(hidden).toEqual([]);
    expect(genuineBefore).toBe(true);
    expect(isSnapshotPoolSlot({ path: genuine })).toBe(false);
  });

  it("recognises a minted slot with or without a trailing slash, and a missing one as no slot", () => {
    const minted = slotTree({ minted: true, slot: "slot-1" });

    expect(isSnapshotPoolSlot({ path: minted })).toBe(true);
    expect(isSnapshotPoolSlot({ path: `${minted}/` })).toBe(true);
    expect(isSnapshotPoolSlot({ path: SLOT_TREE })).toBe(false);
  });
});
