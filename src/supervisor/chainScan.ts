/**
 * Recovering the supervisor chain from the transcripts themselves — how a journal that did not exist yet
 * learns about the sixty-eight supervisors that ran before it.
 *
 * ## What makes a transcript a supervisor's, checkably
 *
 * The session INVOKED the supervisor skill. That is the act that makes a session the supervisor — the role's
 * own contract opens with it — and it lands in the transcript as an `assistant` record carrying a `Skill`
 * tool_use whose `input.skill` is {@link SUPERVISOR_SKILL}. It is a structured question asked of a decoded
 * record, never a substring sweep over the file (`../transcripts/record.ts` says why that distinction is not
 * a taste), and it depends on no workspace naming convention, so a chain recovered this way survives the
 * naming being changed.
 *
 * ## The cost, measured, and why this is a repair rather than a tick
 *
 * The pass reads every transcript on the machine and stops each one at its first supervisor marker, so a
 * supervisor's file is abandoned within a few dozen records and only a NON-supervisor is read whole.
 * MEASURED: 1,619 transcripts, 83 supervisor sessions recovered, 45.7 s wall — reproduce with
 * `time slopweaver supervisor chain --rescan`. That is affordable for a verb somebody typed and far too
 * expensive for the reconciliation's twenty-minute tick, which is why `./chainStore.ts`'s journal is the
 * sweep's source and this is what fills it.
 *
 * ## The instant a recovered link carries
 *
 * A scan cannot see when the pin moved — cmux holds that and it is not in the transcript. It uses the
 * session's FIRST record instead, which is when the session started. For the supervisor role those are the
 * same event to within a boot, because a supervisor takes the pin as its opening act; where they differ, the
 * link is early rather than late, so a span claims a few minutes it did not own rather than dropping turns.
 * A recovered link says `source: "scan"` for exactly this reason, and a `pin` link for the same session
 * replaces it.
 */
import { err, ok, type Result } from "../lib/result.js";
import { listSessions, transcriptReadings } from "../transcripts/source.js";
import { buildSupervisorLink, linkKey, type SupervisorLink } from "./supervisorLink.js";

/** The skill whose invocation makes a session the supervisor. */
const SUPERVISOR_SKILL = "slopweaver:supervisor";

/**
 * What one scan found, and what it could not look at.
 *
 * @internal — {@link scanSupervisorChain}'s return type; only its own callers and its test read it.
 */
export interface ChainScanResult {
  /** Every supervisor session recovered, oldest first. */
  readonly links: readonly SupervisorLink[];
  /** How many transcripts were opened. */
  readonly transcriptsRead: number;
  /** Transcripts that could not be walked completely, each with the reason — never silently dropped. */
  readonly problems: readonly string[];
}

/**
 * Walk one transcript for the supervisor marker, stopping at the first hit.
 *
 * @param path the transcript to walk
 * @returns the session's first instant when it invoked the supervisor skill, "" when it never did, or the
 *   reason the walk was incomplete
 */
function scanTranscript({ path }: { path: string }): Result<string> {
  const stream = transcriptReadings({ path });
  if (stream.isErr()) {
    return err([stream.error.message]);
  }
  let firstIso = "";
  let found = false;
  for (const reading of stream.value.readings) {
    if (!("record" in reading)) {
      continue;
    }
    const record = reading.record;
    if (firstIso === "" && record.timestamp !== "") {
      firstIso = record.timestamp;
    }
    if (record.toolUses.some((use) => use.name === "Skill" && use.skill === SUPERVISOR_SKILL)) {
      found = true;
      break;
    }
  }
  // A partial walk that found the marker is still a positive answer — the marker was READ, not inferred. A
  // partial walk that did not is inconclusive, and saying so is the whole point of reporting problems.
  if (stream.value.problems.length > 0 && !found) {
    return err(stream.value.problems.map((problem) => `${path}: ${problem}`));
  }
  return ok(found ? firstIso : "");
}

/**
 * Every session on this machine that ever ran as the supervisor.
 *
 * @param projectsDir `~/.claude/projects`
 * @returns the recovered links oldest first, how many transcripts were read, and every incomplete walk
 */
export function scanSupervisorChain({ projectsDir }: { projectsDir: string }): Result<ChainScanResult> {
  const listed = listSessions({ projectsDir });
  if (listed.isErr()) {
    return err([listed.error.message]);
  }
  const links: SupervisorLink[] = [];
  const problems: string[] = [];
  for (const session of listed.value) {
    const scanned = scanTranscript({ path: session.path });
    if (scanned.isErr()) {
      problems.push(...scanned.error);
      continue;
    }
    if (scanned.value === "") {
      continue;
    }
    const built = buildSupervisorLink({
      session: { host: "claude-code", id: session.sessionId },
      pinnedAtIso: scanned.value,
      source: "scan",
      target: { kind: "cmux", workspaceId: "", workspaceRef: "" },
    });
    if (built.isErr()) {
      problems.push(`${session.path}: ${built.error.message}`);
      continue;
    }
    links.push(built.value);
  }
  return ok({
    links: links.toSorted((left, right) => Date.parse(left.pinnedAtIso) - Date.parse(right.pinnedAtIso)),
    problems,
    transcriptsRead: listed.value.length,
  });
}

/**
 * The links a scan found that the journal does not already hold.
 *
 * @param found what {@link scanSupervisorChain} recovered
 * @param known the chain the journal already holds
 * @returns the links to append, oldest first
 */
export function missingLinks({
  found,
  known,
}: {
  found: readonly SupervisorLink[];
  known: readonly SupervisorLink[];
}): readonly SupervisorLink[] {
  const held = new Set(known.map((link) => linkKey({ link })));
  return found.filter((link) => !held.has(linkKey({ link })));
}
