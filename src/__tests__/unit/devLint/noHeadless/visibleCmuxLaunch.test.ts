import { describe, expect, it } from "vitest";
import { visibleCmuxLaunch } from "../../../../devLint/noHeadless.js";

describe("visibleCmuxLaunch", () => {
  it("reports the line of every recognized visible launch", () => {
    const content = [
      "await sendLine({",
      "  exec: deps.exec,",
      "  text: `${storePrefix}claude${pluginDirSuffix}${modelSuffix}${effortSuffix}${nameSuffix}${templateSuffix}`,",
      "  workspaceRef: workspace.workspaceRef,",
      "});",
    ].join("\n");
    expect(visibleCmuxLaunch({ content })).toEqual([{ line: 3 }]);
  });

  it("reports nothing for a file with no sendLine call at all", () => {
    expect(visibleCmuxLaunch({ content: "export const x = 1;" })).toEqual([]);
  });

  it("reports nothing for a sendLine call whose text is NOT the recognized shape", () => {
    expect(visibleCmuxLaunch({ content: 'await sendLine({ text: "echo hello" });' })).toEqual([]);
  });

  it("stops recognizing the recipe the moment a suffix is added and this set is not updated", () => {
    // The shape `spawn.ts` sent before `${effortSuffix}` joined it. This is the whole
    // reason the set's own doc comment demands it move in the same change: equality, so a boot line that
    // grew a suffix reads as an UNRECOGNIZED launch rather than quietly staying blessed.
    const beforeEffort =
      "await sendLine({ text: `${storePrefix}claude${pluginDirSuffix}${modelSuffix}${nameSuffix}` });";
    expect(visibleCmuxLaunch({ content: beforeEffort })).toEqual([]);
  });

  it("stops recognizing the pre-template recipe, now that templateSuffix has joined the boot line", () => {
    // The shape `bootLine.ts` sent before a launch template could append `--settings`.
    const beforeTemplate =
      "await sendLine({ text: `${storePrefix}claude${pluginDirSuffix}${modelSuffix}${effortSuffix}${nameSuffix}` });";
    expect(visibleCmuxLaunch({ content: beforeTemplate })).toEqual([]);
  });

  it("recognizes two separate calls on two separate lines independently — one per host", () => {
    const content = [
      "await sendLine({ text: `${storePrefix}claude${pluginDirSuffix}${modelSuffix}${effortSuffix}${nameSuffix}${templateSuffix}` });",
      'await sendLine({ text: "codex --no-alt-screen" });',
    ].join("\n");
    expect(visibleCmuxLaunch({ content })).toEqual([{ line: 1 }, { line: 2 }]);
  });
});
