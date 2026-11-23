import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  isTrelicaTenantHost,
  isTrelicaTenantOrigin,
  resolveTrelicaTenantOrigin,
  TRELICA_LOGIN_ORIGIN,
  TRELICA_TENANT_ORIGIN_SUFFIX,
} from "../../../../atlas/trelica/tenant.js";
import { unwrap } from "../../../../lib/result.js";

const homes: string[] = [];

/** A scratch home with a tenant-host secret written at the mode the reader demands. */
function homeWithHost({ value, mode = 0o600 }: { value: string; mode?: number }): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-trelica-tenant-"));
  homes.push(home);
  mkdirSync(join(home, "secrets"), { recursive: true });
  writeFileSync(join(home, "secrets", "trelica-tenant-host"), value, { mode });
  return home;
}

afterEach(() => {
  homes.splice(0).forEach((home) => {
    rmSync(home, { force: true, recursive: true });
  });
});

describe("isTrelicaTenantHost", () => {
  it("accepts one label beneath the vendor suffix", () => {
    expect(isTrelicaTenantHost({ host: `team-example${TRELICA_TENANT_ORIGIN_SUFFIX}` })).toBe(true);
  });

  it("rejects the shared sign-in host, which is a different origin entirely", () => {
    expect(isTrelicaTenantHost({ host: TRELICA_LOGIN_ORIGIN.replace("https://", "") })).toBe(false);
  });

  it("rejects a nested label, so a lookalike subdomain cannot pass", () => {
    expect(isTrelicaTenantHost({ host: `evil.team-example${TRELICA_TENANT_ORIGIN_SUFFIX}` })).toBe(false);
  });

  it("rejects a bare suffix with no tenant label at all", () => {
    expect(isTrelicaTenantHost({ host: TRELICA_TENANT_ORIGIN_SUFFIX })).toBe(false);
  });
});

describe("isTrelicaTenantOrigin", () => {
  it("is true only for the exact origin", () => {
    expect(
      isTrelicaTenantOrigin({
        origin: "https://team-example.trelica.app",
        tenantOrigin: "https://team-example.trelica.app",
      }),
    ).toBe(true);
  });

  it("is false for a third-party telemetry origin a page also calls", () => {
    expect(
      isTrelicaTenantOrigin({
        origin: "https://api.eu.amplitude.com",
        tenantOrigin: "https://team-example.trelica.app",
      }),
    ).toBe(false);
  });
});

describe("resolveTrelicaTenantOrigin", () => {
  it("reads the secrets store and returns an absolute origin", () => {
    const home = homeWithHost({ value: `team-example${TRELICA_TENANT_ORIGIN_SUFFIX}\n` });
    const resolved = resolveTrelicaTenantOrigin({ env: {}, home });
    expect(resolved.isOk()).toBe(true);
    expect(unwrap(resolved)).toBe(`https://team-example${TRELICA_TENANT_ORIGIN_SUFFIX}`);
  });

  it("strips a scheme and a trailing slash the operator pasted in", () => {
    const home = homeWithHost({ value: `https://Team-Example${TRELICA_TENANT_ORIGIN_SUFFIX}/` });
    expect(unwrap(resolveTrelicaTenantOrigin({ env: {}, home }))).toBe(
      `https://team-example${TRELICA_TENANT_ORIGIN_SUFFIX}`,
    );
  });

  it("prefers the environment over the store", () => {
    const home = homeWithHost({ value: `stored${TRELICA_TENANT_ORIGIN_SUFFIX}` });
    const resolved = resolveTrelicaTenantOrigin({
      env: { TRELICA_TENANT_HOST: `from-env${TRELICA_TENANT_ORIGIN_SUFFIX}` },
      home,
    });
    expect(unwrap(resolved)).toBe(`https://from-env${TRELICA_TENANT_ORIGIN_SUFFIX}`);
  });

  it("refuses a host that is not shaped like a tenant, naming the suffix it wanted", () => {
    const home = homeWithHost({ value: "app.trelica.com" });
    const resolved = resolveTrelicaTenantOrigin({ env: {}, home });
    expect(resolved.isErr()).toBe(true);
    expect(resolved._unsafeUnwrapErr()[0]).toContain(TRELICA_TENANT_ORIGIN_SUFFIX);
  });

  it("refuses a world-readable host file rather than using it", () => {
    const home = homeWithHost({ mode: 0o644, value: `team-example${TRELICA_TENANT_ORIGIN_SUFFIX}` });
    const resolved = resolveTrelicaTenantOrigin({ env: {}, home });
    expect(resolved.isErr()).toBe(true);
    expect(resolved._unsafeUnwrapErr()[0]).toContain("owner-only");
  });

  it("refuses an unset host with the command that sets it", () => {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-trelica-tenant-"));
    homes.push(home);
    const resolved = resolveTrelicaTenantOrigin({ env: {}, home });
    expect(resolved.isErr()).toBe(true);
    expect(resolved._unsafeUnwrapErr().join(" ")).toContain("slopweaver secrets set trelica-tenant-host");
  });
});

describe("resolveTrelicaTenantOrigin prints each refusal whole", () => {
  /** A scratch home with no tenant host at all. */
  function emptyHome(): string {
    const home = mkdtempSync(join(tmpdir(), "slopweaver-trelica-tenant-"));
    homes.push(home);
    return home;
  }

  it("prints the read failure, then the command that sets it, then why nothing guesses one", () => {
    const home = emptyHome();
    const path = join(home, "secrets", "trelica-tenant-host");
    expect(resolveTrelicaTenantOrigin({ env: {}, home })._unsafeUnwrapErr()).toEqual([
      `could not read the Trelica tenant host at ${path}: ENOENT: no such file or directory, open '${path}'`,
      "set it with: slopweaver secrets set trelica-tenant-host — the value is your own tenant host, the one your browser is on after signing in",
      "nothing here guesses a tenant: a guessed one would either not exist or belong to somebody else",
    ]);
  });

  it("names the loose file by path when it is readable by others", () => {
    const home = homeWithHost({ mode: 0o644, value: `team-example${TRELICA_TENANT_ORIGIN_SUFFIX}` });
    const path = join(home, "secrets", "trelica-tenant-host");
    expect(resolveTrelicaTenantOrigin({ env: {}, home })._unsafeUnwrapErr()).toEqual([
      `the Trelica tenant host must be owner-only (mode 0600 or stricter): ${path}`,
      "set it with: slopweaver secrets set trelica-tenant-host — the value is your own tenant host, the one your browser is on after signing in",
      "nothing here guesses a tenant: a guessed one would either not exist or belong to somebody else",
    ]);
  });

  it("names the empty file by path when it holds only whitespace", () => {
    const home = homeWithHost({ value: "  " });
    const path = join(home, "secrets", "trelica-tenant-host");
    expect(resolveTrelicaTenantOrigin({ env: {}, home })._unsafeUnwrapErr()).toEqual([
      `the Trelica tenant host file is empty: ${path}`,
      "set it with: slopweaver secrets set trelica-tenant-host — the value is your own tenant host, the one your browser is on after signing in",
      "nothing here guesses a tenant: a guessed one would either not exist or belong to somebody else",
    ]);
  });

  it("refuses the shared sign-in host with two lines that never echo the value", () => {
    const env = { TRELICA_TENANT_HOST: "app.trelica.com" };
    const lines = resolveTrelicaTenantOrigin({ env, home: emptyHome() })._unsafeUnwrapErr();
    expect(env.TRELICA_TENANT_HOST).toBe("app.trelica.com");
    expect(lines).toEqual([
      "trelica-tenant-host does not look like a tenant host: expected one label beneath .trelica.app",
      "the value is the host your browser shows once signed in, not the shared sign-in host",
    ]);
    expect(lines.join("\n")).not.toContain("app.trelica.com");
  });
});
