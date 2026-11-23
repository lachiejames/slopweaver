import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { resolveVantaTenantSlug, VANTA_TENANT_SLUG_ENV } from "../../../../atlas/vanta/tenantSlug.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { secretFilePath } from "../../../../stateHome.js";

const homes: string[] = [];

function newHome(): string {
  const home = mkdtempSync(join(tmpdir(), "vanta-slug-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  while (homes.length > 0) {
    rmSync(homes.pop()!, { force: true, recursive: true });
  }
});

describe("resolveVantaTenantSlug", () => {
  it("prefers the flag over everything else", () => {
    const slug = resolveVantaTenantSlug({
      env: { [VANTA_TENANT_SLUG_ENV]: "from-env" },
      flag: "from-flag",
      home: newHome(),
    });

    expect(unwrap(slug)).toBe("from-flag");
  });

  it("falls through to the environment when no flag was passed", () => {
    const slug = resolveVantaTenantSlug({ env: { [VANTA_TENANT_SLUG_ENV]: "from-env" }, flag: null, home: newHome() });

    expect(unwrap(slug)).toBe("from-env");
  });

  it("falls through to the secrets store when the environment is empty", () => {
    const home = newHome();
    const path = secretFilePath({ home, name: "vanta-tenant-slug" });
    mkdirSync(join(home, "secrets"), { recursive: true });
    writeFileSync(path, "from-store\n", "utf8");

    expect(unwrap(resolveVantaTenantSlug({ env: {}, flag: null, home }))).toBe("from-store");
  });

  it("names every route when nothing supplies a slug", () => {
    const problems = unwrapErr(resolveVantaTenantSlug({ env: {}, flag: null, home: newHome() })).join("\n");

    expect(problems).toContain(VANTA_TENANT_SLUG_ENV);
    expect(problems).toContain("--tenant");
    expect(problems).toContain("slopweaver secrets set vanta-tenant-slug");
  });

  it("refuses a value that would change the shape of the URL it builds", () => {
    const problems = unwrapErr(resolveVantaTenantSlug({ env: {}, flag: "tenant/../evil", home: newHome() }));

    expect(problems.join("\n")).toContain("--tenant is not a Vanta workspace slug");
  });

  it("refuses an empty flag rather than building a rootless URL", () => {
    const problems = unwrapErr(resolveVantaTenantSlug({ env: {}, flag: "  ", home: newHome() }));

    expect(problems.join("\n")).toContain("--tenant is set but empty");
  });

  it("ignores a blank environment value and reports the missing route", () => {
    const problems = unwrapErr(
      resolveVantaTenantSlug({ env: { [VANTA_TENANT_SLUG_ENV]: "   " }, flag: null, home: newHome() }),
    ).join("\n");

    expect(problems).toContain("is not set");
  });
});
