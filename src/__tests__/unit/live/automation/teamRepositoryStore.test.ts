/**
 * The team repository registry over a real throwaway home: absent reads as none, anything broken is a typed
 * error that never reads as none, and a write round-trips through the reader.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  addTeamRepository,
  parseTeamRepositoryRegistration,
  readTeamRepositories,
  TeamRepositoryStoreErrors,
  writeTeamRepositories,
} from "../../../../live/automation/teamRepositoryStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

const ACME = { repository: "acme/acme-admin" } as const;
const WIDGETS = { repository: "acme/widgets" } as const;

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "team-repositories-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** Where the registry lives under the throwaway home. */
const registryPath = (): string => stateHomePaths({ home }).live.recipe.teamRepositoriesJson;

/** Put `text` at the registry path, creating its directory. */
function seed({ text }: { text: string }): void {
  mkdirSync(stateHomePaths({ home }).live.recipe.root, { recursive: true });
  writeFileSync(registryPath(), text, "utf8");
}

describe("readTeamRepositories", () => {
  it("reads a home with no registry as none registered", () => {
    expect(unwrap(readTeamRepositories({ home }))).toEqual({ kind: "absent", repositories: [] });
  });

  it("reads an empty registry as present and empty", () => {
    seed({ text: '{"schemaVersion":2,"repositories":[]}' });
    expect(unwrap(readTeamRepositories({ home }))).toEqual({ kind: "present", repositories: [] });
  });

  it("projects a schema-1 registry, actors and all, to its repositories", () => {
    seed({
      text:
        '{"schemaVersion":1,"repositories":[{"repository":"Acme/Acme-Admin","author":"someone",' +
        '"renovateAuthor":"app/renovate"},{"repository":"acme/widgets","author":"someone"}]}',
    });
    expect(unwrap(readTeamRepositories({ home }))).toEqual({ kind: "present", repositories: [ACME, WIDGETS] });
  });

  it("still refuses a schema-1 registry whose actor is malformed, never reading it as none", () => {
    seed({ text: '{"schemaVersion":1,"repositories":[{"repository":"acme/widgets","author":"some one"}]}' });
    const error = unwrapErr(readTeamRepositories({ home }));
    expect(error.code).toBe("TEAM_REPOSITORIES_MALFORMED");
    expect(error.message).toContain("repositories.0.author: a non-empty login with no whitespace");
  });

  it("refuses a schema-2 registration still carrying an actor", () => {
    seed({ text: '{"schemaVersion":2,"repositories":[{"repository":"acme/widgets","author":"someone"}]}' });
    const error = unwrapErr(readTeamRepositories({ home }));
    expect(error.code).toBe("TEAM_REPOSITORIES_MALFORMED");
    expect(error.message).toContain("repositories.0");
  });

  it("refuses a body that is not JSON, never reading it as none registered", () => {
    seed({ text: "{" });
    const error = unwrapErr(readTeamRepositories({ home }));
    expect(error.code).toBe("TEAM_REPOSITORIES_MALFORMED");
    expect(error.message).toContain(`the team repository registry at ${registryPath()} is malformed: `);
  });

  it("refuses bytes that are not UTF-8, which a lossy decode would have read as a valid author", () => {
    mkdirSync(stateHomePaths({ home }).live.recipe.root, { recursive: true });
    const body = Buffer.concat([
      Buffer.from('{"schemaVersion":1,"repositories":[{"repository":"acme/widgets","author":"', "utf8"),
      Buffer.from([0xff]),
      Buffer.from('"}]}', "utf8"),
    ]);
    writeFileSync(registryPath(), body);
    const error = unwrapErr(readTeamRepositories({ home }));
    expect(error.code).toBe("TEAM_REPOSITORIES_MALFORMED");
    expect(error.message).toContain(`the team repository registry at ${registryPath()} is malformed: `);
  });

  it("refuses a key the strict schema does not know", () => {
    seed({ text: '{"schemaVersion":2,"repositories":[{"repository":"acme/acme-admin","x":1}]}' });
    const error = unwrapErr(readTeamRepositories({ home }));
    expect(error.code).toBe("TEAM_REPOSITORIES_MALFORMED");
    expect(error.message).toContain("repositories.0");
  });

  it("refuses a schema version this build does not read", () => {
    seed({ text: '{"schemaVersion":3,"repositories":[]}' });
    expect(unwrapErr(readTeamRepositories({ home })).code).toBe("TEAM_REPOSITORIES_MALFORMED");
  });

  it("refuses a repository registered twice, whatever its case", () => {
    seed({
      text: JSON.stringify({
        repositories: [WIDGETS, { ...WIDGETS, repository: "Acme/Widgets" }],
        schemaVersion: 2,
      }),
    });
    expect(unwrapErr(readTeamRepositories({ home }))).toEqual(
      TeamRepositoryStoreErrors.malformed({ issues: ["acme/widgets is registered twice"], path: registryPath() }),
    );
  });

  it("refuses two repositories sharing the name their recipe ids are keyed on", () => {
    seed({
      text: JSON.stringify({ repositories: [WIDGETS, { ...WIDGETS, repository: "other/widgets" }], schemaVersion: 2 }),
    });
    expect(unwrapErr(readTeamRepositories({ home }))).toEqual(
      TeamRepositoryStoreErrors.idCollision({
        repositories: ["acme/widgets", "other/widgets"],
        repositoryName: "widgets",
      }),
    );
  });

  it("refuses a registry path it cannot read as a file, never reading it as absent", () => {
    mkdirSync(registryPath(), { recursive: true });
    const error = unwrapErr(readTeamRepositories({ home }));
    expect(error.code).toBe("TEAM_REPOSITORIES_UNREADABLE");
    expect(error.message).toContain(`cannot read the team repository registry at ${registryPath()}: `);
  });

  it("refuses a dangling symlink at the registry path, though its read fails as ENOENT", () => {
    mkdirSync(stateHomePaths({ home }).live.recipe.root, { recursive: true });
    symlinkSync(join(home, "nowhere.json"), registryPath());
    expect(unwrapErr(readTeamRepositories({ home })).code).toBe("TEAM_REPOSITORIES_UNREADABLE");
  });

  it("refuses a special file at the registry path before reading it, so a FIFO cannot block the read", () => {
    mkdirSync(stateHomePaths({ home }).live.recipe.root, { recursive: true });
    symlinkSync("/dev/null", registryPath());
    const error = unwrapErr(readTeamRepositories({ home }));
    expect(error.code).toBe("TEAM_REPOSITORIES_UNREADABLE");
    expect(error.message).toContain("not a regular file");
  });
});

describe("parseTeamRepositoryRegistration", () => {
  it("lower-cases the repository", () => {
    expect(unwrap(parseTeamRepositoryRegistration({ registration: { repository: "Acme/Widgets" } }))).toEqual(WIDGETS);
  });

  it("names the flag of the field it refuses", () => {
    const refused = parseTeamRepositoryRegistration({ registration: { repository: "acme" } });
    expect(unwrapErr(refused)).toEqual(["--repo: one `owner/name` pair with no whitespace"]);
  });
});

describe("addTeamRepository", () => {
  it("answers the same list for a repeat, so a caller can tell nothing changed", () => {
    const current = [ACME];
    expect(unwrap(addTeamRepository({ current, registration: ACME }))).toBe(current);
  });

  it("keeps the registry sorted by repository whatever order they arrive in", () => {
    const next = unwrap(addTeamRepository({ current: [WIDGETS], registration: ACME }));
    expect(next.map((entry) => entry.repository)).toEqual(["acme/acme-admin", "acme/widgets"]);
  });

  it("refuses a second repository sharing a registered one's name", () => {
    const refused = unwrapErr(
      addTeamRepository({ current: [WIDGETS], registration: { ...WIDGETS, repository: "other/widgets" } }),
    );
    expect(refused.message).toBe(
      "acme/widgets and other/widgets share the name `widgets`, which keys every one of their recipe ids — only one " +
        "of them can be registered",
    );
  });
});

describe("writeTeamRepositories", () => {
  it("writes stable two-space schema-2 JSON with a trailing newline, which the reader reads back", () => {
    unwrap(writeTeamRepositories({ home, repositories: [ACME, WIDGETS] }));
    expect(readFileSync(registryPath(), "utf8")).toBe(
      '{\n  "schemaVersion": 2,\n  "repositories": [\n    {\n      "repository": "acme/acme-admin"\n    },\n' +
        '    {\n      "repository": "acme/widgets"\n    }\n  ]\n}\n',
    );
    expect(unwrap(readTeamRepositories({ home }))).toEqual({ kind: "present", repositories: [ACME, WIDGETS] });
  });

  it("answers a typed error when the registry's directory cannot be made", () => {
    mkdirSync(join(home, "live"), { recursive: true });
    writeFileSync(stateHomePaths({ home }).live.recipe.root, "not a directory", "utf8");
    const error = unwrapErr(writeTeamRepositories({ home, repositories: [ACME] }));
    expect(error.code).toBe("TEAM_REPOSITORIES_WRITE_FAILED");
    expect(error.message).toContain(`cannot write the team repository registry at ${registryPath()}: `);
  });
});
