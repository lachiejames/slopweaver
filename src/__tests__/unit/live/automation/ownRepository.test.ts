import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  ownRepositoryDeclaration,
  ownRepositoryStateOf,
  ownRepositoryUnresolvedLine,
  resolveOwnRepository,
} from "../../../../live/automation/ownRepository.js";
import { readOwnRepositories, recordOwnRepository } from "../../../../live/automation/ownRepositoryStore.js";
import { stateHomePaths } from "../../../../stateHome.js";
import { checkoutWithOrigin, declareMainCheckouts, originsAt, plainCheckout } from "../../../ownRepositoryFixture.js";
import { REAL_GIT_TIMEOUT_MS } from "../../../tempGitRepo.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "own-repository-home-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Write raw bytes where the history lives. */
function writeHistory({ text }: { readonly text: string }): string {
  const path = stateHomePaths({ home }).live.recipe.ownRepositoriesJson;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
  return path;
}

/**
 * Declare plain checkouts with these origins (a `null` slug has none) and answer the reader a resolution is given.
 *
 * @returns the fake `originOf` over the declared checkouts
 */
function declareOrigins({
  slugs,
}: {
  readonly slugs: readonly (string | null)[];
}): (args: { cwd: string }) => string | undefined {
  const declared = slugs.map((slug) => ({ path: plainCheckout(), slug }));
  declareMainCheckouts({ home, paths: declared.map(({ path }) => path) });
  return originsAt({
    origins: declared.flatMap(({ path, slug }) => (slug === null ? [] : [{ path, slug }])),
  });
}

describe("resolveOwnRepository (real git, scratch home)", { timeout: REAL_GIT_TIMEOUT_MS }, () => {
  // The one witness that the production reader is git's: every other case answers `origin` with a fake.
  it("answers the declared checkout named slopweaver, whatever else is declared, lower-cased", () => {
    const paths = [checkoutWithOrigin({ slug: "acme/widgets" }), checkoutWithOrigin({ slug: "Acme/Slopweaver" })];
    declareMainCheckouts({ home, paths });
    expect(unwrap(resolveOwnRepository({ home }))).toBe("acme/slopweaver");
  });
});

describe("resolveOwnRepository", () => {
  it("refuses a home declaring no such checkout, rather than guessing an address", () => {
    expect(unwrapErr(resolveOwnRepository({ home, originOf: () => undefined })).code).toBe("CHECKOUT_NAME_UNDECLARED");
  });

  it("refuses two owners' checkouts of that name, rather than picking one", () => {
    const originOf = declareOrigins({ slugs: ["acme/slopweaver", "widgets/slopweaver"] });
    expect(unwrapErr(resolveOwnRepository({ home, originOf })).code).toBe("CHECKOUT_NAME_AMBIGUOUS");
  });

  it("does not read a checkout with no origin as this repository", () => {
    const originOf = declareOrigins({ slugs: [null] });
    expect(unwrapErr(resolveOwnRepository({ home, originOf })).code).toBe("CHECKOUT_NAME_UNDECLARED");
  });

  it("reads each checkout's origin once, so a second read that fails cannot refuse the one that matched", () => {
    const paths = [plainCheckout(), plainCheckout()];
    declareMainCheckouts({ home, paths });
    const asked: string[] = [];
    const answers = new Map([
      [realpathSync(paths[0]!), "acme/widgets"],
      [realpathSync(paths[1]!), "Acme/Slopweaver"],
    ]);
    const originOf = ({ cwd }: { cwd: string }): string | undefined => {
      const path = realpathSync(cwd);
      // Only the first read answers, as an `origin` read that times out on its second attempt would.
      const answer = asked.includes(path) ? undefined : answers.get(path);
      asked.push(path);
      return answer;
    };
    expect(unwrap(resolveOwnRepository({ home, originOf }))).toBe("acme/slopweaver");
    expect(asked).toEqual(paths.map((path) => realpathSync(path)));
  });
});

describe("ownRepositoryDeclaration", () => {
  it("offers the compiled-in address and every recorded one as earlier shapes, and the origin as current", () => {
    const originOf = declareOrigins({ slugs: ["acme/slopweaver"] });
    expect(recordOwnRepository({ home, repository: "widgets/slopweaver" }).isOk()).toBe(true);
    expect(unwrap(ownRepositoryDeclaration({ home, originOf }))).toEqual({
      kind: "resolved",
      repository: "acme/slopweaver",
      supersededRepositories: ["lachiejames/slopweaver", "widgets/slopweaver"],
    });
  });

  it("carries an unresolved home as a state, with the line a report prints", () => {
    const declaration = unwrap(ownRepositoryDeclaration({ home, originOf: () => undefined }));
    const state = ownRepositoryStateOf({ ownRepository: declaration });
    expect(state.kind).toBe("unresolved");
    expect(ownRepositoryUnresolvedLine({ state: state as Extract<typeof state, { kind: "unresolved" }> })).toBe(
      "OWN REPOSITORY UNRESOLVED — bump-drive-slopweaver and bump-fix-slopweaver are not declared on this install, " +
        "and a stored copy of either still fires as written, compared with nothing: no declared main checkout has a repository named slopweaver as " +
        "its `origin`, and a bare name is never read as a directory — pass an absolute path, or ./slopweaver for one " +
        "relative to here. Declared: none",
    );
  });

  it("refuses a history it cannot read on a resolved home, rather than leaving a moved row reading as somebody's edit", () => {
    const originOf = declareOrigins({ slugs: ["acme/slopweaver"] });
    const path = writeHistory({ text: "not json" });
    expect(unwrapErr(ownRepositoryDeclaration({ home, originOf })).code).toBe("OWN_REPOSITORIES_MALFORMED");
    expect(unwrapErr(ownRepositoryDeclaration({ home, originOf })).message).toContain(path);
  });

  it("reads an unresolved home as unresolved whatever its history, so a bad one cannot hide that warning", () => {
    writeHistory({ text: "not json" });
    expect(unwrap(ownRepositoryDeclaration({ home, originOf: () => undefined })).kind).toBe("unresolved");
  });
});

describe("the own-repository history", () => {
  it("reads as empty with no file", () => {
    expect(unwrap(readOwnRepositories({ home }))).toEqual([]);
  });

  it("appends, keeps every earlier address, and writes nothing on a repeat", () => {
    expect(recordOwnRepository({ home, repository: "acme/slopweaver" }).isOk()).toBe(true);
    expect(recordOwnRepository({ home, repository: "widgets/slopweaver" }).isOk()).toBe(true);
    expect(recordOwnRepository({ home, repository: "acme/slopweaver" }).isOk()).toBe(true);
    expect(unwrap(readOwnRepositories({ home }))).toEqual(["acme/slopweaver", "widgets/slopweaver"]);
  });

  it.each([
    ["a wrong schema version", '{"schemaVersion":2,"repositories":[]}'],
    ["an unknown key", '{"schemaVersion":1,"repositories":[],"extra":true}'],
    ["a slug with no owner", '{"schemaVersion":1,"repositories":["slopweaver"]}'],
    ["a slug that is not canonical", '{"schemaVersion":1,"repositories":["Acme/slopweaver"]}'],
  ])("refuses %s", (_label, text) => {
    writeHistory({ text });
    expect(unwrapErr(readOwnRepositories({ home })).code).toBe("OWN_REPOSITORIES_MALFORMED");
  });

  it("refuses a directory where the file belongs, and does not record over it", () => {
    mkdirSync(stateHomePaths({ home }).live.recipe.ownRepositoriesJson, { recursive: true });
    expect(unwrapErr(readOwnRepositories({ home })).code).toBe("OWN_REPOSITORIES_UNREADABLE");
    expect(unwrapErr(recordOwnRepository({ home, repository: "acme/slopweaver" })).code).toBe(
      "OWN_REPOSITORIES_UNREADABLE",
    );
  });
});
