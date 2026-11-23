import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  normaliseCrowdstrikeHost,
  resolveCrowdstrikeCredentials,
} from "../../../../atlas/crowdstrike/credentialFiles.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";

const homes: string[] = [];

/** A throwaway state home with a `secrets/` directory, removed in afterEach. */
function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "slopweaver-cs-cred-"));
  mkdirSync(join(home, "secrets"), { mode: 0o700, recursive: true });
  homes.push(home);
  return home;
}

/**
 * Write one secret file at the given mode.
 *
 * `chmod` after the write, not just the `writeFileSync` mode option: that option applies only when the file
 * is CREATED, so re-writing an existing 0600 file at 0644 silently leaves it at 0600 — which would make the
 * loosened-mode test pass against a file that was never loosened.
 */
function writeSecret({ home, name, value, mode }: { home: string; name: string; value: string; mode: number }): void {
  const path = join(home, "secrets", name);
  writeFileSync(path, value, { mode });
  chmodSync(path, mode);
}

/** Write all three at 0600. */
function writeAll({ home }: { home: string }): void {
  writeSecret({ home, mode: 0o600, name: "crowdstrike-api-host", value: "api.us-2.example.test" });
  writeSecret({ home, mode: 0o600, name: "crowdstrike-client-id", value: "id-value" });
  writeSecret({ home, mode: 0o600, name: "crowdstrike-client-secret", value: "secret-value" });
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("normaliseCrowdstrikeHost", () => {
  it("adds https to a bare host", () => {
    expect(unwrap(normaliseCrowdstrikeHost({ raw: "api.us-2.example.test" }))).toBe("https://api.us-2.example.test");
  });

  it("strips a trailing slash so no path gains a double slash", () => {
    expect(unwrap(normaliseCrowdstrikeHost({ raw: "https://api.us-2.example.test/" }))).toBe(
      "https://api.us-2.example.test",
    );
  });

  it("refuses plain http, because a bearer must never cross it", () => {
    expect(unwrapErr(normaliseCrowdstrikeHost({ raw: "http://api.us-2.example.test" }))[0]).toContain("must be https");
  });

  it("refuses an empty host", () => {
    expect(unwrapErr(normaliseCrowdstrikeHost({ raw: "   " }))[0]).toContain("is empty");
  });
});

describe("resolveCrowdstrikeCredentials", () => {
  it("reads all three from the store", () => {
    const home = makeHome();
    writeAll({ home });
    const credentials = unwrap(resolveCrowdstrikeCredentials({ env: {}, home }));
    expect(credentials.apiHost).toBe("https://api.us-2.example.test");
    expect(credentials.clientId).toBe("id-value");
    expect(credentials.clientSecret).toBe("secret-value");
  });

  it("names all three when nothing is configured, and says how to set them", () => {
    const problems = unwrapErr(resolveCrowdstrikeCredentials({ env: {}, home: makeHome() }));
    expect(problems[0]).toContain("are all required");
    expect(problems[0]).toContain("slopweaver secrets set");
  });

  it("names exactly the missing file when the store is half-populated", () => {
    const home = makeHome();
    writeSecret({ home, mode: 0o600, name: "crowdstrike-client-id", value: "id-value" });
    writeSecret({ home, mode: 0o600, name: "crowdstrike-api-host", value: "api.us-2.example.test" });
    const problems = unwrapErr(resolveCrowdstrikeCredentials({ env: {}, home }));
    expect(problems[0]).toContain("missing: crowdstrike-client-secret");
  });

  it("REFUSES a secret readable by group or other rather than quietly using it", () => {
    const home = makeHome();
    writeAll({ home });
    writeSecret({ home, mode: 0o644, name: "crowdstrike-client-secret", value: "secret-value" });
    const problems = unwrapErr(resolveCrowdstrikeCredentials({ env: {}, home }));
    expect(problems[0]).toContain("must be owner-only");
  });

  it("prefers the environment when it is fully set", () => {
    const home = makeHome();
    writeAll({ home });
    const credentials = unwrap(
      resolveCrowdstrikeCredentials({
        env: {
          CROWDSTRIKE_API_HOST: "https://api.eu-1.example.test",
          CROWDSTRIKE_CLIENT_ID: "env-id",
          CROWDSTRIKE_CLIENT_SECRET: "env-secret",
        },
        home,
      }),
    );
    expect(credentials.apiHost).toBe("https://api.eu-1.example.test");
    expect(credentials.clientId).toBe("env-id");
  });

  it("reports a half-set environment as an environment problem, never falling through to the store", () => {
    const home = makeHome();
    writeAll({ home });
    const problems = unwrapErr(resolveCrowdstrikeCredentials({ env: { CROWDSTRIKE_CLIENT_ID: "env-id" }, home }));
    expect(problems[0]).toContain("partly set in the environment");
    expect(problems[0]).toContain("CROWDSTRIKE_API_HOST");
  });

  it("refuses an empty secret file", () => {
    const home = makeHome();
    writeAll({ home });
    writeSecret({ home, mode: 0o600, name: "crowdstrike-client-id", value: "" });
    expect(unwrapErr(resolveCrowdstrikeCredentials({ env: {}, home }))[0]).toContain("is empty");
  });
});

describe("the credential refusals, line for line", () => {
  it("refuses an empty host as exactly one line", () => {
    expect(unwrapErr(normaliseCrowdstrikeHost({ raw: "/" }))).toEqual(["the CrowdStrike API host is empty"]);
  });

  it("refuses plain http naming only the scheme", () => {
    expect(unwrapErr(normaliseCrowdstrikeHost({ raw: "http://api.example.test" }))).toEqual([
      "the CrowdStrike API host must be https, not http",
    ]);
  });

  it("refuses a host that does not parse as a URL", () => {
    expect(unwrapErr(normaliseCrowdstrikeHost({ raw: "a b" }))).toEqual(["the CrowdStrike API host is not a URL: a b"]);
  });

  it("names all three secret-store names when nothing is configured", () => {
    expect(unwrapErr(resolveCrowdstrikeCredentials({ env: {}, home: makeHome() }))).toEqual([
      "CrowdStrike credentials are not configured: crowdstrike-api-host, crowdstrike-client-id and crowdstrike-client-secret are all required. Set each with: slopweaver secrets set <name>",
    ]);
  });

  it("names the missing environment variables and never the value that was set", () => {
    const problems = unwrapErr(
      resolveCrowdstrikeCredentials({ env: { CROWDSTRIKE_CLIENT_ID: "fake-id-value-7f3" }, home: makeHome() }),
    );
    expect(problems).toEqual([
      "CrowdStrike credentials are partly set in the environment; missing: CROWDSTRIKE_API_HOST, CROWDSTRIKE_CLIENT_SECRET",
    ]);
    expect(JSON.stringify(problems)).not.toContain("fake-id-value-7f3");
  });

  it("names both missing store entries when only the host is stored", () => {
    const home = makeHome();
    writeSecret({ home, mode: 0o600, name: "crowdstrike-api-host", value: "api.example.test" });
    expect(unwrapErr(resolveCrowdstrikeCredentials({ env: {}, home }))).toEqual([
      "the secrets store holds only part of the CrowdStrike credential; missing: crowdstrike-client-id, crowdstrike-client-secret",
    ]);
  });
});
