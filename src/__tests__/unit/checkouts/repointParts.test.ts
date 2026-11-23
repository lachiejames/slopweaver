/**
 * The repoint plan's stages and readers, each driven directly rather than only through `planRepositoryRepoint` and
 * `readRepositoryRepointFacts`, so a stage that breaks is named by its own test.
 */
import { describe, expect, it } from "vitest";
import { err, ok } from "#lib/result.js";
import { checkoutPart, isUnder } from "../../../checkouts/repointCheckouts.js";
import { freshPart } from "../../../checkouts/repointFresh.js";
import type { RepositoryRepointFacts } from "../../../checkouts/repointModel.js";
import type { RepointReadDeps } from "../../../checkouts/repointReaders.js";
import { checkoutFactsOf, newCheckoutFactsOf } from "../../../checkouts/repointReadGit.js";
import { linksOf } from "../../../checkouts/repointReadLinks.js";
import { desktopPick, marketplacePick } from "../../../checkouts/repointReadSurfaces.js";

const OLD = "/work/widgets";
const FRESH = "/work/widgets-fresh";
const SHA = "e".repeat(64);
const REQUEST = { archiveName: "widgets-archive", newCheckout: FRESH, repository: "acme/widgets" };

/** Reader edges that read nothing: every git call fails and every listing is empty. */
const deps = (over: Partial<RepointReadDeps> = {}): RepointReadDeps => ({
  convertPlist: () => err("plutil could not decode it"),
  listAuthoredFiles: () => ({ directories: [], files: [], unclassified: [], unreadable: [] }),
  listDirectory: () => ok(null),
  now: () => new Date("2026-01-02T03:04:05.000Z"),
  readBytesAsLatin1: () => undefined,
  readGit: ({ cwd }) => {
    throw new Error(`fatal: not a git repository: ${cwd}`);
  },
  readText: () => ok(null),
  sizeOf: () => 10,
  userHome: "/users/fixture",
  ...over,
});

/** Facts with every JSON surface absent and one launch agent naming the old checkout twice and a lookalike once. */
const facts = (): RepositoryRepointFacts => ({
  checkouts: [],
  desktop: { kind: "absent", path: "/state/desktop.json" },
  generatedAtIso: "2026-01-02T03:04:05.000Z",
  launchAgents: [
    {
      kind: "read",
      path: "/agents/console.plist",
      sha256: SHA,
      strings: [
        { keyPath: ["WorkingDirectory"], value: OLD },
        { keyPath: ["ProgramArguments", "1"], value: `--cwd=${OLD}/site` },
        { keyPath: ["ProgramArguments", "2"], value: `${OLD}-other/x` },
      ],
    },
  ],
  linkResidue: [],
  links: [],
  marketplace: { kind: "absent", path: "/users/fixture/.agents/plugins/marketplace.json" },
  newCheckout: { kind: "not-given" },
  nonTextFilesWithoutLinks: 0,
  profile: { kind: "absent", path: "/home/profile.json" },
  pushRoot: null,
});

describe("isUnder", () => {
  it("holds for the root itself and a path below it, never for a sibling sharing its prefix", () => {
    expect([OLD, `${OLD}/wt`, `${OLD}-other`].map((path) => isUnder({ path, root: OLD }))).toEqual([true, true, false]);
  });

  it("reads a root spelled with a trailing slash the same way", () => {
    expect(isUnder({ path: `${OLD}/wt`, root: `${OLD}/` })).toBe(true);
  });
});

describe("checkoutPart", () => {
  it("leaves an unreadable checkout unresolved, naming why", () => {
    const part = checkoutPart({
      archiveName: "widgets-archive",
      checkouts: [{ kind: "unreadable", path: OLD, why: "git could not read it" }],
      repository: "acme/widgets",
    });

    expect(part.unresolved).toEqual([{ locator: OLD, reason: "git could not read it", surface: "main-checkout" }]);
  });
});

describe("freshPart", () => {
  it("moves each launch-agent string under the old checkout to the fresh one and leaves the lookalike alone", () => {
    const part = freshPart({ facts: facts(), newCheckout: FRESH, oldCheckouts: [OLD] });

    expect(part.actions.map((action) => (action.kind === "plist-string" ? action.to : action.kind))).toEqual([
      FRESH,
      `--cwd=${FRESH}/site`,
    ]);
  });

  it("leaves every move unresolved when no fresh checkout is fit", () => {
    const part = freshPart({ facts: facts(), newCheckout: null, oldCheckouts: [OLD] });

    expect(part.actions).toEqual([]);
    expect(part.unresolved.map((item) => item.locator)).toEqual([
      "/agents/console.plist#WorkingDirectory",
      "/agents/console.plist#ProgramArguments.1",
    ]);
  });
});

describe("checkoutFactsOf and newCheckoutFactsOf", () => {
  it("reports a checkout git cannot read as unreadable, carrying git's message", () => {
    expect(checkoutFactsOf({ deps: deps(), path: OLD })).toEqual({
      kind: "unreadable",
      path: OLD,
      why: `git could not read it: fatal: not a git repository: ${OLD}`,
    });
  });

  it("names an absent --new-checkout as not given and refuses a relative one before asking git", () => {
    expect(newCheckoutFactsOf({ deps: deps(), path: undefined })).toEqual({ kind: "not-given" });
    expect(newCheckoutFactsOf({ deps: deps(), path: "widgets-fresh" })).toEqual({
      kind: "unreadable",
      path: "widgets-fresh",
      why: "--new-checkout must be an absolute path",
    });
  });
});

describe("linksOf", () => {
  it("carries the listing's unreadable and unclassified entries into the residue", () => {
    const read = linksOf({
      deps: deps({
        listAuthoredFiles: () => ({
          directories: [],
          files: [],
          unclassified: ["/home/odd.bin"],
          unreadable: [{ locator: "/home/locked", why: "EACCES" }],
        }),
      }),
      home: "/home",
      request: REQUEST,
    });

    expect(read).toEqual({
      linkResidue: [
        { locator: "/home/locked", why: "would not list: EACCES" },
        { locator: "/home/odd.bin", why: "no authored-state row classifies it, so it was not read" },
      ],
      links: [],
      nonTextFilesWithoutLinks: 0,
    });
  });
});

describe("desktopPick and marketplacePick", () => {
  it("picks the desktop state's checkout, and says why when it names none", () => {
    expect(desktopPick({ document: { checkout: OLD } })).toEqual({ pointer: "/checkout", value: OLD });
    expect(desktopPick({ document: { checkout: 3 } })).toBe("its checkout is not a string");
    expect(desktopPick({ document: null })).toBe("the desktop state names no checkout");
  });

  it("says why a marketplace with no plugins array carries no local source", () => {
    expect(marketplacePick({ document: { plugins: "none" }, userHome: "/users/fixture" })).toBe(
      "the marketplace lists no plugins array",
    );
  });
});
