/**
 * The shared grant-file lifecycle in `secrets/grantFile.ts`, over a throwaway home: a write lands owner-only
 * (file 0600, directory 0700) and reads back whole, a missing file is "not connected" rather than an error, an
 * unreadable, unparseable or wrongly shaped one is a named failure, and a remove deletes the file.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { readGrantFile, removeGrantFile, writeGrantFile } from "../../../secrets/grantFile.js";

const homes: string[] = [];

/** A fresh state home for one test. */
function freshHome(): string {
  const home = mkdtempSync(join(tmpdir(), "grant-file-"));
  homes.push(home);
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** The structural guard a provider passes: an object with a string `account`. */
function hasAccount(value: unknown): value is { account: string } {
  return typeof value === "object" && value !== null && "account" in value && typeof value.account === "string";
}

const GRANT = { account: "owner@example.test", scopes: ["Mail.Read"] };

/** Where a test grant lives under a home. */
function grantPath({ home }: { home: string }): string {
  return join(home, "secrets", "example-oauth.json");
}

describe("writeGrantFile and readGrantFile", () => {
  it("writes the grant owner-only and reads it back whole", () => {
    const home = freshHome();
    const path = grantPath({ home });

    const written = unwrap(writeGrantFile({ grant: GRANT, home, path, productName: "Example" }));
    const read = unwrap(
      readGrantFile({ connectVerb: "slopweaver example connect", isGrant: hasAccount, path, productName: "Example" }),
    );

    expect(written).toBe(path);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "secrets")).mode & 0o777).toBe(0o700);
    expect(read).toEqual(GRANT);
  });

  it("serialises two-space indented JSON with a trailing newline", () => {
    const home = freshHome();
    const path = grantPath({ home });

    unwrap(writeGrantFile({ grant: GRANT, home, path, productName: "Example" }));

    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(GRANT, undefined, 2)}\n`);
  });

  it("re-tightens a loose file and directory on an overwrite", () => {
    const home = freshHome();
    const path = grantPath({ home });
    unwrap(writeGrantFile({ grant: GRANT, home, path, productName: "Example" }));
    chmodSync(path, 0o644);
    chmodSync(join(home, "secrets"), 0o755);

    unwrap(writeGrantFile({ grant: { ...GRANT, scopes: [] }, home, path, productName: "Example" }));

    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, "secrets")).mode & 0o777).toBe(0o700);
    expect(unwrap(readGrantFile({ connectVerb: "v", isGrant: hasAccount, path, productName: "Example" }))).toEqual({
      account: "owner@example.test",
      scopes: [],
    });
  });

  it("names a write that cannot happen, with the act, the door and the path", () => {
    const home = freshHome();
    mkdirSync(join(home, "secrets"), { recursive: true });
    const path = join(home, "secrets", "missing-dir", "nested", "grant.json");
    writeFileSync(join(home, "secrets", "missing-dir"), "a file where a directory must go");

    const refused = unwrapErr(writeGrantFile({ grant: GRANT, home, path, productName: "Example" }));

    expect(refused.code).toBe("GRANT_FILE_FAILED");
    expect(refused.message).toContain(`could not write the Example grant at ${path}`);
  });
});

describe("readGrantFile", () => {
  it("reads a home that was never connected as undefined", () => {
    const home = freshHome();

    const read = unwrap(
      readGrantFile({ connectVerb: "v", isGrant: hasAccount, path: grantPath({ home }), productName: "Example" }),
    );

    expect(read).toBe(undefined);
  });

  it("refuses a path it cannot read rather than reporting the door not connected", () => {
    const home = freshHome();
    const path = grantPath({ home });
    mkdirSync(path, { recursive: true });

    const refused = unwrapErr(readGrantFile({ connectVerb: "v", isGrant: hasAccount, path, productName: "Example" }));

    expect(refused.code).toBe("GRANT_FILE_FAILED");
    expect(refused.message).toContain(`could not read the Example grant at ${path}`);
    expect(refused.message).toContain("EISDIR");
  });

  it("refuses a file that is not JSON as corruption", () => {
    const home = freshHome();
    const path = grantPath({ home });
    mkdirSync(join(home, "secrets"), { recursive: true });
    writeFileSync(path, "{not json");

    const refused = unwrapErr(readGrantFile({ connectVerb: "v", isGrant: hasAccount, path, productName: "Example" }));

    expect(refused.code).toBe("GRANT_JSON_INVALID");
    expect(refused.message).toContain("the stored Example grant is not valid JSON");
  });

  it("never quotes a corrupt grant's contents in its message, though the parser's own error does", () => {
    const home = freshHome();
    const path = grantPath({ home });
    mkdirSync(join(home, "secrets"), { recursive: true });
    writeFileSync(path, "FIXTURE_REFRESH_TOKEN_VALUE");

    const refused = unwrapErr(readGrantFile({ connectVerb: "v", isGrant: hasAccount, path, productName: "Example" }));

    // The witness that this input WOULD leak: the parser's own message quotes it.
    expect(() => JSON.parse("FIXTURE_REFRESH_TOKEN_VALUE")).toThrow("FIXTURE_RE");
    expect(refused.code).toBe("GRANT_JSON_INVALID");
    expect(refused.message).toBe(
      "the stored Example grant is not valid JSON (the parser's detail is withheld: it quotes the file)",
    );
  });

  it("refuses JSON the provider's guard rejects, naming the connect verb", () => {
    const home = freshHome();
    const path = grantPath({ home });
    mkdirSync(join(home, "secrets"), { recursive: true });
    writeFileSync(path, JSON.stringify({ refreshToken: "synthetic" }));

    const refused = unwrapErr(
      readGrantFile({ connectVerb: "slopweaver example connect", isGrant: hasAccount, path, productName: "Example" }),
    );

    expect(refused.code).toBe("GRANT_SHAPE_INVALID");
    expect(refused.message).toBe(
      "the stored Example grant is missing account, scopes or refreshToken, or holds a field of the wrong shape — re-run `slopweaver example connect`",
    );
  });
});

describe("removeGrantFile", () => {
  it("deletes the grant and answers the path that went", () => {
    const home = freshHome();
    const path = grantPath({ home });
    unwrap(writeGrantFile({ grant: GRANT, home, path, productName: "Example" }));

    const removed = unwrap(removeGrantFile({ path, productName: "Example" }));

    expect(removed).toBe(path);
    expect(unwrap(readGrantFile({ connectVerb: "v", isGrant: hasAccount, path, productName: "Example" }))).toBe(
      undefined,
    );
  });

  it("names a delete of a grant that is not there", () => {
    const home = freshHome();
    const path = grantPath({ home });

    const refused = unwrapErr(removeGrantFile({ path, productName: "Example" }));

    expect(refused.code).toBe("GRANT_FILE_FAILED");
    expect(refused.message).toContain(`could not delete the Example grant at ${path}`);
    expect(refused.message).toContain("ENOENT");
  });
});
