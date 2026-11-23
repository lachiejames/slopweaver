/**
 * The store's database SELECTION — where it comes from, and what happens when nothing selected one.
 *
 * The property under test is the one a past change broke on: a selection that lives only in a shell
 * variable is not there when a bot turn runs, so the turn's history leg refused and it read files instead.
 * These assert the precedence and, as carefully, that nothing here ever invents a database.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { STORE_URL_ENV, STORE_URL_SECRET, storeUrl, storeUrlSelection } from "../../../store/config.js";

/** A home whose secrets directory holds exactly the given selection, or no selection at all. */
function homeWith({ url }: { url?: string }): string {
  const home = mkdtempSync(join(tmpdir(), "store-config-"));
  mkdirSync(join(home, "secrets"), { recursive: true });
  if (url !== undefined) {
    writeFileSync(join(home, "secrets", STORE_URL_SECRET), url, { mode: 0o600 });
  }
  return home;
}

const homes: string[] = [];

/** Mint a sandbox home and remember it for teardown. */
function sandbox({ url }: { url?: string } = {}): string {
  const home = homeWith(url === undefined ? {} : { url });
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

describe("where the store's connection string comes from", () => {
  it("takes the environment first, and says so, because a throwaway database for one run must win", () => {
    const selection = unwrap(
      storeUrlSelection({
        env: { [STORE_URL_ENV]: "postgresql://127.0.0.1:1/one" },
        home: sandbox({ url: "postgresql://127.0.0.1:2/two" }),
      }),
    );
    expect(selection.url).toBe("postgresql://127.0.0.1:1/one");
    expect(selection.origin).toBe("environment");
  });

  it("falls back to the selection remembered under the home, which is what a bot turn actually reads", () => {
    const selection = unwrap(
      storeUrlSelection({ env: {}, home: sandbox({ url: "postgresql://localhost:5432/remembered" }) }),
    );
    expect(selection.url).toBe("postgresql://localhost:5432/remembered");
    expect(selection.origin).toBe("secret");
  });

  it("reads the remembered selection under the home it was GIVEN, never the default one", () => {
    const first = sandbox({ url: "postgresql://127.0.0.1/first" });
    const second = sandbox({ url: "postgresql://127.0.0.1/second" });
    expect(unwrap(storeUrlSelection({ env: {}, home: first })).url).toBe("postgresql://127.0.0.1/first");
    expect(unwrap(storeUrlSelection({ env: {}, home: second })).url).toBe("postgresql://127.0.0.1/second");
  });

  it("trims the newline a shell pipe adds, so `printf | secrets set` and an echo behave the same", () => {
    expect(unwrap(storeUrlSelection({ env: {}, home: sandbox({ url: "postgresql://127.0.0.1/trimmed\n" }) })).url).toBe(
      "postgresql://127.0.0.1/trimmed",
    );
  });

  it("treats a blank environment value as absent rather than as a selection of nothing", () => {
    const selection = unwrap(
      storeUrlSelection({ env: { [STORE_URL_ENV]: "   " }, home: sandbox({ url: "postgresql://127.0.0.1/fallback" }) }),
    );
    expect(selection.url).toBe("postgresql://127.0.0.1/fallback");
    expect(selection.origin).toBe("secret");
  });

  it("REFUSES with neither present — it never defaults a host, a port or a database", () => {
    const refused = storeUrlSelection({ env: {}, home: sandbox() });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("STORE_URL_MISSING");
  });

  it("names BOTH places in the refusal, because naming only the variable is what left every later process refusing", () => {
    const refused = storeUrlSelection({ env: {}, home: sandbox() });
    expect(refused.isErr()).toBe(true);
    const message = refused._unsafeUnwrapErr().message;
    expect(message).toContain(STORE_URL_ENV);
    expect(message).toContain(`secrets set ${STORE_URL_SECRET}`);
  });

  it("treats a blank remembered file as no selection at all, not as an empty connection string", () => {
    const refused = storeUrlSelection({ env: {}, home: sandbox({ url: "\n" }) });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("STORE_URL_MISSING");
  });

  it("REFUSES a host that is not this machine, naming the host and saying no hatch opens it", () => {
    const refused = storeUrlSelection({
      env: {},
      home: sandbox({ url: "postgresql://db.example.supabase.co:5432/postgres" }),
    });
    expect(refused.isErr()).toBe(true);
    const error = refused._unsafeUnwrapErr();
    expect(error.code).toBe("STORE_URL_REMOTE");
    expect(error.message).toContain("names host db.example.supabase.co");
    expect(error.message).toContain("This hold has no escape hatch");
    expect(error.message).toContain(`slopweaver secrets set ${STORE_URL_SECRET}`);
    expect(error.message).not.toContain("SLOPWEAVER_ALLOW_");
  });

  /**
   * The removed hatch was ambient and opened on its variable set to exactly `1`; a journalled grant never
   * applied to it. Each case below sets that former key — plus near spellings an operator might try — on
   * BOTH ways a URL is selected, and every one must still refuse. Before the removal the first case admitted.
   */
  const FORMER_HATCH = "SLOPWEAVER_ALLOW_REMOTE_STORE";
  const REMOTE_URLS = [
    ["a hosted Postgres", "postgresql://db.example.supabase.co:5432/postgres", "db.example.supabase.co"],
    ["a LAN address", "postgresql://10.0.0.5:5432/postgres", "10.0.0.5"],
    ["another public host", "postgres://user:pw@203.0.113.7/store", "203.0.113.7"],
  ] as const;

  it("refuses a string the URL standard reads as localhost while the store's client would reach another host", () => {
    for (const setting of FORMER_HATCH_SETTINGS) {
      const refused = storeUrl({
        env: { ...setting, [STORE_URL_ENV]: "postgresql://u:p@db.example.com,x@localhost/store" },
        home: sandbox(),
      });
      expect(refused.isErr()).toBe(true);
      expect(refused._unsafeUnwrapErr().code).toBe("STORE_URL_REMOTE");
      expect(refused._unsafeUnwrapErr().message).toContain("names host db.example.com");
    }
  });

  const FORMER_HATCH_SETTINGS = [
    { [FORMER_HATCH]: "1" },
    { [FORMER_HATCH]: "true" },
    { [FORMER_HATCH]: "yes" },
    { [FORMER_HATCH]: "1", SLOPWEAVER_ALLOW_LOCAL_STORE_ELSEWHERE: "1", SLOPWEAVER_ALLOW_STALE_STORE: "1" },
  ] as const;

  it("has the cases it claims, so the loops below cannot pass over nothing", () => {
    expect(REMOTE_URLS.length).toBeGreaterThan(0);
    expect(FORMER_HATCH_SETTINGS.length).toBeGreaterThan(0);
  });

  it.each(REMOTE_URLS)("refuses %s remembered under the home with every former hatch set", (_label, url, host) => {
    for (const setting of FORMER_HATCH_SETTINGS) {
      const refused = storeUrlSelection({ env: { ...setting }, home: sandbox({ url }) });
      expect(refused.isErr()).toBe(true);
      expect(refused._unsafeUnwrapErr().code).toBe("STORE_URL_REMOTE");
      expect(refused._unsafeUnwrapErr().message).toContain(`names host ${host}`);
    }
  });

  it.each(REMOTE_URLS)("refuses %s set through the environment with every former hatch set", (_label, url) => {
    for (const setting of FORMER_HATCH_SETTINGS) {
      const refused = storeUrl({ env: { ...setting, [STORE_URL_ENV]: url }, home: sandbox() });
      expect(refused.isErr()).toBe(true);
      expect(refused._unsafeUnwrapErr().code).toBe("STORE_URL_REMOTE");
    }
  });

  it("refuses a remote host set through the ENVIRONMENT too — the variable is not a way around the rule", () => {
    const refused = storeUrlSelection({ env: { [STORE_URL_ENV]: "postgresql://10.0.0.5/postgres" }, home: sandbox() });
    expect(refused.isErr()).toBe(true);
    expect(refused._unsafeUnwrapErr().code).toBe("STORE_URL_REMOTE");
  });

  it("hands back the string alone through `storeUrl`, for the callers that only ever open a connection", () => {
    expect(unwrap(storeUrl({ env: {}, home: sandbox({ url: "postgresql://[::1]/bare" }) }))).toBe(
      "postgresql://[::1]/bare",
    );
  });
});
