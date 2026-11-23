import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { err, ok, unwrap, unwrapErr } from "#lib/result.js";
import { writePushRootBinding } from "../../../admit/pushRootStore.js";
import { type RepointReadDeps, readRepositoryRepointFacts } from "../../../checkouts/repointReaders.js";

const USER_HOME = "/users/fixture";
const OLD = "/work/widgets";
const FRESH = "/work/widgets-fresh";
const ROOT = "a".repeat(40);
const REQUEST = { archiveName: "widgets-archive", newCheckout: FRESH, repository: "acme/widgets" };
const DESKTOP = `${USER_HOME}/Library/Application Support/Slopweaver/state.json`;
const MARKETPLACE = `${USER_HOME}/.agents/plugins/marketplace.json`;
const AGENTS = `${USER_HOME}/Library/LaunchAgents`;

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "repoint-readers-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Answers per git argv, keyed `<cwd> <args…>`; an unknown argv throws, as a failing git would. */
const gitAnswers = ({ answers }: { answers: Readonly<Record<string, string>> }): RepointReadDeps["readGit"] => {
  return ({ cwd, args }) => {
    const answer = answers[`${cwd} ${args.join(" ")}`];
    if (answer === undefined) {
      throw new Error(`fatal: not a git repository: ${cwd}`);
    }
    return answer;
  };
};

const REMOTES = "config --get-regexp ^remote\\..*\\.(url|pushurl)$";

/** A machine with one old checkout, a valid fresh clone, every surface present, and one linking note. */
const deps = (over: Partial<RepointReadDeps> = {}): RepointReadDeps => {
  const texts: Record<string, string> = {
    [join(home, "profile.json")]: JSON.stringify({ mainCheckouts: [{ path: OLD }] }),
    [DESKTOP]: JSON.stringify({ checkout: OLD, other: 1 }),
    [MARKETPLACE]: JSON.stringify({
      plugins: [{ name: "other" }, { name: "slopweaver", source: { path: `${OLD}/plugin` } }],
    }),
    [`${AGENTS}/console.plist`]: "<plist/>",
    [join(home, "notes.md")]: "see https://github.com/acme/widgets/pull/4",
    [join(home, "plain.md")]: "nothing to move",
  };
  /** What a non-UTF-8 file's bytes read as latin1: one image naming nothing, one carrying a link. */
  const bytes: Record<string, string> = {
    [join(home, "shot.webp")]: "RIFFÿØWEBPVP8 ...",
    [join(home, "linked.bin")]: "ÿhttps://github.com/acme/widgets/pull/9\u0000",
  };
  return {
    convertPlist: ({ path }) =>
      path.endsWith("console.plist")
        ? ok({ Label: OLD, ProgramArguments: ["node", `${OLD}/bin/x`], WorkingDirectory: OLD })
        : err("plutil could not decode it"),
    listAuthoredFiles: () => ({
      directories: [],
      files: [join(home, "notes.md"), join(home, "plain.md")],
      unclassified: [],
      unreadable: [],
    }),
    listDirectory: ({ path }) => (path === AGENTS ? ok(["console.plist", "README.txt"]) : ok(null)),
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    readBytesAsLatin1: ({ path }) => (path in bytes ? bytes[path]! : undefined),
    readGit: gitAnswers({
      answers: {
        [`${OLD} ${REMOTES}`]:
          "remote.origin.url git@github.com:acme/widgets.git\nremote.origin.pushurl git@github.com:acme/widgets.git",
        [`${OLD} rev-parse --show-toplevel`]: `${OLD}\n`,
        [`${OLD} worktree list --porcelain`]: `worktree ${OLD}\nHEAD ${"c".repeat(40)}\nbranch refs/heads/main\n\nworktree ${OLD}/wt\nHEAD ${"d".repeat(40)}\ndetached\n`,
        [`${FRESH} rev-parse --show-toplevel`]: FRESH,
        [`${FRESH} --no-replace-objects rev-list --max-parents=0 HEAD`]: ROOT,
        [`${FRESH} ${REMOTES}`]: "remote.origin.url https://github.com/acme/widgets.git",
      },
    }),
    readText: ({ path }) => ok(path in texts ? texts[path]! : null),
    sizeOf: () => 10,
    userHome: USER_HOME,
    ...over,
  };
};

const read = (over: Partial<RepointReadDeps> = {}) =>
  readRepositoryRepointFacts({ deps: deps(over), home, request: REQUEST });

describe("readRepositoryRepointFacts", () => {
  it("reads the old checkout's top level, its remote lines, push url included, and its worktrees", () => {
    const checkout = unwrap(read()).checkouts[0]!;

    expect(checkout).toEqual({
      kind: "read",
      path: OLD,
      remoteConfig: [
        { key: "remote.origin.url", url: "git@github.com:acme/widgets.git" },
        { key: "remote.origin.pushurl", url: "git@github.com:acme/widgets.git" },
      ],
      toplevel: OLD,
      worktrees: [
        { branch: "main", path: OLD },
        { branch: null, path: `${OLD}/wt` },
      ],
    });
  });

  it("reads the fresh clone's top level, remotes and HEAD roots", () => {
    expect(unwrap(read()).newCheckout).toEqual({
      headRoots: [ROOT],
      kind: "read",
      path: FRESH,
      remoteConfig: [{ key: "remote.origin.url", url: "https://github.com/acme/widgets.git" }],
      toplevel: FRESH,
    });
  });

  it("refuses a relative --new-checkout as unreadable", () => {
    const facts = unwrap(
      readRepositoryRepointFacts({ deps: deps(), home, request: { ...REQUEST, newCheckout: "fresh" } }),
    );

    expect(facts.newCheckout).toEqual({
      kind: "unreadable",
      path: "fresh",
      why: "--new-checkout must be an absolute path",
    });
  });

  it("picks the desktop checkout and the slopweaver marketplace source with their pointers", () => {
    const facts = unwrap(read());

    expect(facts.desktop).toMatchObject({ kind: "read", path: DESKTOP, pointer: "/checkout", value: OLD });
    expect(facts.marketplace).toMatchObject({
      kind: "read",
      path: MARKETPLACE,
      pointer: "/plugins/1/source/path",
      value: `${OLD}/plugin`,
    });
  });

  it("reads only the path keys of a .plist, skipping other files and the Label", () => {
    const agents = unwrap(read()).launchAgents;

    expect(agents.length).toBe(1);
    expect(agents[0]!).toMatchObject({
      kind: "read",
      path: `${AGENTS}/console.plist`,
      strings: [
        { keyPath: ["ProgramArguments", "0"], value: "node" },
        { keyPath: ["ProgramArguments", "1"], value: `${OLD}/bin/x` },
        { keyPath: ["WorkingDirectory"], value: OLD },
      ],
    });
  });

  it("reports a plist plutil cannot decode as unreadable", () => {
    const agents = unwrap(read({ convertPlist: () => err("plutil could not decode it") })).launchAgents;

    expect(agents).toEqual([
      { kind: "unreadable", path: `${AGENTS}/console.plist`, why: "plutil could not decode it" },
    ]);
  });

  it("collects only the files that link a numbered object", () => {
    const facts = unwrap(read());

    expect(facts.links.map((file) => [file.path, file.replacements.map((replacement) => replacement.to)])).toEqual([
      [join(home, "notes.md"), ["https://github.com/acme/widgets-archive/pull/4"]],
    ]);
  });

  it("reports a file over the scan bound as residue rather than reading it", () => {
    const facts = unwrap(read({ sizeOf: ({ path }) => (path.endsWith("notes.md") ? 17 * 1024 * 1024 : 10) }));

    expect(facts.links).toEqual([]);
    expect(facts.linkResidue[0]!.locator).toBe(join(home, "notes.md"));
  });

  it("counts a non-UTF-8 file with no link, and keeps one whose bytes carry a link as residue", () => {
    const listing = {
      directories: [],
      files: [join(home, "shot.webp"), join(home, "linked.bin"), join(home, "gone.bin")],
      unclassified: [],
      unreadable: [],
    };
    const facts = unwrap(
      read({
        listAuthoredFiles: () => listing,
        readText: () => err("The encoded data was not valid for encoding utf-8"),
      }),
    );

    expect(facts.nonTextFilesWithoutLinks).toBe(1);
    expect(facts.linkResidue.map((entry) => entry.locator)).toEqual([join(home, "linked.bin"), join(home, "gone.bin")]);
  });

  it("reports an unclassified entry as residue", () => {
    const listing = { directories: [], files: [], unclassified: ["scratch/x"], unreadable: [] };
    const facts = unwrap(read({ listAuthoredFiles: () => listing }));

    expect(facts.linkResidue).toEqual([
      { locator: "scratch/x", why: "no authored-state row classifies it, so it was not read" },
    ]);
  });

  it("carries no push root while none is recorded, and the recorded one once it is", () => {
    expect(unwrap(read()).pushRoot).toBe(null);
    unwrap(
      writePushRootBinding({
        binding: { recordedAtIso: "2026-01-02T03:04:05.000Z", repository: "acme/widgets", rootSha: ROOT },
        home,
      }),
    );

    expect(unwrap(read()).pushRoot).toBe(ROOT);
  });

  it("refuses the whole read when the push-root register is unreadable", () => {
    writeFileSync(join(home, "push-roots.json"), "{not json");

    expect(unwrapErr(read())).toContain("is present and could not be read");
  });

  it("reports a git failure on the old checkout as unreadable rather than dropping it", () => {
    const facts = unwrap(read({ readGit: gitAnswers({ answers: {} }) }));

    expect(facts.checkouts[0]!.kind).toBe("unreadable");
  });
});
