/**
 * Teams the fleet no longer files into — read from the install, refused at the Linear write verbs.
 *
 * The owner left the SUP team months earlier, and the fleet kept filing there anyway:
 * 37 issues in 22 days, nearly all of them vulnerability and dependency-bump
 * sessions copying how the previous batch filed (`linear-everything-out-of-sup-into-sops-…` handover, the
 * cause report). No code chose SUP, so no code default could be removed; what was missing was anything that
 * said NO. This is that: a team listed in `$SLOPWEAVER_HOME/linear-retired-teams.json` is refused for an issue
 * create, an issue `--move-team`, and any project write whose team set names it, and the refusal names the
 * team to file into instead.
 *
 * A per-install file rather than a constant, because which teams a person has left is state about one
 * install, and team ids never live in the code (AGENTS.md, "Tools in the codebase, state outside it"). An
 * absent file is the default and refuses nothing; a file that is present but unreadable or malformed is its
 * own named failure, never read as "no teams retired".
 *
 * One way past, the journalled `retired-linear-team` grant, for a filing the owner asked to land in that team
 * in so many words.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { z } from "zod";

import { findDuplicateKey } from "#lib/jsonDuplicateKey.js";

import { grantEnvOf } from "../../hatch/grantSession.js";
import { hatchFor } from "../../hatch/lookup.js";
import { hatchOpen } from "../../hatch/open.js";
import { hatchRefusal } from "../../hatch/render.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import { strictForm } from "../strictForm.js";

/** The journalled hatch past a retired-team refusal. */
const RETIRED_TEAM_HATCH = "retired-linear-team";

/** One team the fleet no longer files into. */
export interface RetiredLinearTeam {
  /** The team's UUID, which is what a write form carries. */
  readonly teamId: string;
  /** The team's key, for the refusal to name. */
  readonly teamKey: string;
  /** The key of the team to file into instead. */
  readonly fileInstead: string;
  /** Why the team is retired, in the owner's terms. */
  readonly why: string;
}

const retiredTeamsSchema = strictForm({
  teams: z.array(
    strictForm({
      fileInstead: z.string().min(1),
      // A UUID or nothing: an id carrying a stray space would parse, match no write, and refuse nothing.
      // `guid` takes any 8-4-4-4-12 hex, so no Linear id version is refused.
      teamId: z.guid(),
      teamKey: z.string().min(1),
      why: z.string().min(1),
    }),
  ),
});

/** The retired-teams file is present but cannot be read. */
interface RetiredTeamsUnreadableError {
  readonly code: "RETIRED_TEAMS_UNREADABLE";
  readonly message: string;
}

/** The retired-teams file was read and is not the declared shape. */
interface RetiredTeamsMalformedError {
  readonly code: "RETIRED_TEAMS_MALFORMED";
  readonly message: string;
}

/** Why the retired-teams list could not be established. */
export type RetiredTeamsError = RetiredTeamsUnreadableError | RetiredTeamsMalformedError;

/** Factories for {@link RetiredTeamsError}. */
const RetiredTeamsErrors = {
  malformed: ({ path, detail }: { path: string; detail: string }): RetiredTeamsMalformedError => ({
    code: "RETIRED_TEAMS_MALFORMED",
    message: `${path} is not a retired-teams list (${detail}); fix it rather than delete it, or nothing is refused`,
  }),
  unreadable: ({ path, detail }: { path: string; detail: string }): RetiredTeamsUnreadableError => ({
    code: "RETIRED_TEAMS_UNREADABLE",
    message: `${path} exists but could not be read (${detail}), so no Linear write can prove its team is not retired`,
  }),
} as const;

/**
 * Parse the retired-teams file's text. Pure.
 *
 * @param raw the file's contents
 * @param path where it was read from, for the error to name
 * @returns the retired teams, or why the text is not a list of them
 */
export function parseRetiredTeams({
  raw,
  path,
}: {
  raw: string;
  path: string;
}): Result<readonly RetiredLinearTeam[], RetiredTeamsError> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (cause) {
    return err(RetiredTeamsErrors.malformed({ detail: cause instanceof Error ? cause.message : "not JSON", path }));
  }
  // `JSON.parse` keeps the LAST of two same-named members, so a second `"teams": []` would erase the list before
  // the schema ever saw it and the gate would fail open. A repeated key is malformed.
  const repeated = findDuplicateKey({ text: raw });
  if (repeated !== undefined) {
    return err(RetiredTeamsErrors.malformed({ detail: `the key ${repeated.join(".")} appears twice`, path }));
  }
  const parsed = retiredTeamsSchema.safeParse(value);
  if (!parsed.success) {
    return err(RetiredTeamsErrors.malformed({ detail: parsed.error.issues.map((i) => i.message).join("; "), path }));
  }
  return ok(parsed.data.teams);
}

/**
 * Read the install's retired teams. An absent file is the default and retires nothing.
 *
 * ONE open decides everything, so no second look at the path can be raced:
 * `O_NOFOLLOW` fails a symlink with `ELOOP`, a dangling one included, so `ENOENT` can only mean nothing is
 * there; `O_NONBLOCK` keeps a named pipe with no writer from blocking forever; and the regular-file test reads
 * the OPENED descriptor, so nothing can swap the path in between. A symlinked list is refused: put the file
 * itself in the home.
 *
 * @param home the state home
 * @returns the retired teams, or why a present file could not be read
 */
export function readRetiredTeams({ home }: { home: string }): Result<readonly RetiredLinearTeam[], RetiredTeamsError> {
  const path = stateHomePaths({ home }).linearRetiredTeamsJson;
  let raw: string;
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    if (!fstatSync(fd).isFile()) {
      return err(RetiredTeamsErrors.unreadable({ detail: "not a regular file", path }));
    }
    raw = readFileSync(fd, "utf8");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return ok([]);
    }
    return err(RetiredTeamsErrors.unreadable({ detail: cause instanceof Error ? cause.message : String(cause), path }));
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
  return parseRetiredTeams({ path, raw });
}

/**
 * The refusal lines for a write whose destination names a retired team. Pure: the hatch is decided by the
 * caller, and an empty list means the write may proceed.
 *
 * @param retired the install's retired teams
 * @param teamIds every team the write would file into
 * @param command the verb as the refusal names it
 * @returns one four-line refusal per retired team named, empty when none is
 */
export function retiredTeamRefusals({
  retired,
  teamIds,
  command,
}: {
  retired: readonly RetiredLinearTeam[];
  teamIds: readonly string[];
  command: string;
}): readonly string[] {
  const hatch = hatchFor({ id: RETIRED_TEAM_HATCH });
  // A UUID's hex is case-insensitive, so one spelled in capitals names the same team.
  const named = new Set(teamIds.map((id) => id.toLowerCase()));
  return retired
    .filter((team) => named.has(team.teamId.toLowerCase()))
    .map((team) =>
      hatchRefusal({
        detail: `${command} files into ${team.teamKey} (${team.teamId}), which this install retired: ${team.why}; file into ${team.fileInstead} instead`,
        hatch,
      }),
    );
}

/**
 * The whole gate: read the install's list, then refuse unless this session holds the journalled grant.
 *
 * A list that will not read is a failure of FACT, not this policy, so the grant does not waive it: the grant
 * says "this filing may land in a retired team", and with no readable list nobody knows which teams those are.
 * The fix is the file.
 *
 * @param home the state home, whose list and grant journal decide
 * @param teamIds every team the write would file into
 * @param command the verb as the refusal names it
 * @param env the injected environment reader the grant's session is read through
 * @returns the refusal lines, empty when the write may proceed
 */
export function retiredTeamGate({
  home,
  teamIds,
  command,
  env,
}: {
  home: string;
  teamIds: readonly string[];
  command: string;
  env: (args: { name: string }) => string | undefined;
}): readonly string[] {
  const retired = readRetiredTeams({ home });
  if (retired.isErr()) {
    return [retired.error.message];
  }
  const refusals = retiredTeamRefusals({ command, retired: retired.value, teamIds });
  if (refusals.length === 0) {
    return [];
  }
  if (hatchOpen({ env: grantEnvOf({ read: env }), home, id: RETIRED_TEAM_HATCH, nowIso: new Date().toISOString() })) {
    return [];
  }
  return refusals;
}
