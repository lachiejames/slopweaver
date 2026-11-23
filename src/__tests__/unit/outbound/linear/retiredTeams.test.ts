/** The retired-team gate: what the install's list says, and what a Linear write naming a listed team is told. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  parseRetiredTeams,
  readRetiredTeams,
  retiredTeamGate,
  retiredTeamRefusals,
} from "../../../../outbound/linear/retiredTeams.js";
import { stateHomePaths } from "../../../../stateHome.js";

/** Where the install's list lives under a home. */
const listPath = ({ home }: { home: string }): string => stateHomePaths({ home }).linearRetiredTeamsJson;

const SUP = {
  fileInstead: "SOPS",
  teamId: "26397148-cb19-4cd5-bf02-60964b2c2a78",
  teamKey: "SUP",
  why: "the owner left SUP in May 2026",
};

const homes: string[] = [];

/** A fresh state home, optionally holding a retired-teams file with exactly these bytes. */
function homeWith({ raw }: { raw: string | undefined }): string {
  const home = mkdtempSync(join(tmpdir(), "retired-"));
  homes.push(home);
  if (raw !== undefined) {
    writeFileSync(listPath({ home }), raw);
  }
  return home;
}

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** No session, so no grant can be open. */
const NO_ENV = (): string | undefined => undefined;

describe("readRetiredTeams", () => {
  it("retires nothing when the install has no list", () => {
    expect(unwrap(readRetiredTeams({ home: homeWith({ raw: undefined }) }))).toEqual([]);
  });

  it("reads a listed team", () => {
    const home = homeWith({ raw: JSON.stringify({ teams: [SUP] }) });
    expect(unwrap(readRetiredTeams({ home }))).toEqual([SUP]);
  });

  it("refuses a present file that is not JSON, rather than reading it as an empty list", () => {
    const error = unwrapErr(readRetiredTeams({ home: homeWith({ raw: "{ not json" }) }));
    expect(error.code).toBe("RETIRED_TEAMS_MALFORMED");
  });

  it("refuses a dangling symlink, which reads ENOENT but is a file somebody put there", () => {
    const home = homeWith({ raw: undefined });
    symlinkSync(join(home, "gone.json"), listPath({ home }));

    const error = unwrapErr(readRetiredTeams({ home }));

    expect(error.code).toBe("RETIRED_TEAMS_UNREADABLE");
  });

  it("refuses a symlink even to a valid list, so the one open never follows a link", () => {
    const home = homeWith({ raw: undefined });
    writeFileSync(join(home, "real.json"), JSON.stringify({ teams: [SUP] }));
    symlinkSync(join(home, "real.json"), listPath({ home }));

    const error = unwrapErr(readRetiredTeams({ home }));

    expect(error.code).toBe("RETIRED_TEAMS_UNREADABLE");
  });

  it("refuses a path that is not a regular file, without trying to read it", () => {
    const home = homeWith({ raw: undefined });
    mkdirSync(listPath({ home }));

    const error = unwrapErr(readRetiredTeams({ home }));

    expect(error.code).toBe("RETIRED_TEAMS_UNREADABLE");
    expect(error.message).toContain("not a regular file");
  });

  it("refuses a named pipe with no writer at once, rather than blocking on it", () => {
    const home = homeWith({ raw: undefined });
    execFileSync("mkfifo", [listPath({ home })]);

    const error = unwrapErr(readRetiredTeams({ home }));

    expect(error.message).toContain("not a regular file");
  });
});

describe("parseRetiredTeams", () => {
  it("refuses an entry carrying a key nobody declared", () => {
    const error = unwrapErr(
      parseRetiredTeams({ path: "/h/f.json", raw: JSON.stringify({ teams: [{ ...SUP, defaultTeam: "SOPS" }] }) }),
    );
    expect(error.code).toBe("RETIRED_TEAMS_MALFORMED");
    expect(error.message).toContain("/h/f.json is not a retired-teams list");
  });

  it("refuses a team id that is not a bare UUID, which would otherwise match no write and refuse nothing", () => {
    const raw = JSON.stringify({ teams: [{ ...SUP, teamId: `${SUP.teamId} ` }] });
    const error = unwrapErr(parseRetiredTeams({ path: "/h/f.json", raw }));
    expect(error.code).toBe("RETIRED_TEAMS_MALFORMED");
  });

  it("refuses a repeated key, which JSON.parse would resolve to the last and so erase the list", () => {
    const raw = `{"teams":[${JSON.stringify(SUP)}],"teams":[]}`;
    const error = unwrapErr(parseRetiredTeams({ path: "/h/f.json", raw }));
    expect(error.code).toBe("RETIRED_TEAMS_MALFORMED");
    expect(error.message).toContain("the key teams appears twice");
  });
});

describe("retiredTeamRefusals", () => {
  it("refuses a write naming a retired team, and names the team to file into instead", () => {
    const lines = retiredTeamRefusals({
      command: "slopweaver linear issue create",
      retired: [SUP],
      teamIds: [SUP.teamId],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("file into SOPS instead");
    expect(lines[0]).toContain("slopweaver hatch open retired-linear-team");
  });

  it("passes a write whose teams are none of the retired ones", () => {
    expect(
      retiredTeamRefusals({ command: "c", retired: [SUP], teamIds: ["5fd296ef-baa7-4bc4-ab3d-3afbc6202759"] }),
    ).toEqual([]);
  });

  it("refuses the same team spelled in a different case, on either side", () => {
    const upperListed = retiredTeamRefusals({
      command: "c",
      retired: [{ ...SUP, teamId: SUP.teamId.toUpperCase() }],
      teamIds: [SUP.teamId],
    });
    const upperWritten = retiredTeamRefusals({ command: "c", retired: [SUP], teamIds: [SUP.teamId.toUpperCase()] });

    expect(upperListed).toHaveLength(1);
    expect(upperWritten).toHaveLength(1);
  });
});

describe("retiredTeamGate", () => {
  it("refuses a project whose team set still names a retired team, with no grant open", () => {
    const home = homeWith({ raw: JSON.stringify({ teams: [SUP] }) });
    const lines = retiredTeamGate({
      command: "slopweaver linear project update",
      env: NO_ENV,
      home,
      teamIds: ["5fd296ef-baa7-4bc4-ab3d-3afbc6202759", SUP.teamId],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("files into SUP (26397148-cb19-4cd5-bf02-60964b2c2a78), which this install retired");
  });

  it("reports an unreadable list as the refusal, since no write can prove its team is not retired", () => {
    const home = homeWith({ raw: "[]" });
    const lines = retiredTeamGate({ command: "c", env: NO_ENV, home, teamIds: [SUP.teamId] });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("is not a retired-teams list");
  });
});
