/**
 * Unit: the claim one `gmail draft --board` press holds on a mail while it talks to Gmail, and the release that
 * removes only this press's own claim. Filesystem only, in a throwaway home; liveness is a plain injected function,
 * and a concurrent press is a write placed through the release's `interleave` seam.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { boardDraftsDir, recordDrafted } from "../../../../../cli/commands/gmail/boardDraft.js";
import { claimBoardDraft, releaseBoardDraft } from "../../../../../cli/commands/gmail/boardDraftClaim.js";

const SLUG = "iso-compliance-mail";
const DIGEST = "7e1e324125e4d424";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "board-claim-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("claimBoardDraft", () => {
  it("takes a free claim, and refuses a second one while its live holder is still drafting", () => {
    const first = claimBoardDraft({ alive: () => true, digest: DIGEST, home, pid: 111, slug: SLUG });
    expect(first.isOk()).toBe(true);
    const second = claimBoardDraft({ alive: () => true, digest: DIGEST, home, pid: 222, slug: SLUG });
    expect(second._unsafeUnwrapErr().code).toBe("IN_FLIGHT");
    expect(second._unsafeUnwrapErr().message).toContain("by process 111");
  });

  it("is free again once released, and a second release of the same claim is a no-op", () => {
    const claim = claimBoardDraft({ alive: () => true, digest: DIGEST, home, pid: 111, slug: SLUG })._unsafeUnwrap();
    expect(releaseBoardDraft({ claim })).toBe(true);
    expect(releaseBoardDraft({ claim })).toBe(false);
    expect(claimBoardDraft({ alive: () => true, digest: DIGEST, home, pid: 222, slug: SLUG }).isOk()).toBe(true);
  });

  it("refuses a claim whose holder died as ABANDONED, never taking it over, and names the file to remove", () => {
    claimBoardDraft({ alive: () => true, digest: DIGEST, home, pid: 111, slug: SLUG });
    const after = claimBoardDraft({ alive: () => false, digest: DIGEST, home, pid: 222, slug: SLUG });
    expect(after._unsafeUnwrapErr().code).toBe("CLAIM_ABANDONED");
    expect(after._unsafeUnwrapErr().message).toContain(join(boardDraftsDir({ home }), `${SLUG}.${DIGEST}.claim`));
  });

  it("refuses a claim that names no holder yet rather than treating it as dead", () => {
    const path = join(boardDraftsDir({ home }), `${SLUG}.${DIGEST}.claim`);
    claimBoardDraft({ alive: () => true, digest: DIGEST, home, pid: 111, slug: SLUG });
    writeFileSync(path, "");
    const after = claimBoardDraft({ alive: () => false, digest: DIGEST, home, pid: 222, slug: SLUG });
    expect(after._unsafeUnwrapErr().code).toBe("CLAIM_UNWRITTEN");
  });

  it("refuses as already drafted when a press finished between the first check and this claim, and lets go", () => {
    recordDrafted({ atIso: "2026-09-23T05:00:00.000Z", digest: DIGEST, draftId: "r-9", home, slug: SLUG });
    const claimed = claimBoardDraft({ alive: () => true, digest: DIGEST, home, pid: 111, slug: SLUG });
    expect(claimed._unsafeUnwrapErr().code).toBe("ALREADY_DRAFTED");
    expect(
      claimBoardDraft({ alive: () => true, digest: DIGEST, home, pid: 222, slug: SLUG })._unsafeUnwrapErr().code,
    ).toBe("ALREADY_DRAFTED");
  });
});

describe("releaseBoardDraft removes only this press's own claim", () => {
  const path = (): string => join(boardDraftsDir({ home }), `${SLUG}.${DIGEST}.claim`);

  /** Every file in the drafts directory, so a left-behind aside copy is seen. */
  const draftFiles = (): readonly string[] => readdirSync(boardDraftsDir({ home })).toSorted();

  it("leaves a claim another press now holds exactly as it found it", () => {
    const mine = claimBoardDraft({ alive: () => true, digest: DIGEST, home, pid: 111, slug: SLUG })._unsafeUnwrap();
    writeFileSync(path(), `${JSON.stringify({ claimId: "another-press", pid: 222 })}\n`);
    expect(releaseBoardDraft({ claim: mine })).toBe(false);
    expect(readFileSync(path(), "utf8")).toBe(`${JSON.stringify({ claimId: "another-press", pid: 222 })}\n`);
    expect(draftFiles()).toEqual([`${SLUG}.${DIGEST}.claim`]);
  });

  it("restores another press's claim that replaced this one just before the move aside", () => {
    const mine = claimBoardDraft({ alive: () => true, digest: DIGEST, home, pid: 111, slug: SLUG })._unsafeUnwrap();
    const released = releaseBoardDraft({
      claim: mine,
      interleave: ({ stage }) => {
        if (stage === "before-claim") {
          rmSync(path());
          writeFileSync(path(), `${JSON.stringify({ claimId: "another-press", pid: 222 })}\n`);
        }
      },
    });
    expect(released).toBe(false);
    expect(JSON.parse(readFileSync(path(), "utf8"))).toEqual({ claimId: "another-press", pid: 222 });
    expect(draftFiles()).toEqual([`${SLUG}.${DIGEST}.claim`]);
  });

  it("never overwrites a newer claim written to the path after the move aside, and drops its own aside copy", () => {
    const mine = claimBoardDraft({ alive: () => true, digest: DIGEST, home, pid: 111, slug: SLUG })._unsafeUnwrap();
    const released = releaseBoardDraft({
      claim: mine,
      interleave: ({ stage }) => {
        if (stage === "after-claim") {
          writeFileSync(path(), `${JSON.stringify({ claimId: "newer-press", pid: 333 })}\n`);
        }
      },
    });
    expect(released).toBe(true);
    expect(JSON.parse(readFileSync(path(), "utf8"))).toEqual({ claimId: "newer-press", pid: 333 });
    expect(draftFiles()).toEqual([`${SLUG}.${DIGEST}.claim`]);
  });

  it("keeps a foreign claim's newer replacement when both raced the release, leaving no aside copy", () => {
    const mine = claimBoardDraft({ alive: () => true, digest: DIGEST, home, pid: 111, slug: SLUG })._unsafeUnwrap();
    const released = releaseBoardDraft({
      claim: mine,
      interleave: ({ stage }) => {
        if (stage === "before-claim") {
          rmSync(path());
          writeFileSync(path(), `${JSON.stringify({ claimId: "another-press", pid: 222 })}\n`);
        }
        if (stage === "after-claim") {
          writeFileSync(path(), `${JSON.stringify({ claimId: "newer-press", pid: 333 })}\n`);
        }
      },
    });
    expect(released).toBe(false);
    expect(JSON.parse(readFileSync(path(), "utf8"))).toEqual({ claimId: "newer-press", pid: 333 });
    expect(draftFiles()).toEqual([`${SLUG}.${DIGEST}.claim`]);
  });
});
