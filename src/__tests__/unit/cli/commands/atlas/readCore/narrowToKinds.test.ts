/*
 * `narrowToKinds`: every kind when none is asked for, and a refusal rather than an empty result for an unknown one.
 */
import { describe, expect, it } from "vitest";

import { narrowToKinds } from "../../../../../../cli/commands/atlas/readRun.js";
import { unwrap } from "../../../../../../lib/result.js";
import { snapshot } from "./harness.js";

describe("narrowToKinds", () => {
  it("returns every kind when none is asked for", () => {
    expect(unwrap(narrowToKinds({ kinds: [], snapshot: snapshot() })).length).toBe(1);
  });

  it("REFUSES an unknown kind rather than returning an empty result", () => {
    const refused = narrowToKinds({ kinds: ["gateway-policy"], snapshot: snapshot() });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("ATLAS_KIND_UNKNOWN");
  });
});
