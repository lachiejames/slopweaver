import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseResyncCommand, resolveResyncSteps, resyncStepLine } from "../../../../live/resync/steps.js";

describe("parseResyncCommand", () => {
  it("reads the ordinary one-command shape", () => {
    expect(unwrap(parseResyncCommand({ command: "slopweaver atlas airtable sync" }))).toEqual([
      { argv: ["atlas", "airtable", "sync"] },
    ]);
  });

  it("keeps a compound command's steps in the order the descriptor declared them", () => {
    expect(
      unwrap(parseResyncCommand({ command: "slopweaver atlas clerk sync && slopweaver atlas clerk walk" })),
    ).toEqual([{ argv: ["atlas", "clerk", "sync"] }, { argv: ["atlas", "clerk", "walk"] }]);
  });

  it("never assumes the `atlas` noun, because three atlases sit under their own", () => {
    expect(unwrap(parseResyncCommand({ command: "slopweaver cloudflare sync" }))).toEqual([
      { argv: ["cloudflare", "sync"] },
    ]);
  });

  it("keeps a platform whose verb noun differs from its own name", () => {
    expect(unwrap(parseResyncCommand({ command: "slopweaver atlas slack-drive refresh" }))).toEqual([
      { argv: ["atlas", "slack-drive", "refresh"] },
    ]);
  });

  it("refuses a declaration carrying a placeholder a scheduled pass has nobody to fill in", () => {
    const parsed = parseResyncCommand({ command: "slopweaver atlas vanta control-evidence --control <id>" });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("carries the placeholder `<id>`");
  });

  it("refuses a command that does not start with the binary name", () => {
    const parsed = parseResyncCommand({ command: "atlas airtable sync" });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("does not start with `slopweaver`");
  });

  it("refuses a command naming fewer than a noun and a verb", () => {
    const parsed = parseResyncCommand({ command: "slopweaver doctor" });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr()[0]).toContain("names fewer than a noun and a verb");
  });

  it("refuses an empty declaration", () => {
    expect(unwrapErr(parseResyncCommand({ command: "  " }))).toEqual(["`  ` declares no command at all"]);
  });

  it("reports EVERY bad step rather than stopping at the first", () => {
    const parsed = parseResyncCommand({ command: "curl example.com && slopweaver x" });
    expect(parsed.isErr()).toBe(true);
    expect(parsed._unsafeUnwrapErr().length).toBe(2);
  });
});

describe("resolveResyncSteps", () => {
  it("accepts a command whose every step routes as a verb this build ships", () => {
    const steps = resolveResyncSteps({ command: "slopweaver atlas airtable sync" });
    expect(steps.isOk()).toBe(true);
    expect(unwrap(steps).length).toBe(1);
  });

  it("refuses a parsable command whose noun this build does not route", () => {
    const steps = resolveResyncSteps({ command: "slopweaver teleporter engage" });
    expect(steps.isErr()).toBe(true);
    expect(steps._unsafeUnwrapErr()[0]).toBe("`slopweaver teleporter engage` is not a verb this build routes");
  });

  it("refuses an `atlas <platform>` step naming a platform this build does not register", () => {
    const steps = resolveResyncSteps({ command: "slopweaver atlas nowhere sync" });
    expect(steps.isErr()).toBe(true);
    expect(steps._unsafeUnwrapErr()[0]).toBe("`slopweaver atlas nowhere` is not a verb this build routes");
  });

  it("accepts a step whose platform verb it cannot reach, which is this check's stated residue", () => {
    expect(resolveResyncSteps({ command: "slopweaver atlas airtable teleport" }).isOk()).toBe(true);
  });
});

describe("resyncStepLine", () => {
  it("renders a step the way it would be typed", () => {
    expect(resyncStepLine({ step: { argv: ["atlas", "clerk", "walk"] } })).toBe("slopweaver atlas clerk walk");
  });
});
