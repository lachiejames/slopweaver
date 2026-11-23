/**
 * The two ask lookups `--json` makes before it draws a row's action: no action off a run that is not parked on
 * the owner, and no mail preview without a mail action. The whole row is `unit/handover/listJson/`.
 */
import { describe, expect, it } from "vitest";

import { actionOf, mailPreviewFor } from "../../../../../cli/commands/handover/listJsonAsk.js";

describe("actionOf", () => {
  it("offers no action off a run that never started", () => {
    expect(actionOf({ run: { kind: "never-started" } })).toBe(undefined);
  });

  it("offers no action off a run still active", () => {
    expect(actionOf({ run: { kind: "active" } })).toBe(undefined);
  });
});

describe("mailPreviewFor", () => {
  it("previews nothing when the ask offers no action", () => {
    expect(mailPreviewFor({ action: undefined, slug: "a-row" })).toBe(undefined);
  });
});
