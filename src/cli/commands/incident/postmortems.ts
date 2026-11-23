/**
 * `slopweaver incident postmortems` — which resolved incidents are worth a postmortem card, off the org-health
 * snapshot, each with the `handover register` command that raises its row.
 *
 * READ-ONLY: it registers nothing and posts nothing. The chair runs it every now and then and picks which;
 * the judgement of whether the snapshot can be believed is `../../../orgHealth/standing.ts`'s, the same
 * one `org-health status` and the `org-health` monitor make, so a stale read is never taken for "nothing resolved".
 */
import { logger } from "#lib/logger.js";
import { shellCommandLine } from "#lib/shellCommandLine.js";

import { handRegisterPath, readHandRows } from "../../../hand/store.js";
import { unrootedBriefPathTokens } from "../../../handover/briefPathGate.js";
import { UNROOTED_BRIEF_PATH_HATCH } from "../../../handover/briefPaths.js";
import { CHANNEL_ID } from "../../../incident/form.js";
import {
  type PostmortemCandidate,
  type PostmortemCandidates,
  postmortemCandidates,
} from "../../../incident/postmortemCandidates.js";
import { postmortemAskText, postmortemRowSlug } from "../../../incident/postmortemRow.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { type OrgHealthPort, orgHealthPort } from "../../../orgHealth/port.js";
import { orgHealthStanding } from "../../../orgHealth/standing.js";
import type { OrgIncident } from "../../../orgHealth/types.js";
import { stateHomePaths } from "../../../stateHome.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { resolvedHomeOf } from "../hand/deps.js";
import { slugClaim } from "../handover/registerWrite.js";

import { INCIDENT_POSTMORTEMS_USAGE } from "./incidentUsage.js";

/** Where the verb's arguments start in the full process argv. */
const VERB_ARG_OFFSET = 4;

/** The verb as its diagnostics open. */
const VERB = "incident postmortems";

/** The flags `incident postmortems` parses — `helpTruth.test.ts` holds its usage line to exactly these. */
export const INCIDENT_POSTMORTEMS_FLAG_SPEC: FlagSpec = {
  boolean: ["json", "help"],
  string: ["home"],
};

/** The seams `incident postmortems` runs through. */
export interface IncidentPostmortemsDeps {
  readonly nowMs: () => number;
  /** The store the incident snapshot is read from. */
  readonly orgHealthPort: OrgHealthPort;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The read as text: one heading line per candidate and the register command under it — or, for a row already on the
 * board, the card that is left to compose — then every held incident.
 *
 * A row whose ask `handover register`'s unrooted-path gate would refuse — incident.io's title naming what reads as a
 * path relative to the state home — gets a line naming the tokens, then the command with that gate's hatch: whether
 * the tokens are the incident's words or a real path is the chair's judgement, and a bare command would only fail
 * when pasted.
 *
 * @param read the candidates and the held incidents
 * @param home the RESOLVED home the read was made against, `--home` or `$SLOPWEAVER_HOME` alike, carried onto every
 *   printed command so it lands where it was checked, whatever the pasting shell's environment
 * @param unrooted each row's ask tokens the unrooted-path gate would refuse, absent for a row with none
 * @returns the lines, in that order
 */
export function postmortemCandidateLines({
  read,
  home,
  unrooted,
}: {
  read: PostmortemCandidates;
  home: string;
  unrooted: ReadonlyMap<string, readonly string[]>;
}): readonly string[] {
  const homeFlags = ["--home", home];
  const lines: string[] = [];
  for (const candidate of read.candidates) {
    lines.push(`${candidate.ref} (${candidate.severity}), resolved ${candidate.resolvedIso}: ${candidate.title}`);
    if (candidate.registered) {
      const card = `slopweaver incident postmortem --form <file> ${shellCommandLine({ command: homeFlags })}`;
      lines.push(`  row ${candidate.row} is registered — compose its card with \`${card}\``);
      continue;
    }
    const register = shellCommandLine({
      command: ["slopweaver", "handover", "register", ...candidate.registerFlags, ...homeFlags],
    });
    const tokens = unrooted.get(candidate.row);
    if (tokens === undefined) {
      lines.push(`  ${register}`);
      continue;
    }
    lines.push(
      `  its ask names ${tokens.join(", ")}, which handover register refuses as unrooted path(s) — if that is the incident's own title, register past the gate:`,
      `  ${UNROOTED_BRIEF_PATH_HATCH}=1 ${register}`,
    );
  }
  for (const held of read.held) {
    lines.push(`held: ${held.message}`);
  }
  return lines;
}

/**
 * The postmortem row slugs already claimed, among the incidents keyed by a well-formed channel — judged by
 * `handover register`'s own check (`slugClaim`), so a doc under another filename, an archived one or a run journal
 * counts exactly as it does when the printed command runs.
 *
 * @param home the state home whose board and runs are read
 * @param incidents every incident the snapshot keeps
 * @returns the claimed slugs, or why the board could not be read — never taken for "not registered"
 */
function registeredPostmortemRows({
  home,
  incidents,
}: {
  home: string;
  incidents: readonly OrgIncident[];
}): Result<ReadonlySet<string>, string> {
  const paths = stateHomePaths({ home });
  const registered = new Set<string>();
  for (const incident of incidents) {
    if (incident.channelId === undefined || !CHANNEL_ID.test(incident.channelId)) {
      continue;
    }
    const slug = postmortemRowSlug({ channelId: incident.channelId });
    const claim = slugClaim({ handoverDir: paths.handovers, runsDir: paths.runs, slug });
    if (claim.isErr()) {
      return err(`whether row ${slug} is registered is unknown — ${claim.error}`);
    }
    if (claim.value !== undefined) {
      registered.add(slug);
    }
  }
  return ok(registered);
}

/**
 * Each unregistered candidate's ask tokens `handover register`'s unrooted-path gate would refuse, judged as the
 * printed command meets it: this home, and the directory the command is run from as the repository root, since the
 * register flags declare no `--repo`.
 *
 * @param candidates the candidates the read lists
 * @param home the state home the command registers into
 * @returns the refused tokens by row, a row with none absent
 */
function unrootedAsks({
  candidates,
  home,
}: {
  candidates: readonly PostmortemCandidate[];
  home: string;
}): ReadonlyMap<string, readonly string[]> {
  const unrooted = new Map<string, readonly string[]>();
  for (const candidate of candidates) {
    if (candidate.registered) {
      continue;
    }
    const tokens = unrootedBriefPathTokens({
      env: process.env,
      home,
      repoRoot: process.cwd(),
      text: postmortemAskText({ incident: candidate }),
    });
    if (tokens.length > 0) {
      unrooted.set(candidate.row, tokens);
    }
  }
  return unrooted;
}

/** The candidates off the hand register and the board, or why either cannot be believed. */
function readCandidates({
  home,
  incidents,
}: {
  home: string;
  incidents: readonly OrgIncident[];
}): Result<PostmortemCandidates, string> {
  const held = readHandRows({ missing: "empty", path: handRegisterPath({ home }) });
  if (held.isErr()) {
    return err(held.error.message);
  }
  // A skipped line might be the card that already went out for a channel, which would list it a second time.
  if (held.value.unparsed.length > 0) {
    return err(
      `refused — ${String(held.value.unparsed.length)} hand register line(s) would not parse, and one may be a postmortem card already posted`,
    );
  }
  return registeredPostmortemRows({ home, incidents }).map((registered) =>
    postmortemCandidates({ incidents, registered, rows: held.value.rows }),
  );
}

/** Print the read, as one `--json` document or as {@link postmortemCandidateLines}. */
function writeCandidates({
  deps,
  home,
  json,
  read,
  readIso,
  unrooted,
}: {
  deps: IncidentPostmortemsDeps;
  home: string;
  json: boolean;
  read: PostmortemCandidates;
  readIso: string;
  unrooted: ReadonlyMap<string, readonly string[]>;
}): void {
  if (!json) {
    for (const line of postmortemCandidateLines({ home, read, unrooted })) {
      deps.writeOut(line);
    }
    return;
  }
  deps.writeOut(
    safeJsonStringify({
      label: "incident postmortems --json",
      value: {
        candidates: read.candidates,
        // Rows whose registerFlags meet the unrooted-path gate: register those with its hatch, or not at all.
        unrootedAsks: Object.fromEntries(unrooted),
        held: read.held.map((error) => ({ code: error.code, message: error.message })),
        // The home the read was checked against: each registerFlags list is valid there, so pass it as --home.
        home,
        readIso,
        schemaVersion: 1,
        state: "measured",
      },
    }),
  );
}

/**
 * Run `incident postmortems` against injected seams.
 *
 * @param rest the argv tail after `incident postmortems`
 * @param deps the clock, the store and the two sinks
 * @returns the process exit code: 0 with a candidate, 3 with none, 1 when the snapshot or register cannot be believed
 */
export async function runIncidentPostmortems({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: IncidentPostmortemsDeps;
}): Promise<number> {
  const parsed = parseFlags({ args: rest, spec: INCIDENT_POSTMORTEMS_FLAG_SPEC });
  if (parsed.isErr()) {
    for (const line of [...parsed.error.map((error) => `${VERB}: ${error}`), INCIDENT_POSTMORTEMS_USAGE]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const values = parsed.value.values;
  if (values["help"] === true) {
    deps.writeDiagnostic(INCIDENT_POSTMORTEMS_USAGE);
    return EXIT_OK;
  }
  const home = resolvedHomeOf({ values });
  const json = values["json"] === true;
  const snapshot = await deps.orgHealthPort.readSnapshot({ home });
  const standing = orgHealthStanding({ nowMs: deps.nowMs(), snapshot });
  if (standing.state === "unmeasurable") {
    if (json) {
      deps.writeOut(
        safeJsonStringify({
          label: "incident postmortems --json",
          value: { because: standing.because, schemaVersion: 1, state: "unmeasurable" },
        }),
      );
    }
    deps.writeDiagnostic(`${VERB}: the incident snapshot cannot be believed — ${standing.because}`);
    return EXIT_ERROR;
  }
  const read = readCandidates({ home, incidents: standing.incidents });
  if (read.isErr()) {
    deps.writeDiagnostic(`${VERB}: ${read.error}`);
    return EXIT_ERROR;
  }
  const unrooted = unrootedAsks({ candidates: read.value.candidates, home });
  writeCandidates({ deps, home, json, read: read.value, readIso: standing.readIso, unrooted });
  if (read.value.candidates.length === 0) {
    deps.writeDiagnostic(
      `${VERB}: no resolved incident is waiting on a postmortem card (snapshot read ${standing.readIso})`,
    );
    return EXIT_EXPECTED_EMPTY;
  }
  return EXIT_OK;
}

/** `slopweaver incident postmortems`. */
export const incidentPostmortemsCommand = defineCommand({
  run: (argv) =>
    runIncidentPostmortems({
      deps: {
        nowMs: () => Date.now(),
        orgHealthPort: orgHealthPort(),
        writeDiagnostic: (line) => {
          logger.error({ msg: line });
        },
        writeOut: (line) => {
          logger.out({ line });
        },
      },
      rest: argv.slice(VERB_ARG_OFFSET),
    }),
});
