/**
 * The Trelica tenant-host refusals: each factory's code and exact text, and the lines each one prints.
 *
 * None may carry the host value, so the two list-carrying refusals are asserted whole — every field and
 * every line — and the unset refusal keeps the reader's own problems first, in order.
 */
import { describe, expect, it } from "vitest";

import { TrelicaAtlasErrors, trelicaAtlasErrorLines } from "../../../../atlas/trelica/errors.js";

describe("TrelicaAtlasErrors — the tenant host", () => {
  it("names a loose host file by path", () => {
    const error = TrelicaAtlasErrors.hostFileLoose({ path: "/h/secrets/trelica-tenant-host" });
    expect(error.code).toBe("HOST_FILE_LOOSE");
    expect(trelicaAtlasErrorLines({ error })).toEqual([
      "the Trelica tenant host must be owner-only (mode 0600 or stricter): /h/secrets/trelica-tenant-host",
    ]);
  });

  it("names an empty host file by path", () => {
    const error = TrelicaAtlasErrors.hostFileEmpty({ path: "/h/secrets/trelica-tenant-host" });
    expect(error.code).toBe("HOST_FILE_EMPTY");
    expect(error.message).toBe("the Trelica tenant host file is empty: /h/secrets/trelica-tenant-host");
  });

  it("names an unreadable host file and why", () => {
    const error = TrelicaAtlasErrors.hostFileUnreadable({
      cause: new Error("EACCES"),
      path: "/h/secrets/trelica-tenant-host",
    });
    expect(error.code).toBe("HOST_FILE_UNREADABLE");
    expect(error.message).toBe("could not read the Trelica tenant host at /h/secrets/trelica-tenant-host: EACCES");
  });

  it("prints the reader's problems, then the command that sets the host, then why nothing guesses one", () => {
    const error = TrelicaAtlasErrors.tenantHostUnset({
      problems: ["first problem", "second problem"],
      secretName: "trelica-tenant-host",
    });
    expect(error.code).toBe("TENANT_HOST_UNSET");
    expect(trelicaAtlasErrorLines({ error })).toEqual([
      "first problem",
      "second problem",
      "set it with: slopweaver secrets set trelica-tenant-host — the value is your own tenant host, the one your browser is on after signing in",
      "nothing here guesses a tenant: a guessed one would either not exist or belong to somebody else",
    ]);
  });

  it("prints a malformed host's refusal as two lines naming the secret and the suffix, never a value", () => {
    const error = TrelicaAtlasErrors.tenantHostMalformed({ secretName: "trelica-tenant-host", suffix: ".trelica.app" });
    expect(error).toEqual({
      code: "TENANT_HOST_MALFORMED",
      message:
        "trelica-tenant-host does not look like a tenant host: expected one label beneath .trelica.app; the value is the host your browser shows once signed in, not the shared sign-in host",
      reasons: [
        "trelica-tenant-host does not look like a tenant host: expected one label beneath .trelica.app",
        "the value is the host your browser shows once signed in, not the shared sign-in host",
      ],
      secretName: "trelica-tenant-host",
      suffix: ".trelica.app",
    });
  });

  it("prints a pre-existing tenant refusal's reasons, one per line", () => {
    const error = TrelicaAtlasErrors.tenantUnresolved({ reasons: ["one", "two"] });
    expect(trelicaAtlasErrorLines({ error })).toEqual(["one", "two"]);
  });

  it("makes a tenant refusal's first reason its message, the whole list kept beside it", () => {
    expect(TrelicaAtlasErrors.tenantUnresolved({ reasons: ["no Chrome profile is recorded", "two"] })).toEqual({
      code: "TENANT_UNRESOLVED",
      message: "no Chrome profile is recorded",
      reasons: ["no Chrome profile is recorded", "two"],
    });
  });

  it("prints a single-sentence failure as its message", () => {
    const error = TrelicaAtlasErrors.sessionLost({ origin: "https://t.example.test" });
    expect(trelicaAtlasErrorLines({ error })).toEqual([
      "the signed-in session for https://t.example.test is gone — open it in Chrome and sign in, then run this again",
    ]);
  });
});

describe("TrelicaAtlasErrors.bodyShapeChanged", () => {
  it("names the first three drifted keys and counts the rest, carrying every one on the error", () => {
    const drift = ["a", "b", "c", "d", "e"].map((key) => ({
      detail: `new field "${key}"`,
      kind: "new" as const,
      path: key,
    }));
    const error = TrelicaAtlasErrors.bodyShapeChanged({ callId: "roles", drift });
    expect(error.message).toBe(
      'roles answered a shape this version does not read, so nothing it answered is held: new field "a"; new field "b"; new field "c" (+2 more)',
    );
    expect(error.drift.length).toBe(5);
  });

  it("names every key when there are three or fewer", () => {
    const error = TrelicaAtlasErrors.bodyShapeChanged({
      callId: "roles",
      drift: [{ detail: 'field "total" is missing', kind: "missing", path: "total" }],
    });
    expect(error.message).toBe(
      'roles answered a shape this version does not read, so nothing it answered is held: field "total" is missing',
    );
  });
});
