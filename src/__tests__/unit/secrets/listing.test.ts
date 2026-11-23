/**
 * `listSecretFileNames` — the names-only read of the secrets store, over a throwaway home: an absent store is
 * empty, a store that cannot be listed is an error rather than an empty list, and only regular files count.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { listSecretFileNames } from "../../../secrets/listing.js";
import { stateHomePaths } from "../../../stateHome.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "secrets-listing-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("listSecretFileNames", () => {
  it("answers an empty list when there is no secrets directory — an install that connected nothing", () => {
    expect(unwrap(listSecretFileNames({ home }))).toEqual([]);
  });

  it("lists the regular files by name, in name order, and leaves a subdirectory out", () => {
    const dir = stateHomePaths({ home }).secrets;
    mkdirSync(join(dir, "nested"), { recursive: true });
    writeFileSync(join(dir, "slack-bot-token"), "x");
    writeFileSync(join(dir, "github-token"), "y");

    expect(unwrap(listSecretFileNames({ home }))).toEqual(["github-token", "slack-bot-token"]);
  });

  it("refuses rather than answering empty when the secrets path is not a directory", () => {
    const dir = stateHomePaths({ home }).secrets;
    writeFileSync(dir, "not a directory");

    const failure = unwrapErr(listSecretFileNames({ home }));

    expect([failure.code, failure.message.startsWith(`could not list the secrets store at ${dir}: ENOTDIR`)]).toEqual([
      "SECRETS_STORE_UNREADABLE",
      true,
    ]);
  });

  it("refuses rather than answering empty when the secrets path is a link whose target is gone", () => {
    const dir = stateHomePaths({ home }).secrets;
    symlinkSync(join(home, "unmounted-volume"), dir);

    const failure = unwrapErr(listSecretFileNames({ home }));

    expect([failure.code, failure.message.startsWith(`could not list the secrets store at ${dir}: ENOENT`)]).toEqual([
      "SECRETS_STORE_UNREADABLE",
      true,
    ]);
  });

  it("refuses rather than dropping an entry inside the store that is a link whose target is gone", () => {
    const dir = stateHomePaths({ home }).secrets;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "google-client-id"), "x");
    const entry = join(dir, "google-client-secret");
    symlinkSync(join(home, "unmounted-volume", "google-client-secret"), entry);

    const failure = unwrapErr(listSecretFileNames({ home }));

    expect([failure.code, failure.message.startsWith(`could not list the secrets store at ${entry}: ENOENT`)]).toEqual([
      "SECRETS_STORE_UNREADABLE",
      true,
    ]);
  });

  it("refuses rather than answering empty when the home itself is a link whose target is gone", () => {
    const danglingHome = join(home, "home-link");
    symlinkSync(join(home, "unmounted-volume"), danglingHome);

    const failure = unwrapErr(listSecretFileNames({ home: danglingHome }));

    expect(failure.code).toBe("SECRETS_STORE_UNREADABLE");
  });
});
