/**
 * `planRelay` and the pointer line — pure, so the inline/file boundary and the line's own length are plain calls.
 *
 * The failing length is a past relay's own: 1,418 characters, of which the seat received the first
 * 96 and the last 400 (`cmux/relayFile.ts`'s header).
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  pastesWhole,
  planRelay,
  RELAY_INLINE_MAX_CHARS,
  RelayFileErrors,
  relayFilePath,
  relayPointerLine,
} from "../../../cmux/relayFile.js";

/** The length of the relay that lost 922 characters from its middle. */
const FAILED_RELAY_CHARS = 1418;

describe("planRelay", () => {
  it("pastes inline the longest relay whose paste, newline included, is exactly the limit", () => {
    expect(planRelay({ text: "x".repeat(RELAY_INLINE_MAX_CHARS - 1) })).toEqual({ kind: "inline" });
  });

  it("sends a relay of exactly the limit as a file, because its newline would carry the paste over", () => {
    expect(planRelay({ text: "x".repeat(RELAY_INLINE_MAX_CHARS) }).kind).toBe("file");
  });

  it("sends the length that lost its middle as a file, carrying its length and a hex digest", () => {
    const plan = planRelay({ text: "y".repeat(FAILED_RELAY_CHARS) });

    expect(plan).toEqual({
      chars: FAILED_RELAY_CHARS,
      kind: "file",
      sha256: "2db7a9ff8bd2e45f9962ec46dfe4b4857cd144f215e9c9fcc967ceaa7c17035e",
    });
  });
});

describe("relayFilePath", () => {
  it("names the file for the instant and the digest prefix, inside the relay directory", () => {
    expect(
      relayFilePath({
        nowIso: "2026-09-21T03:16:52.928Z",
        relaysDir: "/state/cmux-relays",
        sha256: "abcdef0123456789".repeat(4),
      }),
    ).toBe("/state/cmux-relays/20260921T031652Z-abcdef012345.txt");
  });

  it("is absolute even for a relative relay directory, so a session in another directory can open it", () => {
    const path = relayFilePath({
      nowIso: "2026-09-21T03:16:52.928Z",
      relaysDir: "relays-home/cmux-relays",
      sha256: "abcdef0123456789".repeat(4),
    });

    expect(path).toBe(join(process.cwd(), "relays-home/cmux-relays/20260921T031652Z-abcdef012345.txt"));
  });
});

describe("relayPointerLine", () => {
  it("names the path, the length and the digest prefix, and stays well under the inline limit", () => {
    const path = "/Users/someone/.slopweaver/cmux-relays/20260921T031652Z-abcdef012345.txt";
    const line = relayPointerLine({ chars: FAILED_RELAY_CHARS, path, sha256: "abcdef0123456789".repeat(4) });

    expect(line).toBe(
      "Relay of 1418 characters, sent as a file because a paste this long can silently lose its middle. " +
        `Read ALL of it before acting: ${path} (sha256 abcdef012345)`,
    );
    expect(line.length).toBeLessThan(RELAY_INLINE_MAX_CHARS / 2);
  });
});

describe("pastesWhole", () => {
  it("counts the newline sendLine appends, so a line one short of the limit is the longest that passes", () => {
    expect(pastesWhole({ line: "p".repeat(RELAY_INLINE_MAX_CHARS - 1) })).toBe(true);
    expect(pastesWhole({ line: "p".repeat(RELAY_INLINE_MAX_CHARS) })).toBe(false);
  });
});

describe("RelayFileErrors", () => {
  it("says nothing was typed and names the path alternative, in every refusal", () => {
    const refusals = [
      RelayFileErrors.io({ chars: FAILED_RELAY_CHARS, detail: "ENOTDIR", path: "/state/cmux-relays/r.txt" }),
      RelayFileErrors.mismatch({ chars: FAILED_RELAY_CHARS, path: "/state/cmux-relays/r.txt" }),
      RelayFileErrors.pointerTooLong({
        chars: FAILED_RELAY_CHARS,
        path: "/state/cmux-relays/r.txt",
        pointerChars: 900,
      }),
    ];

    expect(refusals.map((refusal) => refusal.code)).toEqual([
      "RELAY_FILE_IO",
      "RELAY_FILE_MISMATCH",
      "RELAY_POINTER_TOO_LONG",
    ]);
    expect(refusals.filter((refusal) => !refusal.message.includes("NOTHING was typed"))).toEqual([]);
    expect(refusals.filter((refusal) => !refusal.message.includes("send one line naming its absolute path"))).toEqual(
      [],
    );
    expect(refusals[0]!.message).toContain("over the 800 a paste carries whole (its newline included)");
  });
});
