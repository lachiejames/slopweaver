/*
 * The three surface names the compiled sync reports coverage under, held against the descriptor: a cell
 * published under a name the descriptor does not declare is coverage no reader of that surface would see.
 */
import { describe, expect, it } from "vitest";

import { MICROSOFT365_ATLAS_DESCRIPTOR } from "../../../../atlas/microsoft365/descriptor.js";
import {
  MICROSOFT365_API_SURFACE,
  MICROSOFT365_CONSOLE_SURFACE,
  MICROSOFT365_SPEC_SURFACE,
} from "../../../../atlas/microsoft365/sync.js";

/** The descriptor's surface of that name, as the role and acquisition a coverage cell is judged against. */
function declared({ name }: { name: string }): { role: string; acquisition: string } {
  const surface = MICROSOFT365_ATLAS_DESCRIPTOR.surfaces.find((candidate) => candidate.name === name)!;
  return { acquisition: surface.acquisition, role: surface.role };
}

describe("the compiled sync's surface names", () => {
  it("are exactly the three surfaces the descriptor declares", () => {
    expect([MICROSOFT365_SPEC_SURFACE, MICROSOFT365_API_SURFACE, MICROSOFT365_CONSOLE_SURFACE]).toEqual(
      MICROSOFT365_ATLAS_DESCRIPTOR.surfaces.map((surface) => surface.name),
    );
  });

  it("name the surfaces whose roles and acquisitions the published cells claim", () => {
    expect(declared({ name: MICROSOFT365_SPEC_SURFACE })).toEqual({ acquisition: "compiled", role: "authoritative" });
    expect(declared({ name: MICROSOFT365_API_SURFACE })).toEqual({ acquisition: "api", role: "authoritative" });
    expect(declared({ name: MICROSOFT365_CONSOLE_SURFACE })).toEqual({
      acquisition: "driven-browser",
      role: "corroborating",
    });
  });
});
