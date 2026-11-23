/**
 * `slopweaver turn resume --dispatch --failed` — the worker's own give-up recorded as the durable FAILED marker,
 * and the usage and missing-record refusals around it.
 */
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runTurnResume } from "../../../../../../cli/commands/turn/resume.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../../../../../cli/exitCodes.js";
import { readCurrentGenerationTurnMarker } from "../../../../../../live/turn/turnMarkerStore.js";
import { removeFixtureDirs } from "../dispatch/harness.js";
import { ASK_IDENTITY, DISPATCH_ID } from "./fixtures.js";
import { dispatchedFixture, writeRecord } from "./harness.js";

afterEach(removeFixtureDirs);

describe("turn resume --dispatch --failed", () => {
  it("records the worker's own failure as the durable FAILED marker and exits OK — the report landed", () => {
    const { briefPath, home } = dispatchedFixture();
    writeRecord({ briefPath, home });

    const code = runTurnResume([
      "node",
      "slopweaver",
      "turn",
      "resume",
      "--dispatch",
      DISPATCH_ID,
      "--failed",
      "the vendor portal needs a login this session does not have",
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_OK);
    expect(readCurrentGenerationTurnMarker({ askIdentity: ASK_IDENTITY, home })).toStrictEqual({
      dispatchId: DISPATCH_ID,
      kind: "failed",
      leaseExpiresAt: "2099-01-01T00:00:00.000Z",
      reason: "the vendor portal needs a login this session does not have",
    });
  });

  it("refuses a blank reason — a failure nobody can act on is not a report", () => {
    const { briefPath, home } = dispatchedFixture();
    writeRecord({ briefPath, home });

    const code = runTurnResume([
      "node",
      "slopweaver",
      "turn",
      "resume",
      "--dispatch",
      DISPATCH_ID,
      "--failed",
      "  ",
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_USAGE);
    expect(readCurrentGenerationTurnMarker({ askIdentity: ASK_IDENTITY, home })).toBeUndefined();
  });

  it("refuses --answer and --failed together — two endings, one call", () => {
    const { briefPath, home } = dispatchedFixture();
    writeRecord({ briefPath, home });

    const code = runTurnResume([
      "node",
      "slopweaver",
      "turn",
      "resume",
      "--dispatch",
      DISPATCH_ID,
      "--answer",
      join(home, "answer.json"),
      "--failed",
      "x",
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_USAGE);
  });

  it("refuses when no dispatch record exists — there is no generation to report against", () => {
    const { home } = dispatchedFixture();

    const code = runTurnResume([
      "node",
      "slopweaver",
      "turn",
      "resume",
      "--dispatch",
      DISPATCH_ID,
      "--failed",
      "x",
      "--home",
      home,
    ]);
    expect(code).toBe(EXIT_ERROR);
  });
});
