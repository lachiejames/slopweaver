/**
 * The two decoders of a workspace's four addresses. Each result becomes a WRITE target, so every shape that cannot
 * be attributed to exactly one surface of the asked-for workspace must be refused, not guessed at.
 */
import { describe, expect, it } from "vitest";

import { parseCreatedWorkspace, parseWorkspaceSurface } from "../../../cmux/workspaceAddresses.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("parseCreatedWorkspace", () => {
  it("reads all four addresses out of one reply", () => {
    const parsed = parseCreatedWorkspace({
      value: {
        surface_id: "22059B3F",
        surface_ref: "surface:63",
        workspace_id: "966460D9",
        workspace_ref: "workspace:60",
      },
    });

    expect(parsed.isOk()).toBe(true);
    expect(unwrap(parsed)).toEqual({
      surfaceId: "22059B3F",
      surfaceRef: "surface:63",
      workspaceId: "966460D9",
      workspaceRef: "workspace:60",
    });
  });

  it("refuses a reply missing the workspace id rather than defaulting it to a blank", () => {
    const parsed = parseCreatedWorkspace({
      value: { surface_id: "s", surface_ref: "surface:1", workspace_ref: "workspace:1" },
    });

    expect(parsed.isErr()).toBe(true);
    expect(unwrapErr(parsed).code).toBe("MALFORMED_REPLY");
    expect(unwrapErr(parsed).message).toContain("workspace_id");
  });
});

/** One pane as the live socket answered it, trimmed to the fields the decoder reads and one it ignores. */
const PANE = {
  focused: true,
  selected_surface_id: "C5E814AA",
  selected_surface_ref: "surface:1062",
  surface_ids: ["C5E814AA"],
} as const;

/** A whole reply for one workspace, with the given panes. */
function reply({ panes }: { panes: unknown }): Record<string, unknown> {
  return { panes, workspace_id: "0707687A", workspace_ref: "workspace:1051" };
}

describe("parseWorkspaceSurface", () => {
  it("decodes the measured reply into the workspace's and its one pane's selected surface's addresses", () => {
    const parsed = parseWorkspaceSurface({ value: reply({ panes: [PANE] }), workspaceId: "0707687A" });

    expect(unwrap(parsed)).toEqual({
      surfaceId: "C5E814AA",
      surfaceRef: "surface:1062",
      workspaceId: "0707687A",
      workspaceRef: "workspace:1051",
    });
  });

  it("refuses a reply naming a different workspace than the one asked for", () => {
    const parsed = parseWorkspaceSurface({ value: reply({ panes: [PANE] }), workspaceId: "SOMEONE-ELSE" });

    expect(unwrapErr(parsed).code).toBe("MALFORMED_REPLY");
    expect(unwrapErr(parsed).message).toContain("asked for workspace SOMEONE-ELSE, the reply names 0707687A");
  });

  it("refuses a reply with no panes", () => {
    const parsed = parseWorkspaceSurface({ value: reply({ panes: [] }), workspaceId: "0707687A" });

    expect(unwrapErr(parsed).message).toContain("expected exactly one pane, the reply carries 0");
  });

  it("refuses a reply with two panes rather than choosing which surface to type into", () => {
    const parsed = parseWorkspaceSurface({ value: reply({ panes: [PANE, PANE] }), workspaceId: "0707687A" });

    expect(unwrapErr(parsed).message).toContain("expected exactly one pane, the reply carries 2");
  });

  it("refuses a pane that names no selected surface", () => {
    const parsed = parseWorkspaceSurface({
      value: reply({ panes: [{ ...PANE, selected_surface_ref: "" }] }),
      workspaceId: "0707687A",
    });

    expect(unwrapErr(parsed).message).toContain("the pane names no selected surface");
  });

  it("refuses a reply with no workspace ref", () => {
    const parsed = parseWorkspaceSurface({
      value: { panes: [PANE], workspace_id: "0707687A" },
      workspaceId: "0707687A",
    });

    expect(unwrapErr(parsed).message).toContain('no string field "workspace_ref"');
  });
});
