/**
 * The walkthrough step's production hatch read: the unseen-review-threads hatch opens on exactly `1`.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { productionWalkthroughStepDeps } from "../../../../../cli/commands/github/walkthroughStepDeps.js";

const HATCH = "SLOPWEAVER_ALLOW_UNSEEN_REVIEW_THREADS";

let saved: string | undefined;

beforeEach(() => {
  saved = process.env[HATCH];
});

afterEach(() => {
  if (saved === undefined) {
    delete process.env[HATCH];
    return;
  }
  process.env[HATCH] = saved;
});

describe("productionWalkthroughStepDeps", () => {
  it("opens the unseen-review-threads hatch when it is set to 1", () => {
    process.env[HATCH] = "1";

    expect(productionWalkthroughStepDeps().unseenThreadsAllowed()).toBe(true);
  });

  it("keeps it shut when it is unset", () => {
    delete process.env[HATCH];

    expect(productionWalkthroughStepDeps().unseenThreadsAllowed()).toBe(false);
  });

  it("keeps it shut on any other value", () => {
    process.env[HATCH] = "true";

    expect(productionWalkthroughStepDeps().unseenThreadsAllowed()).toBe(false);
  });
});
