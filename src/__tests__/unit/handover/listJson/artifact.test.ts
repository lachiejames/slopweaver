/** The artifact a row publishes, derived from its journal's events over its front matter's line. */
import { describe, expect, it } from "vitest";

import { boardJsonRow } from "../../../../cli/commands/handover/listJson.js";
import { doc, type Journal, modelsFor } from "./fixtures.js";

// A row can carry its page as an artifact EVENT while its front matter still reads `artifact: null`, and the card
// must still draw a link. The board publishes the derived artifact.
describe("boardJsonRow's artifact", () => {
  it("publishes no artifact for the `artifact: null` line a doc declares before it has one", () => {
    const placeholder = { ...doc({ slug: "placeholder" }), artifact: "null", artifactIsPlaceholder: true } as const;
    const model = modelsFor({ docs: [placeholder] })[0]!;
    expect(
      boardJsonRow({ model, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }).artifact,
    ).toBeUndefined();
  });

  it('publishes a QUOTED `artifact: "null"` line, an authored string the card then refuses by name', () => {
    const quoted = { ...doc({ slug: "quoted" }), artifact: "null" };
    const model = modelsFor({ docs: [quoted] })[0]!;
    expect(boardJsonRow({ model, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }).artifact).toBe(
      "null",
    );
  });

  const first = {
    atIso: "2026-10-06T16:00:00.000Z",
    kind: "artifact",
    url: "file:///p/pages/first/index.html",
  } as const;
  const last = { atIso: "2026-10-06T16:38:59.178Z", kind: "artifact", url: "file:///p/pages/last/index.html" } as const;

  it("publishes the last artifact event over the front matter's line", () => {
    const journals = new Map<string, Journal>([["swirls", { events: [first, last], unreadableLines: [] }]]);
    const authored = { ...doc({ slug: "swirls" }), artifact: "file:///p/pages/authored/index.html" };
    const model = modelsFor({ docs: [authored], journals })[0]!;
    expect(boardJsonRow({ model, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }).artifact).toBe(
      "file:///p/pages/last/index.html",
    );
  });

  it("publishes an artifact EVENT reading `null` over the placeholder, so the card refuses it by name", () => {
    const recorded = { atIso: "2026-10-08T06:30:00.000Z", kind: "artifact", url: "null" } as const;
    const journals = new Map<string, Journal>([["recorded", { events: [recorded], unreadableLines: [] }]]);
    const placeholder = { ...doc({ slug: "recorded" }), artifact: "null", artifactIsPlaceholder: true } as const;
    const model = modelsFor({ docs: [placeholder], journals })[0]!;
    expect(boardJsonRow({ model, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }).artifact).toBe(
      "null",
    );
  });

  it("publishes the front matter's artifact on a row with no artifact event", () => {
    const authored = { ...doc({ slug: "authored" }), artifact: "https://github.com/o/r/pull/12" };
    const model = modelsFor({ docs: [authored] })[0]!;
    expect(boardJsonRow({ model, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }).artifact).toBe(
      "https://github.com/o/r/pull/12",
    );
  });

  it("publishes no artifact on a row with none", () => {
    const model = modelsFor({ docs: [doc({ slug: "bare" })] })[0]!;
    expect(
      boardJsonRow({ model, ownerNames: new Set(), prSteers: undefined, repoSlugs: new Map() }).artifact,
    ).toBeUndefined();
  });
});
