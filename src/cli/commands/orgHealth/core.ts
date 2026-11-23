/**
 * Pure option parsing and output for `slopweaver org-health read`, `org-health status` and `org-health ack`. No I/O,
 * no clock.
 */
import { parseIsoMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";

import { type AcknowledgementRow, INCIDENT_REF } from "../../../orgHealth/acknowledgement.js";
import { investigationLine } from "../../../orgHealth/investigation.js";
import type { IncidentRead } from "../../../orgHealth/read.js";
import type { OrgHealthStatus } from "../../../orgHealth/standing.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/**
 * The flags `org-health read` and `org-health status` accept — the same three, so one parser reads both.
 *
 * @internal exported for its own tests until a consumer outside this module reads it.
 */
export const ORG_HEALTH_READ_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["home", "now"],
};

/** Every flag this verb accepts, so `--help`'s advertised usage is checked against the parser. */
export const ORG_HEALTH_READ_FLAG_NAMES: readonly string[] = ["--json", "--now", "--home"];

/** What one `org-health read` or `org-health status` invocation was asked to do. */
export interface OrgHealthReadOptions {
  readonly json: boolean;
  /** The instant the read is judged at: `--now` when passed, else the run's own clock. */
  readonly nowMs: number | undefined;
  readonly home: string | undefined;
}

/**
 * Read `org-health read`'s or `org-health status`'s arguments. No positionals.
 *
 * @param rest the argv tail after the verb
 * @returns the options, or every reason they were refused
 */
export function orgHealthReadOptions({ rest }: { rest: readonly string[] }): Result<OrgHealthReadOptions> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: ORG_HEALTH_READ_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const nowFlag = parsed.value.values["now"];
  const home = parsed.value.values["home"];
  let nowMs: number | undefined;
  if (typeof nowFlag === "string") {
    nowMs = parseIsoMs({ tsIso: nowFlag });
    if (nowMs === undefined) {
      return err([`--now ${nowFlag} is not an ISO-8601 instant`]);
    }
  }
  return ok({ home: typeof home === "string" ? home : undefined, json: parsed.value.values["json"] === true, nowMs });
}

/**
 * What a complete read prints: one line per incident worth showing, or that there is none, and what the read cost.
 *
 * @param read the complete read
 * @param json whether the caller asked for one object instead
 * @returns the lines to write, in order
 */
export function readLines({ read, json }: { read: IncidentRead; json: boolean }): readonly string[] {
  if (json) {
    return [
      JSON.stringify(
        { historyPages: read.historyPages, snapshot: read.snapshot, threadsOpened: read.threadsOpened },
        null,
        2,
      ),
    ];
  }
  const { snapshot } = read;
  const cost =
    `read ${snapshot.channelId} at ${snapshot.readIso}: ${String(snapshot.announcementCount)} announcement(s), ` +
    `${String(read.historyPages)} history page(s), ${String(read.threadsOpened)} thread(s) opened`;
  if (snapshot.incidents.length === 0) {
    return [cost, "  no incident open or recently resolved"];
  }
  return [
    cost,
    ...snapshot.incidents.map(
      (incident) =>
        `  ${incident.ref} ${incident.severity} · ${incident.title} — ${incident.status} (${incident.phase} since ` +
        `${incident.phaseChangedIso}, ${incident.phaseProvenance})`,
    ),
  ];
}

/**
 * What `org-health status` prints: the reading whole, or one line a person reads.
 *
 * @param status what the standing came to
 * @param json whether the caller asked for the whole document instead
 * @returns the lines to write, in order
 */
export function statusLines({ status, json }: { status: OrgHealthStatus; json: boolean }): readonly string[] {
  if (json) {
    return [JSON.stringify(status, null, 2)];
  }
  if (status.state === "unmeasurable") {
    return [`not measured — ${status.because}`];
  }
  if (status.tone === "healthy") {
    return [`healthy — no incident open (read ${status.readIso})`];
  }
  return [
    `${status.tone} — ${String(status.ongoing)} ongoing, ${String(status.investigating)} under investigation (read ${status.readIso})`,
    ...status.incidents.flatMap((incident) => {
      const lines = [`  ${incident.line}`];
      const investigation = investigationLine({ investigation: incident.investigation });
      if (investigation !== undefined) {
        lines.push(`    ${investigation}`);
      }
      if (incident.acknowledgement.state === "acknowledged") {
        lines.push(`    acknowledged ${incident.acknowledgement.atIso}, quiet until it changes`);
      }
      return lines;
    }),
  ];
}

/** The flags `org-health ack` accepts. */
const ORG_HEALTH_ACK_FLAGS: FlagSpec = {
  boolean: ["json"],
  string: ["by-session", "home", "now", "ref"],
};

/** Every flag `org-health ack` accepts, so `--help`'s advertised usage is checked against the parser. */
export const ORG_HEALTH_ACK_FLAG_NAMES: readonly string[] = ["--ref", "--by-session", "--json", "--home", "--now"];

/** Who a press is recorded as when the caller names nobody: the operator at a terminal. */
const TERMINAL_SESSION = "terminal";

/** What one `org-health ack` invocation was asked to do. */
export interface OrgHealthAckOptions {
  readonly ref: string;
  readonly bySession: string;
  readonly json: boolean;
  readonly home: string | undefined;
  /** The instant the press is recorded at, and the snapshot judged at: `--now` when passed, else the run's clock. */
  readonly nowMs: number | undefined;
}

/**
 * Read `org-health ack`'s arguments. No positionals.
 *
 * @param rest the argv tail after the verb
 * @returns the options, or every reason they were refused
 */
export function orgHealthAckOptions({ rest }: { rest: readonly string[] }): Result<OrgHealthAckOptions> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: ORG_HEALTH_ACK_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { values } = parsed.value;
  const ref = values["ref"];
  const bySession = values["by-session"];
  const nowFlag = values["now"];
  const home = values["home"];
  const problems: string[] = [];
  if (typeof ref !== "string" || !INCIDENT_REF.test(ref)) {
    problems.push("org-health ack needs --ref <INC-n>, the open incident they are acknowledging");
  }
  if (bySession !== undefined && (typeof bySession !== "string" || bySession === "")) {
    problems.push("--by-session needs a name");
  }
  let nowMs: number | undefined;
  if (typeof nowFlag === "string") {
    nowMs = parseIsoMs({ tsIso: nowFlag });
    if (nowMs === undefined) {
      problems.push(`--now ${nowFlag} is not an ISO-8601 instant`);
    }
  }
  if (problems.length > 0 || typeof ref !== "string") {
    return err(problems);
  }
  let session = TERMINAL_SESSION;
  if (typeof bySession === "string") {
    session = bySession;
  }
  return ok({
    bySession: session,
    home: typeof home === "string" ? home : undefined,
    json: values["json"] === true,
    nowMs,
    ref,
  });
}

/**
 * What a recorded acknowledgement prints.
 *
 * @param row the row the press appended
 * @param json whether the caller asked for one object instead
 * @returns the lines to write, in order
 */
export function ackLines({ row, json }: { row: AcknowledgementRow; json: boolean }): readonly string[] {
  if (json) {
    return [JSON.stringify({ ok: true, row })];
  }
  return [
    `acknowledged ${row.ref} (${row.severity}, ${row.phase}): org-health status reads it quiet until its severity or ` +
      "phase changes or it reopens. Nothing was sent to incident.io or anyone.",
  ];
}
