import { describe, expect, it } from "vitest";

import { doorCommand, runDoor, runDoorWith } from "../../../../../cli/commands/dev/door.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { memoryDoorLedger, unreachableDoorLedger } from "../../../../doorLedgerFixture.js";

function argv({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "slopweaver", "dev", ...tail];
}

/** The fixture home a simulated decision names; the in-memory store is what records it. */
const HOME = "/fixture/home";

describe("runDoor", () => {
  it("exits OK on --help", async () => {
    expect(await runDoor(argv({ tail: ["door", "--help"] }))).toBe(EXIT_OK);
  });

  it("REFUSES a bare invocation rather than picking a mode for you", async () => {
    expect(await runDoor(argv({ tail: ["door"] }))).toBe(EXIT_USAGE);
  });

  it("REFUSES an unrecognised --simulate mode instead of treating it as pass", async () => {
    // Silently coercing an unknown mode would make the door report a decision it never made.
    expect(await runDoor(argv({ tail: ["door", "--simulate", "definitely-not-a-mode"] }))).toBe(EXIT_USAGE);
  });

  it("simulates a pass decision and records it in the store", async () => {
    const door = memoryDoorLedger();
    const code = await runDoorWith({
      argv: argv({ tail: ["door", "--simulate", "pass", "--home", HOME] }),
      ledger: door.port,
    });
    expect(code).toBe(EXIT_OK);
    expect(door.records().map((record) => [record["runId"], record["status"]])).toStrictEqual([
      ["door-demo-pass", "pass"],
    ]);
  });

  it("REFUSES to report a simulated decision the store could not record", async () => {
    const code = await runDoorWith({
      argv: argv({ tail: ["door", "--simulate", "pass", "--home", HOME] }),
      ledger: unreachableDoorLedger(),
    });
    expect(code).toBe(EXIT_ERROR);
  });
});

describe("runDoor --refusals", () => {
  it("reads an empty store as no refusals", async () => {
    const code = await runDoorWith({
      argv: argv({ tail: ["door", "--refusals", "--home", HOME] }),
      ledger: memoryDoorLedger().port,
    });
    expect(code).toBe(EXIT_OK);
  });

  it("is an error, never an empty answer, when the store is down", async () => {
    const code = await runDoorWith({
      argv: argv({ tail: ["door", "--refusals", "--home", HOME] }),
      ledger: unreachableDoorLedger(),
    });
    expect(code).toBe(EXIT_ERROR);
  });
});

describe("runDoor --raw", () => {
  it("BLOCKS a destructive raw command with no escape set", async () => {
    expect(await runDoor(argv({ tail: ["door", "--raw", "git push"] }))).toBe(EXIT_ERROR);
  });

  it("ALLOWS a destructive raw command under a command-scoped inline escape", async () => {
    expect(await runDoor(argv({ tail: ["door", "--raw", "SLOPWEAVER_ALLOW_RAW=1 git push"] }))).toBe(EXIT_OK);
  });

  it("does not treat the wrong inline escape value as armed", async () => {
    expect(await runDoor(argv({ tail: ["door", "--raw", "SLOPWEAVER_ALLOW_RAW=0 git push"] }))).toBe(EXIT_ERROR);
  });
});

describe("the manifest-selected handler", () => {
  it("is the run function itself, carrying no metadata of its own", () => {
    expect(doorCommand).toBe(runDoor);
    expect(Object.hasOwn(doorCommand, "meta")).toBe(false);
  });
});
