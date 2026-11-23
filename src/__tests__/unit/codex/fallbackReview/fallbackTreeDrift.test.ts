/*
 * `fallbackTreeDrift`: no drift is reported while the checkout's HEAD and fingerprint both match the request's.
 */
import { describe, expect, it } from "vitest";

import { fallbackTreeDrift } from "../../../../codex/fallbackReview.js";
import { CLEAN_NOW, request } from "./harness.js";

describe("fallbackTreeDrift", () => {
  it("is undefined when HEAD and fingerprint both match", () => {
    expect(fallbackTreeDrift({ now: CLEAN_NOW, request: request() })).toBeUndefined();
  });
});
