/**
 * `secrets status`'s effectful edge: the store read (a genuine temp-dir round trip, no mocks) and the shell
 * that composes it over injected seams.
 *
 * The load-bearing assertion is the last one: a store holding a real-looking token is read end to end and
 * the token's own bytes appear in NOTHING the verb emits. That is the property the verb exists to keep, and
 * a test that only checked the states would let a future field quietly carry a value.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { SecretsStatusDeps } from "../../../../../cli/commands/secrets/statusRun.js";
import { readStore, runSecretsStatusWithDeps } from "../../../../../cli/commands/secrets/statusRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

const dirs: string[] = [];

/** A throwaway home with a `secrets/` directory, removed in the `afterEach` below. */
function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "sw-secrets-status-"));
  dirs.push(home);
  mkdirSync(join(home, "secrets"), { mode: 0o700, recursive: true });
  return home;
}

/** Write one store file at a stated mode. */
function place({ home, name, body, mode }: { home: string; name: string; body: string; mode: number }): void {
  const path = join(home, "secrets", name);
  writeFileSync(path, body, { mode });
}

/** A logger seam that keeps what was written, so an assertion reads the real output. */
function collector(): { lines: string[]; errors: string[] } {
  return { errors: [], lines: [] };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe("readStore", () => {
  it("reports an empty store for a home with no secrets directory", () => {
    const home = mkdtempSync(join(tmpdir(), "sw-secrets-empty-"));
    dirs.push(home);

    expect(readStore({ home })).toEqual([]);
  });

  it("reads a single-line secret's mode without reading its bytes", () => {
    const home = makeHome();
    place({ body: "a-single-line-value", home, mode: 0o600, name: "slack-bot-token" });

    const observed = readStore({ home }).find((entry) => entry.name === "slack-bot-token")!;

    expect(observed.modeOctal).toBe("600");
    expect(observed.grant).toBe(undefined);
  });

  it("reports a loose mode as the three octal digits a reader can act on", () => {
    const home = makeHome();
    place({ body: "x", home, mode: 0o644, name: "linear-token" });

    expect(readStore({ home }).find((entry) => entry.name === "linear-token")!.modeOctal).toBe("644");
  });

  it("reads a grant only when it carries the credential its OWN door authenticates with", () => {
    const home = makeHome();
    const shell = { account: "someone@example.com", grantedAtIso: "2026-11-07T00:00:00.000Z", scopes: ["openid"] };
    place({ body: JSON.stringify(shell), home, mode: 0o600, name: "gmail-oauth.json" });
    place({ body: JSON.stringify({ ...shell, msalCache: "{}" }), home, mode: 0o600, name: "drive-oauth.json" });
    place({ body: JSON.stringify({ ...shell, refreshToken: "r" }), home, mode: 0o600, name: "outlook-oauth.json" });
    place({ body: JSON.stringify({ ...shell, refreshToken: "r" }), home, mode: 0o600, name: "calendar-oauth.json" });

    const grantOf = ({ name }: { name: string }) => readStore({ home }).find((entry) => entry.name === name)!.grant;

    expect(grantOf({ name: "gmail-oauth.json" })).toBe(undefined);
    expect(grantOf({ name: "drive-oauth.json" })).toBe(undefined);
    expect(grantOf({ name: "outlook-oauth.json" })).toBe(undefined);
    expect(grantOf({ name: "calendar-oauth.json" })!.account).toBe("someone@example.com");
  });

  it("reads Outlook's grant by its MSAL cache and home account, the two fields its door's guard requires", () => {
    const home = makeHome();
    const body = {
      account: "someone@example.com",
      grantedAtIso: "2026-11-07T00:00:00.000Z",
      homeAccountId: "home-account",
      msalCache: "{}",
      scopes: [],
    };
    place({ body: JSON.stringify(body), home, mode: 0o600, name: "outlook-oauth.json" });

    expect(readStore({ home }).find((entry) => entry.name === "outlook-oauth.json")!.grant!.account).toBe(
      "someone@example.com",
    );
  });

  it("yields no grant reading for an Outlook grant with no homeAccountId, which its door refuses", () => {
    const home = makeHome();
    const body = {
      account: "someone@example.com",
      grantedAtIso: "2026-11-07T00:00:00.000Z",
      msalCache: "{}",
      scopes: [],
    };
    place({ body: JSON.stringify(body), home, mode: 0o600, name: "outlook-oauth.json" });

    expect(readStore({ home }).find((entry) => entry.name === "outlook-oauth.json")!.grant).toBe(undefined);
  });

  it("yields no grant reading for a grant carrying a non-string scope, which every door's guard refuses", () => {
    const home = makeHome();
    const body = {
      account: "a@b.c",
      grantedAtIso: "2026-11-07T00:00:00.000Z",
      refreshToken: "r",
      scopes: ["openid", 7],
    };
    place({ body: JSON.stringify(body), home, mode: 0o600, name: "gmail-oauth.json" });

    expect(readStore({ home }).find((entry) => entry.name === "gmail-oauth.json")!.grant).toBe(undefined);
  });

  it("marks a zero-byte file empty by its size, and leaves a non-empty one unmarked", () => {
    const home = makeHome();
    place({ body: "", home, mode: 0o600, name: "linear-token" });
    place({ body: "a-single-line-value", home, mode: 0o600, name: "slack-bot-token" });

    const observedOf = ({ name }: { name: string }) => readStore({ home }).find((entry) => entry.name === name)!;

    expect(observedOf({ name: "linear-token" }).empty).toBe(true);
    expect(observedOf({ name: "slack-bot-token" }).empty).toBe(undefined);
  });

  it("takes the account, the scope COUNT, the write scopes and the expiry out of a grant, and nothing else", () => {
    const home = makeHome();
    const body = JSON.stringify({
      accessToken: "access-SECRET-ACCESS",
      account: "someone@example.com",
      expiryMs: 1_788_753_302_318,
      grantedAtIso: "2026-08-28T18:54:53.663Z",
      refreshToken: "refresh-SECRET-REFRESH",
      scopes: [
        "openid",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.send",
      ],
    });
    place({ body, home, mode: 0o600, name: "gmail-oauth.json" });

    const grant = readStore({ home }).find((entry) => entry.name === "gmail-oauth.json")!.grant!;

    expect(grant.account).toBe("someone@example.com");
    expect(grant.scopeCount).toBe(3);
    expect(grant.writeScopes).toStrictEqual(["https://www.googleapis.com/auth/gmail.send"]);
    expect(grant.expiryMs).toBe(1_788_753_302_318);
    // Both halves, per `.claude/rules/testing.md`'s falsifiable-witness rule.
    expect(body).toContain("SECRET");
    expect(JSON.stringify(grant)).not.toContain("SECRET");
  });

  it("yields no grant reading for a grant file that will not parse, rather than throwing", () => {
    const home = makeHome();
    place({ body: "{ not json", home, mode: 0o600, name: "drive-oauth.json" });

    expect(readStore({ home }).find((entry) => entry.name === "drive-oauth.json")!.grant).toBe(undefined);
  });
});

describe("runSecretsStatusWithDeps", () => {
  it("prints usage and exits 0 on --help, touching no store", () => {
    const sink = collector();
    const code = runSecretsStatusWithDeps({
      argv: ["node", "slopweaver", "secrets", "status", "--help"],
      deps: {
        datadogSite: () => "unset",
        home: () => "/nowhere",
        logger: {
          error: ({ msg }) => sink.errors.push(msg),
          out: ({ line }) => sink.lines.push(line),
        },
        nowMs: () => 0,
        readStore: () => {
          throw new Error("the store must not be read on --help");
        },
      },
    });

    expect(code).toBe(EXIT_OK);
    expect(sink.lines[0]).toContain("usage: slopweaver secrets status");
  });

  it("exits with the usage code on an unknown flag", () => {
    const sink = collector();
    const code = runSecretsStatusWithDeps({
      argv: ["node", "slopweaver", "secrets", "status", "--nope"],
      deps: {
        datadogSite: () => "unset",
        home: () => "/nowhere",
        logger: {
          error: ({ msg }) => sink.errors.push(msg),
          out: ({ line }) => sink.lines.push(line),
        },
        nowMs: () => 0,
        readStore: () => [],
      },
    });

    expect(code).toBe(EXIT_USAGE);
    expect(sink.errors.join(" ")).toContain("--nope");
  });

  it("surfaces the four states unasked, over a real store on disk", () => {
    const home = makeHome();
    place({ body: "x", home, mode: 0o600, name: "gmail-client-id" });
    place({ body: "y", home, mode: 0o600, name: "some-hand-placed-token" });
    place({
      body: JSON.stringify({
        account: "someone@example.com",
        expiryMs: 1,
        grantedAtIso: "2026-08-28T18:54:53.663Z",
        refreshToken: "r",
        scopes: ["a"],
      }),
      home,
      mode: 0o600,
      name: "gmail-oauth.json",
    });
    place({
      body: JSON.stringify({
        account: "someone@example.com",
        grantedAtIso: "2026-09-05T01:14:31.699Z",
        refreshToken: "r",
        scopes: ["a"],
      }),
      home,
      mode: 0o600,
      name: "drive-oauth.json",
    });
    const sink = collector();

    const code = runSecretsStatusWithDeps({
      argv: ["node", "slopweaver", "secrets", "status", "--home", home],
      deps: {
        datadogSite: () => "unset",
        home: () => "/nowhere",
        logger: {
          error: ({ msg }) => sink.errors.push(msg),
          out: ({ line }) => sink.lines.push(line),
        },
        nowMs: () => 1_788_800_000_000,
        readStore,
      },
    });
    const findings = sink.lines.slice(0, sink.lines.indexOf(""));

    expect(code).toBe(EXIT_OK);
    expect(findings[0]).toBe("4 finding(s):");
    expect(findings.join("\n")).toContain("gmail-oauth.json        access-token-expired");
    expect(findings.join("\n")).toContain("drive-oauth.json        expiry-unrecorded");
    expect(findings.join("\n")).toContain("gmail-client-id         dead");
    expect(findings.join("\n")).toContain("some-hand-placed-token  off-allowlist");
  });

  it("leads with an admin grant on disk carrying a Gmail write, and prints it read-write", () => {
    const home = makeHome();
    place({
      body: JSON.stringify({
        account: "admin@example.com",
        expiryMs: 1_788_900_000_000,
        grantedAtIso: "2026-09-06T08:33:38.735Z",
        refreshToken: "r",
        scopes: [
          "https://www.googleapis.com/auth/userinfo.email",
          "https://www.googleapis.com/auth/admin.directory.user.readonly",
          "https://www.googleapis.com/auth/gmail.send",
        ],
      }),
      home,
      mode: 0o600,
      name: "google-admin-oauth.json",
    });
    const sink = collector();

    runSecretsStatusWithDeps({
      argv: ["node", "slopweaver", "secrets", "status", "--home", home, "--json"],
      deps: {
        datadogSite: () => "unset",
        home: () => "/nowhere",
        logger: {
          error: ({ msg }) => sink.errors.push(msg),
          out: ({ line }) => sink.lines.push(line),
        },
        nowMs: () => 1_788_800_000_000,
        readStore,
      },
    });
    const rows: readonly { name: string; state: string; mintScope: string }[] = JSON.parse(sink.lines[0]!).rows;
    const admin = rows.find((row) => row.name === "google-admin-oauth.json")!;

    expect(admin.state).toBe("write-scope-on-read-only");
    expect(admin.mintScope).toBe("read-write");
  });

  it("names a retired credential under --all over an empty store, and hides it by default", () => {
    const home = makeHome();
    const all = collector();
    const plain = collector();
    const depsFor = ({ sink }: { sink: { lines: string[]; errors: string[] } }): SecretsStatusDeps => ({
      datadogSite: () => "unset",
      home: () => "/nowhere",
      logger: {
        error: ({ msg }) => sink.errors.push(msg),
        out: ({ line }) => sink.lines.push(line),
      },
      nowMs: () => 1_788_800_000_000,
      readStore,
    });

    runSecretsStatusWithDeps({
      argv: ["node", "slopweaver", "secrets", "status", "--home", home, "--all", "--json"],
      deps: depsFor({ sink: all }),
    });
    runSecretsStatusWithDeps({
      argv: ["node", "slopweaver", "secrets", "status", "--home", home, "--json"],
      deps: depsFor({ sink: plain }),
    });

    expect(all.lines.join("\n")).toContain('"name":"gmail-client-id"');
    expect(all.lines.join("\n")).toContain('"name":"gmail-client-secret"');
    expect(all.lines.join("\n")).toContain('"state":"absent"');
    expect(plain.lines.join("\n")).toContain('"rows":[]');
  });

  it("emits every row under --json, and no token anywhere in the output", () => {
    const home = makeHome();
    place({ body: "THE-SECRET-VALUE", home, mode: 0o600, name: "slack-bot-token" });
    place({
      body: JSON.stringify({
        accessToken: "access-THE-SECRET-VALUE",
        account: "someone@example.com",
        expiryMs: 1,
        grantedAtIso: "2026-08-28T18:54:53.663Z",
        refreshToken: "refresh-THE-SECRET-VALUE",
        scopes: ["a"],
      }),
      home,
      mode: 0o600,
      name: "gmail-oauth.json",
    });
    const sink = collector();

    runSecretsStatusWithDeps({
      argv: ["node", "slopweaver", "secrets", "status", "--home", home, "--all", "--json"],
      deps: {
        datadogSite: () => "unset",
        home: () => "/nowhere",
        logger: {
          error: ({ msg }) => sink.errors.push(msg),
          out: ({ line }) => sink.lines.push(line),
        },
        nowMs: () => 1_788_800_000_000,
        readStore,
      },
    });
    const emitted = sink.lines.join("\n");

    expect(emitted).toContain('"name":"slack-bot-token"');
    expect(emitted).toContain('"state":"access-token-expired"');
    expect(emitted).not.toContain("THE-SECRET-VALUE");
  });

  it("carries the home's Datadog site verdict beside the rows under --json, for the home it read", () => {
    const home = makeHome();
    const sink = collector();
    const asked: string[] = [];

    runSecretsStatusWithDeps({
      argv: ["node", "slopweaver", "secrets", "status", "--home", home, "--json"],
      deps: {
        datadogSite: ({ home: target }) => {
          asked.push(target);
          return "invalid";
        },
        home: () => "/nowhere",
        logger: {
          error: ({ msg }) => sink.errors.push(msg),
          out: ({ line }) => sink.lines.push(line),
        },
        nowMs: () => 1_788_800_000_000,
        readStore,
      },
    });

    expect(JSON.parse(sink.lines[0]!).datadogSite).toBe("invalid");
    expect(asked).toEqual([home]);
  });
});
