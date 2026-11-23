import { pgRole } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { roleNameOf } from "../../../devLint/drizzleMigrationsRun.js";

describe("roleNameOf", () => {
  it("reads a role object's name and a role name as the same thing", () => {
    expect(roleNameOf({ to: pgRole("authenticated") })).toBe("authenticated");
    expect(roleNameOf({ to: "service_role" })).toBe("service_role");
  });

  it("names no single role for a list or for nothing", () => {
    expect(roleNameOf({ to: ["authenticated", "service_role"] })).toBeUndefined();
    expect(roleNameOf({ to: undefined })).toBeUndefined();
  });
});
