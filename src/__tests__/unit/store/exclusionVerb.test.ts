/**
 * The `store exclusions` verb — that the manifest can dispatch it, and that every refusal lands before a
 * database connection is opened.
 *
 * Parse-first is the property, not a convention: `purge --apply` deletes half this store, so an invocation
 * that is going to be refused must be refused before anything connects. This is also the test the
 * `manifest-loader-tests` gate asks for — a command module the CLI can dispatch that no test imports is,
 * as far as the suite is concerned, wired to nothing.
 */
import { describe, expect, it } from "vitest";

import { runStoreExclusions, storeExclusionsCommand } from "../../../cli/commands/store/exclusion.js";
import { EXIT_USAGE } from "../../../cli/exitCodes.js";

/** An invocation as the router hands it over: `[node, cli, store, exclusions, …]`. */
function argvFor({ tail }: { tail: readonly string[] }): readonly string[] {
  return ["node", "cli", "store", "exclusions", ...tail];
}

describe("the verb the manifest can dispatch", () => {
  it("exports the runner itself — `defineCommand` returns it rather than a wrapper", () => {
    expect(storeExclusionsCommand).toBe(runStoreExclusions);
  });
});

describe("every refusal lands before anything connects", () => {
  it("refuses a missing verb", async () => {
    expect(await runStoreExclusions(argvFor({ tail: [] }))).toBe(EXIT_USAGE);
  });

  it("refuses a verb it does not have", async () => {
    expect(await runStoreExclusions(argvFor({ tail: ["delete"] }))).toBe(EXIT_USAGE);
  });

  it("refuses detect --apply, because detection can never change policy", async () => {
    expect(await runStoreExclusions(argvFor({ tail: ["detect", "--apply"] }))).toBe(EXIT_USAGE);
  });

  it("refuses an unknown flag rather than ignoring it", async () => {
    expect(await runStoreExclusions(argvFor({ tail: ["purge", "--force"] }))).toBe(EXIT_USAGE);
  });

  it("refuses detect --delete-human-threads, since rule D is a property of what a purge removes", async () => {
    expect(await runStoreExclusions(argvFor({ tail: ["detect", "--delete-human-threads"] }))).toBe(EXIT_USAGE);
  });
});
