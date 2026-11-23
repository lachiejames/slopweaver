import { describe, expect, it } from "vitest";
import {
  IDENTITY_AVATARS_FLAG_NAMES,
  runIdentityAvatarsWithDeps,
} from "../../../../../cli/commands/identity/identityAvatars.js";
import type { IdentityDeps } from "../../../../../cli/commands/identity/identityShared.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { buildMemberIdentity } from "../../../../../corpus/members/email.js";
import type { MemberBronzeRow } from "../../../../../corpus/members/types.js";
import { parseOwnJson } from "../../../../parseOwnJson.js";

const ADA: MemberBronzeRow = {
  fetchedAtIso: "2026-07-20T00:00:00.000Z",
  identity: buildMemberIdentity({ handle: "ada", name: "Ada Lovelace", nativeId: "ada", source: "github" }),
  profile: { avatarUrl: "https://avatars.example/ada.png" },
  provenance: [],
  raw: {},
  source: "github",
  sourceId: "ada",
  version: 1,
  warnings: [],
};

/** Capturing fakes — plain functions, never mocks. Every seam but `loadMembers` is unreachable and says so. */
function fakeDeps({ members = [ADA] }: { members?: readonly MemberBronzeRow[] } = {}): {
  deps: IdentityDeps;
  out: string[];
  err: string[];
  homes: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  const homes: string[] = [];
  const deps: IdentityDeps = {
    home: () => "/fake/home",
    loadCandidates: () => {
      throw new Error("loadCandidates is not reachable from avatars");
    },
    loadDirectory: () => {
      throw new Error("loadDirectory is not reachable from avatars");
    },
    loadGroups: () => {
      throw new Error("loadGroups is not reachable from avatars");
    },
    loadMembers: ({ home }) => {
      homes.push(home);
      return { rows: members, warnings: ["members/linear.jsonl: unreadable"] };
    },
    loadRoster: () => {
      throw new Error("loadRoster is not reachable from avatars");
    },
    logger: {
      error: ({ msg }) => err.push(msg),
      out: ({ line }) => out.push(line),
      warn: ({ msg }) => err.push(msg),
    },
  };
  return { deps, err, homes, out };
}

const argv = ({ tail }: { tail: readonly string[] }): readonly string[] => ["node", "slopweaver", "identity", ...tail];

describe("identity avatars", () => {
  it("prints the roster as JSON with the store's warnings beside it", () => {
    const { deps, out, homes } = fakeDeps();
    const code = runIdentityAvatarsWithDeps({ argv: argv({ tail: ["avatars", "--json"] }), deps });
    expect(code).toBe(EXIT_OK);
    expect(homes).toEqual(["/fake/home"]);
    expect(parseOwnJson({ text: out.join("\n") })).toEqual({
      people: [
        {
          avatarUrl: "https://avatars.example/ada.png",
          bot: false,
          handle: "ada",
          name: "Ada Lovelace",
          nativeId: "ada",
          source: "github",
        },
      ],
      warnings: ["members/linear.jsonl: unreadable"],
    });
  });

  it("prints one line per person in text mode and the warnings on stderr", () => {
    const { deps, out, err } = fakeDeps();
    const code = runIdentityAvatarsWithDeps({ argv: argv({ tail: ["avatars"] }), deps });
    expect(code).toBe(EXIT_OK);
    expect(out).toEqual(["github ada https://avatars.example/ada.png"]);
    expect(err).toEqual(["members/linear.jsonl: unreadable"]);
  });

  it("reads the named home and narrows to the named source", () => {
    const { deps, out, homes } = fakeDeps();
    const code = runIdentityAvatarsWithDeps({
      argv: argv({ tail: ["avatars", "--home", "/named", "--source", "slack", "--json"] }),
      deps,
    });
    expect(code).toBe(EXIT_EXPECTED_EMPTY);
    expect(homes).toEqual(["/named"]);
    expect(parseOwnJson({ text: out.join("\n") })).toEqual({
      people: [],
      warnings: ["members/linear.jsonl: unreadable"],
    });
  });

  it("narrows to the platform ids named by --ids, keeping the ones the roster holds", () => {
    const { deps, out } = fakeDeps();
    const code = runIdentityAvatarsWithDeps({
      argv: argv({ tail: ["avatars", "--ids", "ada,nobody", "--json"] }),
      deps,
    });
    expect(code).toBe(EXIT_OK);
    expect(parseOwnJson({ text: out.join("\n") })).toEqual({
      people: [
        {
          avatarUrl: "https://avatars.example/ada.png",
          bot: false,
          handle: "ada",
          name: "Ada Lovelace",
          nativeId: "ada",
          source: "github",
        },
      ],
      warnings: ["members/linear.jsonl: unreadable"],
    });
  });

  it("refuses an --ids entry that is not a platform id, reading nothing", () => {
    const { deps, err, homes } = fakeDeps();
    const code = runIdentityAvatarsWithDeps({ argv: argv({ tail: ["avatars", "--ids", "ada,-x"] }), deps });
    expect(code).toBe(EXIT_USAGE);
    expect(homes).toEqual([]);
    expect(err[0]).toBe('--ids carries "-x", which is not a platform id (letters, digits, dot, underscore, hyphen)');
  });

  it("refuses a source that is not one this install hydrates, naming the set", () => {
    const { deps, err, homes } = fakeDeps();
    const code = runIdentityAvatarsWithDeps({ argv: argv({ tail: ["avatars", "--source", "nope"] }), deps });
    expect(code).toBe(EXIT_USAGE);
    expect(homes).toEqual([]);
    expect(err[0]).toBe("--source nope is not one of github, slack, linear, notion");
  });

  it("answers --help with the usage line and reads nothing", () => {
    const { deps, out, homes } = fakeDeps();
    const code = runIdentityAvatarsWithDeps({ argv: argv({ tail: ["avatars", "--help"] }), deps });
    expect(code).toBe(EXIT_OK);
    expect(homes).toEqual([]);
    expect(out).toEqual([
      "usage: slopweaver identity avatars [--source github|slack|linear|notion] [--ids <id,id>] [--home <dir>] [--json]",
    ]);
  });

  it("declares exactly the flags the usage line names", () => {
    expect(IDENTITY_AVATARS_FLAG_NAMES).toEqual(["--home", "--ids", "--json", "--source"]);
  });
});
