/**
 * What a finished `cmux spawn` opened for a Recovery press: a seat the spawn left open is a chair to watch whatever
 * its exit code, never one refused.
 */
import { describe, expect, it } from "vitest";

import { spawnedChairOf } from "../../../../../cli/commands/fleet/recoverChair.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const SLUG = "fresh-supervisor-handoff-9041";

describe("spawnedChairOf", () => {
  it("opens the chair the ledger names after a clean spawn", () => {
    const opened = spawnedChairOf({ exitCode: 0, failure: "unused", sessionId: "chair-1", slug: SLUG });
    expect(opened.isOk()).toBe(true);
    expect(unwrap(opened)).toEqual({ sessionId: "chair-1", slug: SLUG });
  });

  it("opens the chair a non-zero spawn left open, so its row is never closed beside a running seat", () => {
    const opened = spawnedChairOf({
      exitCode: 1,
      failure: "the pickup was not proven submitted",
      sessionId: "chair-1",
      slug: SLUG,
    });
    expect(opened.isOk()).toBe(true);
    expect(unwrap(opened)).toEqual({ sessionId: "chair-1", slug: SLUG });
  });

  it("refuses with the spawn's own reason when it exited non-zero and left nothing open", () => {
    const opened = spawnedChairOf({
      exitCode: 1,
      failure: "the credential gate refused claude-1",
      sessionId: undefined,
      slug: SLUG,
    });
    expect(unwrapErr(opened)).toEqual({ reason: "the credential gate refused claude-1", slug: SLUG });
  });

  it("reports no chair for a clean exit with no ledger row, naming the slug the pass then asks the app about", () => {
    const opened = spawnedChairOf({ exitCode: 0, failure: "unused", sessionId: undefined, slug: SLUG });
    expect(unwrapErr(opened)).toEqual({
      reason: `the spawn exited 0 and the ledger names no open app session for ${SLUG}`,
      slug: SLUG,
    });
  });
});
