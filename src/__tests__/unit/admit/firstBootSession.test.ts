import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { firstBootSessionPath, firstBootSessionSeen, markFirstBootSession } from "../../../admit/firstBootSession.js";
import { readFirstBootEvidence } from "../../../admit/profileFirstBoot.js";
import { neverConfigured } from "../../../admit/profileHeld.js";
import { unwrap } from "../../../lib/result.js";

const homes: string[] = [];

/** A fresh home, removed after the test. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "first-boot-session-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("the first-boot session mark", () => {
  it("is seen for the session it marked and no other", () => {
    const home = join(tempHome(), "not-yet");
    const marked = markFirstBootSession({ homes: [home], sessionId: "s-1" });

    expect([
      marked,
      firstBootSessionSeen({ homes: [home], sessionIds: ["s-1"] }),
      firstBootSessionSeen({ homes: [home], sessionIds: ["s-2", "s-1"] }),
      firstBootSessionSeen({ homes: [home], sessionIds: ["s-2"] }),
    ]).toEqual([true, true, true, false]);
  });

  it("is written in every home named and found from any one of them", () => {
    // A call re-pointing its home at a default one missed a mark in the resolved home alone.
    const resolved = join(tempHome(), "state");
    const fallback = tempHome();

    expect([
      markFirstBootSession({ homes: [resolved, fallback, fallback], sessionId: "s-1" }),
      firstBootSessionSeen({ homes: [fallback], sessionIds: ["s-1"] }),
      firstBootSessionSeen({ homes: [resolved], sessionIds: ["s-1"] }),
      firstBootSessionSeen({ homes: [tempHome(), fallback], sessionIds: ["s-1"] }),
    ]).toEqual([true, true, true, true]);
  });

  it("is no configuration trace, so a marked home still reads as a first boot", () => {
    const home = tempHome();
    markFirstBootSession({ homes: [home], sessionId: "s-1" });

    expect(neverConfigured({ evidence: unwrap(readFirstBootEvidence({ homes: [home] })) })).toBe(true);
  });

  it("names no path, and writes nothing, for an id that is not a plain session id", () => {
    const home = tempHome();

    expect([
      firstBootSessionPath({ home, sessionId: "../escape" }),
      markFirstBootSession({ homes: [home], sessionId: "../escape" }),
      firstBootSessionSeen({ homes: [home], sessionIds: ["../escape"] }),
    ]).toEqual([undefined, false, false]);
  });

  it("reads a mark whose presence cannot be settled as present, and reports one it could not write", () => {
    const home = tempHome();
    mkdirSync(join(home, "profile"));
    writeFileSync(join(home, "profile", "first-boot"), "");

    expect([
      firstBootSessionSeen({ homes: [home], sessionIds: ["s-1"] }),
      markFirstBootSession({ homes: [home], sessionId: "s-1" }),
    ]).toEqual([true, false]);
  });

  it("never writes through a link at the mark's path, so the file it points at keeps its contents", () => {
    const home = tempHome();
    mkdirSync(join(home, "profile", "first-boot"), { recursive: true });
    writeFileSync(join(home, "profile", "owner-written"), "store-a\n");
    symlinkSync("../owner-written", join(home, "profile", "first-boot", "s-1"));

    expect([
      markFirstBootSession({ homes: [home], sessionId: "s-1" }),
      readFileSync(join(home, "profile", "owner-written"), "utf8"),
    ]).toEqual([false, "store-a\n"]);
  });

  it("leaves a mark already written in place, and says it is marked", () => {
    const home = tempHome();
    markFirstBootSession({ homes: [home], sessionId: "s-1" });

    expect(markFirstBootSession({ homes: [home], sessionId: "s-1" })).toBe(true);
  });
});
