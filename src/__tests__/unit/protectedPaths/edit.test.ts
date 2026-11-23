/**
 * The registry's transitions: adding and tightening need nobody's leave, widening and removing need the
 * `protect-remove` hatch, and a same-mode re-add changes nothing.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { editProtectedPaths } from "../../../protectedPaths/edit.js";
import type { ProtectedPath, ProtectedPathRegistry } from "../../../protectedPaths/registry.js";

const NOW = "2026-02-02T00:00:00.000Z";
const EARLIER = "2026-01-01T00:00:00.000Z";
const KEPT = "/Users/example/protected-state";
const OTHER = "/Users/example/other";

/** A registry holding exactly the given entries. */
function registryOf({ paths }: { paths: readonly ProtectedPath[] }): ProtectedPathRegistry {
  return { paths, schemaVersion: 1 };
}

/** One entry, stamped at the earlier instant. */
function entry({ path, mode }: { path: string; mode: ProtectedPath["mode"] }): ProtectedPath {
  return { addedIso: EARLIER, mode, path, why: "a synthetic protection" };
}

describe("editProtectedPaths", () => {
  it("adds a new path, stamped now, without the hatch", () => {
    const edited = unwrap(
      editProtectedPaths({
        edit: { kind: "add", mode: "read-only", path: KEPT, why: "the old store" },
        nowIso: NOW,
        registry: registryOf({ paths: [] }),
        wideningHatchOpen: false,
      }),
    );
    expect(edited.change).toBe("added");
    expect(edited.registry.paths).toEqual([{ addedIso: NOW, mode: "read-only", path: KEPT, why: "the old store" }]);
  });

  it("tightens read-only to no-access without the hatch", () => {
    const edited = unwrap(
      editProtectedPaths({
        edit: { kind: "add", mode: "no-access", path: KEPT, why: "tighter now" },
        nowIso: NOW,
        registry: registryOf({ paths: [entry({ mode: "read-only", path: KEPT })] }),
        wideningHatchOpen: false,
      }),
    );
    expect(edited.change).toBe("tightened");
    expect(edited.registry.paths).toEqual([{ addedIso: NOW, mode: "no-access", path: KEPT, why: "tighter now" }]);
  });

  it("refuses to widen no-access to read-only with the hatch closed", () => {
    const refused = unwrapErr(
      editProtectedPaths({
        edit: { kind: "add", mode: "read-only", path: KEPT, why: "looser" },
        nowIso: NOW,
        registry: registryOf({ paths: [entry({ mode: "no-access", path: KEPT })] }),
        wideningHatchOpen: false,
      }),
    );
    expect(refused.code).toBe("WIDENING_REFUSED");
    expect(refused.message).toBe(`making read-only ${KEPT} would give sessions access the owner took away`);
  });

  it("widens no-access to read-only with the hatch open", () => {
    const edited = unwrap(
      editProtectedPaths({
        edit: { kind: "add", mode: "read-only", path: KEPT, why: "looser" },
        nowIso: NOW,
        registry: registryOf({ paths: [entry({ mode: "no-access", path: KEPT })] }),
        wideningHatchOpen: true,
      }),
    );
    expect(edited.change).toBe("widened");
    expect(edited.registry.paths.map((kept) => kept.mode)).toEqual(["read-only"]);
  });

  it("leaves a same-mode re-add unchanged, keeping its reason and instant, matched case-folded", () => {
    const before = registryOf({ paths: [entry({ mode: "no-access", path: KEPT })] });
    const edited = unwrap(
      editProtectedPaths({
        edit: { kind: "add", mode: "no-access", path: KEPT.toUpperCase(), why: "again" },
        nowIso: NOW,
        registry: before,
        wideningHatchOpen: false,
      }),
    );
    expect(edited.change).toBe("unchanged");
    expect(edited.registry).toBe(before);
  });

  it("refuses a removal with the hatch closed", () => {
    const refused = unwrapErr(
      editProtectedPaths({
        edit: { kind: "remove", path: KEPT },
        nowIso: NOW,
        registry: registryOf({ paths: [entry({ mode: "read-only", path: KEPT })] }),
        wideningHatchOpen: false,
      }),
    );
    expect(refused.code).toBe("WIDENING_REFUSED");
    expect(refused.message).toBe(`removing ${KEPT} would give sessions access the owner took away`);
  });

  it("removes exactly the named path with the hatch open, never a child or sibling", () => {
    const child = `${KEPT}/inner`;
    const edited = unwrap(
      editProtectedPaths({
        edit: { kind: "remove", path: KEPT },
        nowIso: NOW,
        registry: registryOf({
          paths: [
            entry({ mode: "read-only", path: KEPT }),
            entry({ mode: "no-access", path: child }),
            entry({ mode: "no-access", path: OTHER }),
          ],
        }),
        wideningHatchOpen: true,
      }),
    );
    expect(edited.change).toBe("removed");
    expect(edited.registry.paths.map((kept) => kept.path)).toEqual([child, OTHER]);
  });

  it("refuses to remove a path the registry does not hold, even with the hatch open", () => {
    const refused = unwrapErr(
      editProtectedPaths({
        edit: { kind: "remove", path: OTHER },
        nowIso: NOW,
        registry: registryOf({ paths: [entry({ mode: "read-only", path: KEPT })] }),
        wideningHatchOpen: true,
      }),
    );
    expect(refused.code).toBe("NOT_PROTECTED");
    expect(refused.path).toBe(OTHER);
  });
});
