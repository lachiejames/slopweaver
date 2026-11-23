/**
 * `productionSlackWriteDeps` — the real wiring behind `slopweaver slack post|reply`.
 *
 * Every other test in this lane passes fakes, so nothing exercised the factory itself: a seam dropped from
 * it typechecks, and the first thing that notices is production. These cases call it and ask the edges that
 * can be asked without a network — each against its own throwaway home, which is where a fresh install's
 * answers are the interesting ones.
 *
 * Filesystem only, and only inside a `mkdtempSync` home removed in `afterEach`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { productionSlackWriteDeps } from "../../../../../cli/commands/slack/writeWiring.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const homes: string[] = [];

/** A throwaway state home, removed after the case that minted it. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "write-wiring-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("productionSlackWriteDeps", () => {
  it("reads the door's environment from the process, so a hatch the operator exported is seen", () => {
    expect(productionSlackWriteDeps().doorEnv()["PATH"]).toBe(process.env["PATH"]);
  });

  it("answers no prompt conversation on an install that has configured none", () => {
    expect(productionSlackWriteDeps().promptChannel({ home: freshHome() })).toBe(undefined);
  });

  it("answers no owner id on an install that has configured none, so no destination reads as the owner's DM", () => {
    expect(productionSlackWriteDeps().ownerUserId({ home: freshHome() })).toBe(null);
  });

  it("answers no approved scheduled channels on an install with no recipe rows", () => {
    expect(productionSlackWriteDeps().approvedScheduledChannels({ home: freshHome() })).toEqual([]);
  });

  it("answers no exact voice rules on a fresh install", () => {
    expect(unwrap(productionSlackWriteDeps().voiceRules({ home: freshHome() }))).toEqual([]);
  });

  it("answers a CORRUPT profile as the failure it is, never as no voice rules", () => {
    const home = freshHome();
    writeFileSync(join(home, "profile.json"), "{", "utf8");
    expect(unwrapErr(productionSlackWriteDeps().voiceRules({ home })).code).toBe("PROFILE_UNREADABLE");
  });

  it("reads a capture off disk as bytes keyed by its own filename", async () => {
    const home = freshHome();
    const path = join(home, "shot.png");
    writeFileSync(path, "not really a png");
    const upload = await productionSlackWriteDeps().readMedia({ path });
    expect(upload.filename).toBe("shot.png");
    expect(new TextDecoder().decode(upload.bytes)).toBe("not really a png");
  });
});
