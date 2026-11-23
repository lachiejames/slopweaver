/**
 * The removal's last read of git's worktree list: a lock taken since the scan keeps the tree, and so does a listing
 * that cannot be read or no longer names it, because each is read before `node_modules` is moved aside.
 */
import { describe, expect, it } from "vitest";

import { lockHoldIn } from "../../../worktree/pruneRecheck.js";

const TREE = "/dev/acme/.claude/worktrees.noindex/feat";

describe("lockHoldIn", () => {
  it("lets an unlocked tree through", () => {
    const listing = `worktree /dev/acme\nHEAD a\nbranch refs/heads/main\n\nworktree ${TREE}\nHEAD b\nbranch refs/heads/feat`;
    expect(lockHoldIn({ listing, path: TREE })).toBe(null);
  });

  it("keeps a tree git lists as locked, with or without a reason", () => {
    const bare = `worktree ${TREE}\nHEAD b\nbranch refs/heads/feat\nlocked`;
    const reasoned = `worktree ${TREE}\nHEAD b\nbranch refs/heads/feat\nlocked a seat works here`;
    expect(lockHoldIn({ listing: bare, path: TREE })).toBe("locked by `git worktree lock` since the scan — kept");
    expect(lockHoldIn({ listing: reasoned, path: TREE })).toBe("locked by `git worktree lock` since the scan — kept");
  });

  it("matches the tree through the `worktrees` alias and a /private prefix", () => {
    const listing = `worktree /private${TREE}\nHEAD b\nbranch refs/heads/feat\nlocked`;
    expect(lockHoldIn({ listing, path: "/dev/acme/.claude/worktrees/feat" })).toBe(
      "locked by `git worktree lock` since the scan — kept",
    );
  });

  it("does not read another tree's lock as this one's", () => {
    const listing = `worktree ${TREE}-two\nHEAD c\nbranch refs/heads/two\nlocked\n\nworktree ${TREE}\nHEAD b\nbranch refs/heads/feat`;
    expect(lockHoldIn({ listing, path: TREE })).toBe(null);
  });

  it("keeps the tree when git could not be asked", () => {
    expect(lockHoldIn({ listing: null, path: TREE })).toBe(
      "git's worktree list could not be read just now, so a lock taken since the scan cannot be ruled out — kept",
    );
  });

  it("keeps a tree git no longer registers", () => {
    expect(lockHoldIn({ listing: "worktree /dev/acme\nHEAD a\nbranch refs/heads/main", path: TREE })).toBe(
      "git no longer registers it, so the next scan judges it — kept",
    );
  });
});
