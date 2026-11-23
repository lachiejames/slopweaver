/**
 * The path-to-`data:`-URI resolution walk: finding every `path`, rewriting it once a caller has read the
 * bytes, and the extension-to-MIME table that decides what this file will embed at all.
 */
import { describe, expect, it } from "vitest";

import { applyResolvedImages, collectImagePaths, mimeOfPath } from "../../../../outbound/briefing/images.js";

describe("collectImagePaths", () => {
  it("finds an image path nested anywhere in the form, with its JSON path", () => {
    const json = {
      reactNow: [{ detail: { blocks: [{ kind: "image", path: "/tmp/shot.png" }] } }],
    };

    expect(collectImagePaths({ json })).toEqual([
      { jsonPath: ["reactNow", 0, "detail", "blocks", 0, "path"], path: "/tmp/shot.png" },
    ]);
  });

  it("finds every image path across separate folds, in document order", () => {
    const json = {
      recent: [{ detail: { blocks: [{ kind: "image", path: "/a.png" }] } }],
      reactNow: [{ detail: { blocks: [{ kind: "image", path: "/b.png" }] } }],
    };

    expect(collectImagePaths({ json }).map((ref) => ref.path)).toEqual(["/a.png", "/b.png"]);
  });

  it("leaves an image block that already carries `data` alone", () => {
    const json = { blocks: [{ data: "data:image/png;base64,AA==", kind: "image" }] };

    expect(collectImagePaths({ json })).toEqual([]);
  });

  it("finds nothing in a form with no image block", () => {
    const json = { header: { workspace: "ws:1" }, reactNow: [] };

    expect(collectImagePaths({ json })).toEqual([]);
  });
});

describe("applyResolvedImages", () => {
  it("replaces a resolved path with `data`, dropping `path`", () => {
    const json = { alt: "a screenshot", kind: "image", path: "/tmp/shot.png" };
    const resolved = new Map([["/tmp/shot.png", "data:image/png;base64,AA=="]]);

    expect(applyResolvedImages({ json, resolved })).toEqual({
      alt: "a screenshot",
      data: "data:image/png;base64,AA==",
      kind: "image",
    });
  });

  it("resolves the same path wherever it recurs, and leaves every other field byte-identical", () => {
    interface Node {
      readonly detail?: { readonly blocks: readonly Record<string, unknown>[] };
      readonly question?: string;
    }
    interface Json {
      readonly history: readonly { readonly notes: readonly Node[]; readonly summary: string }[];
      readonly reactNow: readonly Node[];
    }
    const json: Json = {
      history: [{ notes: [{ detail: { blocks: [{ kind: "image", path: "/tmp/shot.png" }] } }], summary: "s" }],
      reactNow: [{ detail: { blocks: [{ kind: "image", path: "/tmp/shot.png" }] } }, { question: "still here?" }],
    };
    const resolved = new Map([["/tmp/shot.png", "data:image/png;base64,AA=="]]);

    const out = applyResolvedImages({ json, resolved }) as Json;

    expect(out.reactNow[0]!.detail!.blocks[0]).toEqual({ data: "data:image/png;base64,AA==", kind: "image" });
    expect(out.reactNow[1]).toEqual({ question: "still here?" });
    expect(out.history[0]!.notes[0]!.detail!.blocks[0]).toEqual({
      data: "data:image/png;base64,AA==",
      kind: "image",
    });
  });

  it("leaves a path unresolved when the map carries nothing for it", () => {
    const json = { kind: "image", path: "/tmp/missing.png" };

    expect(applyResolvedImages({ json, resolved: new Map() })).toEqual(json);
  });
});

describe("mimeOfPath", () => {
  it("maps every supported extension to its MIME type, case-insensitively", () => {
    expect(mimeOfPath({ path: "/a/shot.png" })).toBe("image/png");
    expect(mimeOfPath({ path: "/a/shot.PNG" })).toBe("image/png");
    expect(mimeOfPath({ path: "/a/shot.jpg" })).toBe("image/jpeg");
    expect(mimeOfPath({ path: "/a/shot.jpeg" })).toBe("image/jpeg");
    expect(mimeOfPath({ path: "/a/shot.gif" })).toBe("image/gif");
    expect(mimeOfPath({ path: "/a/shot.webp" })).toBe("image/webp");
  });

  it("returns undefined for an extension it will not embed, or no extension at all", () => {
    expect(mimeOfPath({ path: "/a/shot.svg" })).toBeUndefined();
    expect(mimeOfPath({ path: "/a/noext" })).toBeUndefined();
  });
});
