/**
 * The secrets-store canon gate — every surface a stranded session reads names where the credentials are.
 *
 * Two describe blocks, the shape `staleReferences.test.ts` established: the first drives the pure predicate
 * over inline fixtures and never touches disk; the second reads THIS repository's real canon files and the
 * REAL store path, so the check is a binding between the prose and the code rather than a grep for a string
 * this file's own author wrote.
 *
 * The falsifiability argument is in `src/canon/secretsStoreMention.ts`'s header: the directory name is
 * derived from `stateHomePaths` at the call site below, so moving the store reddens every row here.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mentionsSecretsStore, REQUIRED_SECRETS_MENTIONS } from "../../../canon/secretsStoreMention.js";
import { stateHomePaths } from "../../../stateHome.js";

describe("mentionsSecretsStore", () => {
  it("accepts a file naming both the store path and the verb that reads it", () => {
    expect(
      mentionsSecretsStore({
        storeDirectory: "secrets",
        text: "Credentials sit in `$SLOPWEAVER_HOME/secrets/`, and `slopweaver secrets status` names them.",
      }),
    ).toBe(true);
  });

  it("rejects a file naming the path but no verb, which leaves a session to ls and guess", () => {
    expect(
      mentionsSecretsStore({
        storeDirectory: "secrets",
        text: "Credentials sit in `$SLOPWEAVER_HOME/secrets/`.",
      }),
    ).toBe(false);
  });

  it("rejects a file naming the verb but no path, which strands a host that cannot run it", () => {
    expect(
      mentionsSecretsStore({ storeDirectory: "secrets", text: "Run `slopweaver secrets status` to see them." }),
    ).toBe(false);
  });

  it("rejects prose written for a DIFFERENT directory — the move this gate exists to catch", () => {
    expect(
      mentionsSecretsStore({
        storeDirectory: "credentials",
        text: "Credentials sit in `$SLOPWEAVER_HOME/secrets/`, and `slopweaver secrets status` names them.",
      }),
    ).toBe(false);
  });

  it("rejects a file that says nothing about the store at all", () => {
    expect(mentionsSecretsStore({ storeDirectory: "secrets", text: "# Testing\n\nZero mocks." })).toBe(false);
  });
});

describe("the real canon files", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..", "..", "..");
  // Derived, never typed: this is the one place the tree decides where a secret file goes, so canon that
  // disagrees with it is canon that has gone stale — which is exactly what this gate is for.
  const storeDirectory = basename(stateHomePaths({ home: "/nonexistent-home" }).secrets);

  it("derives the store directory from stateHomePaths rather than from this test", () => {
    expect(storeDirectory).toBe("secrets");
  });

  it("declares at least one required surface", () => {
    expect(REQUIRED_SECRETS_MENTIONS.length).toBeGreaterThan(0);
  });

  it("finds the store named on every required canon surface", () => {
    const silent = REQUIRED_SECRETS_MENTIONS.filter(
      (required) => !mentionsSecretsStore({ storeDirectory, text: readFileSync(join(root, required.path), "utf8") }),
    ).map((required) => `${required.path} — ${required.because}`);
    expect(silent).toEqual([]);
  });
});
