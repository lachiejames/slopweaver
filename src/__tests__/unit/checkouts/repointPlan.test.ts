import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import type { RepositoryRepointFacts, RepositoryRepointRequest } from "../../../checkouts/repointModel.js";
import { planRepositoryRepoint } from "../../../checkouts/repointPlan.js";

const OLD = "/work/widgets";
const FRESH = "/work/widgets-fresh";
const ROOT = "a".repeat(40);
const SHA = "f".repeat(64);
const REQUEST: RepositoryRepointRequest = {
  archiveName: "widgets-archive",
  newCheckout: FRESH,
  repository: "acme/widgets",
};

/** A valid fresh clone: its own top level, a remote naming the repository, and only the recorded root. */
const FRESH_READ = {
  headRoots: [ROOT],
  kind: "read",
  path: FRESH,
  remoteConfig: [{ key: "remote.origin.url", url: "https://github.com/acme/widgets.git" }],
  toplevel: FRESH,
} as const satisfies RepositoryRepointFacts["newCheckout"];

/** Facts for a machine where every surface reads cleanly and the fresh clone is valid. */
const facts = (over: Partial<RepositoryRepointFacts> = {}): RepositoryRepointFacts => ({
  checkouts: [
    {
      kind: "read",
      path: OLD,
      remoteConfig: [
        { key: "remote.origin.url", url: "git@github.com:acme/widgets.git" },
        { key: "remote.upstream.url", url: "git@github.com:acme/gadgets.git" },
      ],
      toplevel: OLD,
      worktrees: [{ branch: "feature", path: `${OLD}/.claude/worktrees.noindex/feature` }],
    },
  ],
  desktop: { kind: "read", path: "/state/desktop.json", pointer: "/checkout", sha256: SHA, value: OLD },
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
  links: [
    {
      path: "/home/notes.md",
      replacements: [
        {
          from: "https://github.com/acme/widgets/pull/1",
          occurrences: 1,
          to: "https://github.com/acme/widgets-archive/pull/1",
        },
      ],
      sha256: SHA,
    },
  ],
  marketplace: { kind: "absent", path: "/home/.agents/plugins/marketplace.json" },
  newCheckout: FRESH_READ,
  nonTextFilesWithoutLinks: 0,
  profile: { kind: "read", mainCheckouts: [OLD, "/work/other"], path: "/home/profile.json", sha256: SHA },
  pushRoot: ROOT,
  ...over,
});

const plan = ({
  over = {},
  request = REQUEST,
}: { over?: Partial<RepositoryRepointFacts>; request?: RepositoryRepointRequest } = {}) =>
  unwrap(planRepositoryRepoint({ facts: facts(over), request }));

describe("planRepositoryRepoint on a fully readable machine", () => {
  it("is complete", () => {
    const planned = plan();

    expect(planned.complete).toBe(true);
    expect(planned.unresolved).toEqual([]);
  });

  it("moves only the remote that names the repository, to the archive's name", () => {
    expect(plan().actions.filter((action) => action.kind === "git-remote")).toEqual([
      {
        checkout: OLD,
        configKey: "remote.origin.url",
        fromUrl: "git@github.com:acme/widgets.git",
        kind: "git-remote",
        role: "archive",
        toUrl: "git@github.com:acme/widgets-archive.git",
      },
    ]);
  });

  it("discloses every worktree as following the archive, never moving it to the fresh repository", () => {
    const worktrees = plan().observations.filter((item) => item.surface === "worktree");

    expect(worktrees.map((item) => [item.locator, item.disposition])).toEqual([
      [`${OLD}/.claude/worktrees.noindex/feature`, "archive"],
    ]);
  });

  it("moves the profile's old main checkout to the fresh clone and leaves the other alone", () => {
    const profile = plan().actions.filter((action) => action.kind === "json-field" && action.surface === "profile");

    expect(profile).toEqual([
      {
        expectedSha256: SHA,
        from: OLD,
        kind: "json-field",
        path: "/home/profile.json",
        pointer: "/mainCheckouts/0/path",
        role: "fresh",
        surface: "profile",
        to: FRESH,
      },
    ]);
  });

  it("moves the desktop app's checkout to the fresh clone", () => {
    const desktop = plan().actions.find((action) => action.kind === "json-field" && action.surface === "desktop")!;

    expect(desktop).toMatchObject({ from: OLD, pointer: "/checkout", to: FRESH });
  });

  it("moves a launch agent's path into the old checkout, but not a sibling directory sharing its prefix", () => {
    const agents = plan().actions.filter((action) => action.kind === "plist-string");

    expect(agents.map((action) => [action.keyPath.join("."), action.to])).toEqual([
      ["WorkingDirectory", FRESH],
      ["ProgramArguments.1", `--cwd=${FRESH}/site`],
    ]);
  });

  it("carries each link file's replacements as one historical-link action", () => {
    expect(
      plan()
        .actions.filter((action) => action.role === "historical-link")
        .map((action) => action.path),
    ).toEqual(["/home/notes.md"]);
  });

  it("discloses an absent marketplace, the cmux spawn path and the running plugin directory", () => {
    expect(
      plan()
        .observations.filter((item) => item.surface !== "worktree")
        .map((item) => item.surface),
    ).toEqual(["cmux-spawn", "plugin-directory", "codex-marketplace", "profile"]);
  });

  it("names the archive under the same owner", () => {
    expect(plan().archiveRepository).toBe("acme/widgets-archive");
  });
});

describe("planRepositoryRepoint without a usable fresh clone", () => {
  it("is incomplete without --new-checkout, and plans every fresh move as unresolved instead", () => {
    const planned = plan({
      over: { newCheckout: { kind: "not-given" } },
      request: { ...REQUEST, newCheckout: undefined },
    });

    expect(planned.complete).toBe(false);
    expect(planned.actions.filter((action) => action.role === "fresh")).toEqual([]);
    expect(planned.unresolved.map((item) => item.surface)).toEqual([
      "fresh-checkout",
      "profile",
      "desktop",
      "launch-agent",
      "launch-agent",
    ]);
  });

  it("refuses a fresh clone whose HEAD carries any root but the recorded one", () => {
    const planned = plan({ over: { newCheckout: { ...FRESH_READ, headRoots: [ROOT, "b".repeat(40)] } } });

    expect(planned.complete).toBe(false);
    expect(planned.unresolved[0]!.reason).toContain("not only the recorded root");
  });

  it("refuses a fresh clone while no push root is recorded", () => {
    expect(plan({ over: { pushRoot: null } }).unresolved[0]!.reason).toContain("no push root is recorded");
  });

  it("refuses a fresh clone inside the old checkout", () => {
    const inside = `${OLD}/fresh`;
    const planned = plan({ over: { newCheckout: { ...FRESH_READ, path: inside, toplevel: inside } } });

    expect(planned.unresolved[0]!.reason).toBe("it overlaps the old checkout");
    expect(planned.newCheckout).toBe(null);
  });

  it("refuses a fresh clone that is the old checkout reached through a symlink", () => {
    const real = "/real/widgets";
    const linked = {
      kind: "read",
      path: OLD,
      remoteConfig: [{ key: "remote.origin.url", url: "git@github.com:acme/widgets.git" }],
      toplevel: real,
      worktrees: [],
    } as const;
    const planned = plan({
      over: {
        checkouts: [linked],
        newCheckout: { ...FRESH_READ, path: real, toplevel: real },
      },
      request: { ...REQUEST, newCheckout: real },
    });

    expect(planned.unresolved[0]!.reason).toBe("it overlaps the old checkout");
    expect(planned.complete).toBe(false);
  });

  it("refuses a fresh clone with no remote naming the repository", () => {
    const planned = plan({
      over: {
        newCheckout: {
          ...FRESH_READ,
          remoteConfig: [{ key: "remote.origin.url", url: "git@github.com:acme/gadgets.git" }],
        },
      },
    });

    expect(planned.unresolved[0]!.reason).toBe("no remote of it names acme/widgets");
  });
});

describe("planRepositoryRepoint with something unread", () => {
  it("is incomplete when a launch agent could not be read", () => {
    const planned = plan({ over: { launchAgents: [{ kind: "unreadable", path: "/agents/x.plist", why: "denied" }] } });

    expect(planned.complete).toBe(false);
    expect(planned.unresolved).toEqual([{ locator: "/agents/x.plist", reason: "denied", surface: "launch-agent" }]);
  });

  it("is incomplete when the link scan left residue", () => {
    const planned = plan({ over: { linkResidue: [{ locator: "/home/huge.jsonl", why: "over the scan bound" }] } });

    expect(planned.unresolved).toEqual([
      { locator: "/home/huge.jsonl", reason: "over the scan bound", surface: "state-home-links" },
    ]);
  });

  it("discloses link-free non-text files as one observation, without making the plan incomplete", () => {
    const planned = plan({ over: { nonTextFilesWithoutLinks: 3 } });

    expect(planned.complete).toBe(true);
    expect(planned.observations.find((item) => item.surface === "state-home-links")!.detail).toBe(
      "3 file(s) that are not text, whose bytes name no link to rewrite",
    );
  });

  it("is incomplete when no declared checkout's remote names the repository", () => {
    const planned = plan({ over: { checkouts: [] } });

    expect(planned.unresolved[0]!.surface).toBe("main-checkout");
    expect(planned.complete).toBe(false);
  });
});

describe("planRepositoryRepoint refusing the request", () => {
  it("refuses an archive name that is the repository's own, in any case", () => {
    const refused = planRepositoryRepoint({ facts: facts(), request: { ...REQUEST, archiveName: "Widgets" } });

    expect(unwrapErr(refused).message).toContain("is the repository's own name");
  });

  it("refuses an archive name that is not a repository name", () => {
    const refused = planRepositoryRepoint({ facts: facts(), request: { ...REQUEST, archiveName: "a/b" } });

    expect(unwrapErr(refused).code).toBe("REPOINT_REQUEST_INVALID");
  });
});
