import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { exampleTexts, fleetSignInExit } from "../../../../../cli/commands/handover/namedDraftAdmission.js";
import { EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("exampleTexts", () => {
  it("hands back every scene the card leads with", () => {
    expect(exampleTexts({ examples: { examples: ["one scene", "another scene"], kind: "examples" } })).toEqual([
      "one scene",
      "another scene",
    ]);
  });

  it("hands back nothing for a row with no examples", () => {
    expect(exampleTexts({ examples: undefined })).toEqual([]);
  });
});

describe("fleetSignInExit", () => {
  it("refuses a sign-in ask carried only in an example scene, with no look behind it", () => {
    const home = mkdtempSync(join(tmpdir(), "fsi-"));
    homes.push(home);
    const written: string[] = [];
    const scene = "You open the Queue and the fleet asks you to sign in to Datadog in the work Chrome.";

    const exit = fleetSignInExit({
      command: "slopweaver handover ask",
      env: {},
      home,
      nowIso: "2026-10-06T11:00:00.000Z",
      texts: [
        "Can the stack proceed?",
        ...exampleTexts({ examples: { examples: [scene], kind: "examples" } }),
        undefined,
      ],
      write: (line) => {
        written.push(line);
      },
    });

    expect(exit).toBe(EXIT_USAGE);
    expect(written.join("\n")).toContain("Datadog: no look stands behind it");
  });

  it("passes a card naming no Datadog or GitHub sign-in without reading the ledger", () => {
    const exit = fleetSignInExit({
      command: "slopweaver handover ask",
      env: {},
      home: "/nonexistent/home/never/read",
      nowIso: "2026-10-06T11:00:00.000Z",
      texts: ["Pick which dashboard the alert links to?", undefined],
      write: () => {},
    });

    expect(exit).toBeUndefined();
  });
});
