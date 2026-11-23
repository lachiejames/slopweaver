/**
 * Every spelling canon uses for an owner-turn anchor resolves to the same lookup key — and one that cites
 * no owner-turn file is refused with the reason rather than looked up and reported empty.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { resolveOwnerTurnRef } from "../../../../store/fleet/ownerTurnAnchor.js";

const HOME = "/Users/someone/.slopweaver";
const PATH = "supervisor-scratch/handoff-9257/owner-turn-257-1.txt";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("resolveOwnerTurnRef", () => {
  it.each([
    [`~/.slopweaver/${PATH}`],
    [`$SLOPWEAVER_HOME/${PATH}`],
    [`${HOME}/${PATH}`],
    [PATH],
    [`${PATH}#card-7`],
    [`file://${HOME}/${PATH}`],
    [`state:${PATH}`],
  ])("reads %s as the one path under the home", (ref) => {
    expect(unwrap(resolveOwnerTurnRef({ home: HOME, ref }))).toEqual({ kind: "path", relativePath: PATH });
  });

  it.each([["257-1"], ["owner-turn-257-1"], ["owner-turn-257-1.txt"], [" 257-1 "]])(
    "reads %s as the turn label",
    (ref) => {
      expect(unwrap(resolveOwnerTurnRef({ home: HOME, ref }))).toEqual({ kind: "turn", turn: "257-1" });
    },
  );

  it("refuses a transcript anchor, which cites no file", () => {
    const error = unwrapErr(resolveOwnerTurnRef({ home: HOME, ref: "transcript:a0000007#33dac8fe" }));

    expect(error.code).toBe("UNSTORABLE_TURN_FILE");
    expect(error.message).toContain("names a transcript or other record, not a file");
  });

  it("reads an absolute path spelled through the home's real path, the file itself long gone", () => {
    const dir = mkdtempSync(join(tmpdir(), "owner-turn-anchor-"));
    dirs.push(dir);
    const real = join(dir, "real-home");
    mkdirSync(real);
    const linked = join(dir, "linked-home");
    symlinkSync(real, linked);

    expect(unwrap(resolveOwnerTurnRef({ home: linked, ref: join(real, PATH) }))).toEqual({
      kind: "path",
      relativePath: PATH,
    });
  });

  it("refuses an absolute path outside the home", () => {
    const error = unwrapErr(resolveOwnerTurnRef({ home: HOME, ref: "/elsewhere/owner-turn-257-1.txt" }));

    expect(error.message).toContain(`it is outside the state home ${HOME}`);
  });

  it("refuses a relative path that climbs out of the home", () => {
    const error = unwrapErr(resolveOwnerTurnRef({ home: HOME, ref: "../owner-turn-257-1.txt/x" }));

    expect(error.message).toContain("outside the state home");
  });

  it("refuses a path under the home that is not where an owner turn lives", () => {
    const error = unwrapErr(resolveOwnerTurnRef({ home: HOME, ref: "handovers/owner-turn-257-1.txt" }));

    expect(error.message).toContain("not an owner-turn-*.txt file under handovers/archive/");
  });

  it("refuses a bare .txt that is not an owner-turn file", () => {
    const error = unwrapErr(resolveOwnerTurnRef({ home: HOME, ref: "notes.txt" }));

    expect(error.message).toContain("a .txt file not named owner-turn-*.txt");
  });

  it("refuses an empty anchor", () => {
    const error = unwrapErr(resolveOwnerTurnRef({ home: HOME, ref: "#only-a-fragment" }));

    expect(error.message).toContain("the anchor is empty");
  });
});
