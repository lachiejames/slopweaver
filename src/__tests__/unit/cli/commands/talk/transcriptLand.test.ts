/**
 * Landing one call's utterances under the ledger's lock: a call with nothing said lands nothing and fails nothing,
 * and a call that cannot be read is reported as a failure for the next batch to retry, never thrown.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { landCall } from "../../../../../cli/commands/talk/transcriptLand.js";
import { TalkErrors } from "../../../../../talk/errors.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const homeOf = (): string => {
  const home = mkdtempSync(join(tmpdir(), "sw-transcript-land-"));
  dirs.push(home);
  return home;
};

describe("landCall", () => {
  it("lands nothing and fails nothing for a call with no file yet", async () => {
    const home = homeOf();
    const callId = "a0000090-0000-4000-8000-000000000097";
    expect(await landCall({ callId, ended: true, handoverDir: join(home, "handovers"), home })).toEqual({
      failed: [],
      landed: 0,
    });
  });

  it("reports a call id that names no call as a failed landing", async () => {
    const home = homeOf();
    const callId = "not-a-call";
    expect(await landCall({ callId, ended: false, handoverDir: join(home, "handovers"), home })).toEqual({
      failed: [`any card: ${TalkErrors.callInvalid({ callId }).message}`],
      landed: 0,
    });
  });
});
