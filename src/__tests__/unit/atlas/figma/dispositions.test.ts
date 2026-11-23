import { describe, expect, it } from "vitest";

import {
  FIGMA_NOT_ENUMERABLE_OPERATIONS,
  FIGMA_OBSERVATIONAL_POSTS,
  FIGMA_PROBE_ONLY_OPERATIONS,
  FIGMA_RENDER_ONLY_OPERATIONS,
  FIGMA_VOLUMINOUS_OPERATIONS,
  figmaDispositionOf,
} from "../../../../atlas/figma/exclusions.js";
import { figmaKindFor } from "../../../../atlas/figma/kinds.js";

describe("deciding what this atlas does with one Figma operation", () => {
  it("refuses every non-GET that is not the one observational POST", () => {
    const decided = figmaDispositionOf({ method: "DELETE", operationId: "deleteWebhook" });

    expect(decided.disposition).toBe("excluded");
    expect(decided.exclusionReason).toBe("mutating");
    expect(decided.dispositionBecause).toBe("DELETE changes the tenant, and this atlas only ever reads");
  });

  // Figma's one POST that reads takes its filter in a body because a log query does not fit a query
  // string. The HTTP verb decides one direction only.
  it("admits the developer-log POST, which reads rather than writes", () => {
    const decided = figmaDispositionOf({ method: "POST", operationId: "getDeveloperLogs" });

    expect(decided.disposition).toBe("shape-index");
    expect(decided.exclusionReason).toBe(null);
    expect(FIGMA_OBSERVATIONAL_POSTS).toEqual(["getDeveloperLogs"]);
  });

  it("shape-indexes an observation feed rather than storing its entries", () => {
    const decided = figmaDispositionOf({ method: "GET", operationId: "getActivityLogs" });

    expect(decided.disposition).toBe("shape-index");
    expect(decided.dispositionBecause).toBe(
      FIGMA_VOLUMINOUS_OPERATIONS.find((row) => row.operationId === "getActivityLogs")!.detail,
    );
  });

  it("stores the caller's own identity nowhere, because it is a fact about the installation", () => {
    const decided = figmaDispositionOf({ method: "GET", operationId: "getMe" });

    expect(decided.disposition).toBe("probe-only");
    expect(decided.dispositionBecause).toBe(FIGMA_PROBE_ONLY_OPERATIONS[0]!.detail);
  });

  it("refuses a render as an artifact rather than a fact", () => {
    const decided = figmaDispositionOf({ method: "GET", operationId: "getImages" });

    expect(decided.disposition).toBe("excluded");
    expect(decided.exclusionReason).toBe("render-only");
    expect(decided.dispositionBecause).toBe(
      FIGMA_RENDER_ONLY_OPERATIONS.find((row) => row.operationId === "getImages")!.reason,
    );
  });

  it("refuses an operation whose identifiers nothing enumerates", () => {
    const decided = figmaDispositionOf({ method: "GET", operationId: "getPayments" });

    expect(decided.disposition).toBe("excluded");
    expect(decided.exclusionReason).toBe("not-enumerable");
    expect(decided.dispositionBecause).toBe(FIGMA_NOT_ENUMERABLE_OPERATIONS[0]!.reason);
  });

  it("leaves an ordinary read as a plain entity with no reason to give", () => {
    const decided = figmaDispositionOf({ method: "GET", operationId: "getFileComponents" });

    expect(decided.disposition).toBe("entity");
    expect(decided.dispositionBecause).toBe(null);
    expect(decided.exclusionReason).toBe(null);
  });

  // A mutating verb wins over every other table, so a write that also appears in one of them can never be
  // admitted by the later branch. `postVariables` is the case: it is under a tag whose reads are entities.
  it("refuses a write even when its tag's reads are ordinary entities", () => {
    expect(figmaDispositionOf({ method: "POST", operationId: "postVariables" }).exclusionReason).toBe("mutating");
    expect(figmaDispositionOf({ method: "GET", operationId: "getLocalVariables" }).disposition).toBe("entity");
  });
});

describe("placing one Figma operation in a kind", () => {
  it("takes the tag's default when no override applies", () => {
    expect(figmaKindFor({ operationId: "getComments", tag: "Comments" })).toEqual({
      alsoFeeds: [],
      kind: "comment",
    });
  });

  // The tag names the container; the response is its contents. A reader asking "which files are in this
  // folder" and "what is this folder" must not get one answer.
  it("overrides a tag that names the container when the response is its contents", () => {
    expect(figmaKindFor({ operationId: "getFolderFiles", tag: "Folders" })!.kind).toBe("file");
    expect(figmaKindFor({ operationId: "getFolderFolders", tag: "Folders" })!.kind).toBe("folder");
    expect(figmaKindFor({ operationId: "getProjectFiles", tag: "Projects" })!.kind).toBe("file");
  });

  it("splits the Library Analytics tag by what each half returns", () => {
    expect(figmaKindFor({ operationId: "getLibraryAnalyticsStyleUsages", tag: "Library Analytics" })!.kind).toBe(
      "style",
    );
    expect(figmaKindFor({ operationId: "getLibraryAnalyticsStyleActions", tag: "Library Analytics" })!.kind).toBe(
      "event-shape",
    );
  });

  it("files the caller's own identity as a credential rather than as a person", () => {
    expect(figmaKindFor({ operationId: "getMe", tag: "Users" })!.kind).toBe("credential");
  });

  it("refuses an operation carrying a tag this table cannot place", () => {
    expect(figmaKindFor({ operationId: "getSomethingNew", tag: "Widgets" })).toBe(null);
  });
});
