/**
 * Which entries of a pool directory block its removal: anything the pool itself does not write.
 */
import { describe, expect, it } from "vitest";

import { unexpectedPoolEntries } from "../../../codex/snapshotPoolReclaim.js";

describe("unexpectedPoolEntries", () => {
  it("passes the identity file and every slot under the cap", () => {
    expect(unexpectedPoolEntries({ entries: ["common-dir", "slot-0", "slot-7"] })).toEqual([]);
  });

  it("names a mint in flight, a half-written identity, and a slot past the cap", () => {
    expect(
      unexpectedPoolEntries({ entries: ["common-dir", ".mint-abc", ".identity-xyz", "slot-8", "slot-0"] }),
    ).toEqual([".mint-abc", ".identity-xyz", "slot-8"]);
  });

  it("passes an empty directory", () => {
    expect(unexpectedPoolEntries({ entries: [] })).toEqual([]);
  });
});
