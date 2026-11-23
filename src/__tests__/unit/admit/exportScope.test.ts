/**
 * `exportScope.ts`: one segment's step through the export state behind an inline hatch.
 */
import { describe, expect, it } from "vitest";

import { exportStep, NO_EXPORT } from "../../../admit/exportScope.js";

const EXPORT_ONE = { kind: "export-set", matchesOne: true } as const;

describe("exportStep", () => {
  it("keeps an unconditional export across `;` and `&&`", () => {
    expect(exportStep({ entry: undefined, exit: ";", op: EXPORT_ONE, state: NO_EXPORT })).toEqual({
      active: true,
      conditional: false,
      exported: true,
    });
  });

  it("drops an export a short-circuit may have skipped once the chain leaves `&&`", () => {
    expect(exportStep({ entry: "&&", exit: ";", op: EXPORT_ONE, state: NO_EXPORT }).active).toBe(false);
    expect(exportStep({ entry: "||", exit: "&&", op: EXPORT_ONE, state: NO_EXPORT }).active).toBe(false);
  });

  it("holds an export entered through `&&` along an unbroken `&&` chain", () => {
    expect(exportStep({ entry: "&&", exit: "&&", op: EXPORT_ONE, state: NO_EXPORT })).toEqual({
      active: true,
      conditional: true,
      exported: false,
    });
  });

  it("keeps nothing through a pipe, a `||` exit, or an unset", () => {
    expect(exportStep({ entry: undefined, exit: ";", op: "piped", state: NO_EXPORT })).toEqual(NO_EXPORT);
    expect(exportStep({ entry: undefined, exit: "||", op: EXPORT_ONE, state: NO_EXPORT })).toEqual(NO_EXPORT);
    const live = { active: true, conditional: false, exported: true };
    expect(exportStep({ entry: ";", exit: ";", op: { kind: "unset" }, state: live })).toEqual(NO_EXPORT);
  });

  it("lets a bare reassignment count only once the export attribute is certain", () => {
    const bare = { kind: "bare-set", matchesOne: true } as const;
    expect(exportStep({ entry: ";", exit: ";", op: bare, state: NO_EXPORT }).active).toBe(false);
    const exported = { active: false, conditional: false, exported: true };
    expect(exportStep({ entry: ";", exit: ";", op: bare, state: exported }).active).toBe(true);
  });
});
