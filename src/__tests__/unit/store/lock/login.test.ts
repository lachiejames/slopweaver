/**
 * The verbs' login: the password's shape, the SCRAM verifier, the role script's create/rotate guards, and the URL.
 * The verifier is proven against a real server by the throwaway-stack run (the login it sets logs in); here it is
 * held to its format and to depending on both the password and the salt.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import {
  LOCK_ROLE_MARKER,
  loginRoleScript,
  loginUrl,
  namesLoginRole,
  passwordFrom,
  SCRAM_ITERATIONS,
  scramVerifier,
} from "../../../../store/lock/login.js";

const SALT = new Uint8Array(16).fill(1);
const PASSWORD = unwrap(passwordFrom({ random: new Uint8Array(32).fill(7) }));

describe("passwordFrom", () => {
  it("encodes 32 bytes as a 43-character base64url password", () => {
    expect(PASSWORD).toBe("BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc");
  });

  it("refuses the wrong number of bytes", () => {
    expect(unwrapErr(passwordFrom({ random: new Uint8Array(16) })).message).toContain(
      "expected 32 random bytes, got 16",
    );
  });
});

describe("scramVerifier", () => {
  it("spells the verifier the way pg_authid stores it", () => {
    expect(scramVerifier({ password: PASSWORD, salt: SALT })).toMatch(
      new RegExp(
        `^SCRAM-SHA-256\\$${String(SCRAM_ITERATIONS)}:AQEBAQEBAQEBAQEBAQEBAQ==\\$[A-Za-z0-9+/]{43}=:[A-Za-z0-9+/]{43}=$`,
      ),
    );
  });

  it("is deterministic for one password and salt, and changes with either", () => {
    const one = scramVerifier({ password: PASSWORD, salt: SALT });
    expect(scramVerifier({ password: PASSWORD, salt: SALT })).toBe(one);
    expect(scramVerifier({ password: `${PASSWORD.slice(1)}x`, salt: SALT })).not.toBe(one);
    expect(scramVerifier({ password: PASSWORD, salt: new Uint8Array(16).fill(2) })).not.toBe(one);
  });

  it("never carries the password itself", () => {
    expect(scramVerifier({ password: PASSWORD, salt: SALT })).not.toContain(PASSWORD);
  });
});

describe("loginRoleScript", () => {
  const verifier = scramVerifier({ password: PASSWORD, salt: SALT });

  it("creates the role with a statement that fails if it already exists, marked as backed up in the same transaction", () => {
    const script = unwrap(loginRoleScript({ mode: "create", verifier }));
    expect(script.split("\n")).toEqual([
      "\\set ON_ERROR_STOP on",
      "begin;",
      "set local synchronous_commit = on;",
      "create role slopweaver_login login;",
      `comment on role slopweaver_login is '${LOCK_ROLE_MARKER}';`,
      `alter role slopweaver_login with login noinherit password '${verifier}';`,
      "grant postgres to slopweaver_login with inherit false, set true;",
      "alter role slopweaver_login set role = 'postgres';",
      "commit;",
      "",
    ]);
  });

  it("rotates only a role that is there, raising otherwise", () => {
    const script = unwrap(loginRoleScript({ mode: "rotate", verifier }));
    expect(script).toContain("raise exception 'the role slopweaver_login is not there to rotate'");
    expect(script).not.toContain("create role");
    expect(script).not.toContain("comment on role");
    expect(script.split("\n").slice(1, 3)).toEqual(["begin;", "set local synchronous_commit = on;"]);
  });

  it("refuses a verifier that could break out of its literal", () => {
    expect(unwrapErr(loginRoleScript({ mode: "create", verifier: "x'; drop role postgres; --" })).message).toContain(
      "the verifier is not a SCRAM-SHA-256 string",
    );
  });
});

describe("loginUrl", () => {
  it("builds the login's URL at the stack's port", () => {
    expect(unwrap(loginUrl({ database: "slopweaver", password: PASSWORD, port: 55322 }))).toBe(
      `postgresql://slopweaver_login:${PASSWORD}@127.0.0.1:55322/slopweaver`,
    );
  });

  it("refuses a password that is not a generated one", () => {
    expect(unwrapErr(loginUrl({ database: "x", password: "p@ss:word", port: 1 })).message).toContain(
      "the password is not a generated one",
    );
  });
});

describe("namesLoginRole", () => {
  it("is true only for a URL whose user is the login role", () => {
    expect(namesLoginRole({ url: `postgresql://slopweaver_login:${PASSWORD}@127.0.0.1:1/x` })).toBe(true);
    expect(namesLoginRole({ url: "postgresql://postgres:postgres@127.0.0.1:1/x" })).toBe(false);
    expect(namesLoginRole({ url: "not a url" })).toBe(false);
  });
});
