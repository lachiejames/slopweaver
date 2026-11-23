/**
 * What this atlas may do with one Microsoft Graph operation, decided per OPERATION.
 *
 * ## The criterion, and why it cannot be a list of families
 *
 * `docs/atlas-intent/06-holdings.md`: a highly voluminous family is enumerated and declared rather than stored whole,
 * and what makes a family voluminous is that its records are **time-series OBSERVATIONS** — emitted by the
 * platform, unbounded, growing with the clock, identified by an instant rather than by a name somebody chose.
 * Configuration is the complement: what a person or a system CREATED, and what can be listed exhaustively.
 *
 * That criterion cuts THROUGH a family rather than along it, and Graph is where that stops being theoretical:
 *
 * - `GET /auditLogs/signIns` streams observations and is voluminous; `GET /auditLogs/signIns/$count` is the
 *   enumeration of that same family and is kept, because a count is exactly what "enumerated and declared"
 *   means.
 * - `GET /users/{user-id}/messages` is voluminous; `GET /users/{user-id}/mailFolders` is the folder list a
 *   person authored, inside the same mail family, and is ordinary configuration.
 * - `GET /security/secureScores` is a daily time series; `GET /security/secureScoreControlProfiles` is the
 *   catalogue of controls it scores, which somebody authored.
 *
 * A rule stated as a list of product areas cannot express any of those three, and an atlas built from one
 * would drop the second of each pair along with the first.
 *
 * ## Every operation gets a row, mutations included
 *
 * The sibling JumpCloud registry drops an unnamed write rather than recording it. This one does not, and the
 * departure is deliberate: at 17,777 operations the writes are 47% of Graph's surface, and a map that omitted
 * them would answer "Graph offers no way to do that" — false, and the exact class of wrong answer an atlas
 * exists to prevent. A write is recorded as an `excluded` row saying why it will never be called; recording
 * that a mutation EXISTS is not the same as being able to perform one, and nothing in this atlas can.
 *
 * ## The read-shaped POST allowlist is short and reviewed one at a time
 *
 * Graph expresses several pure reads as POSTs because their arguments do not fit a URL — transitive group
 * membership is the important one, and no GET answers it. Every other POST, PATCH, PUT and DELETE is refused
 * by omission. A prefix or a name heuristic would not be safe here: `POST /groups/{group-id}/members/$ref`
 * reads like traversal and ADDS a member.
 */
import type { Microsoft365Disposition } from "./model.js";

/**
 * The POST operations that only ever QUERY, reviewed one at a time and matched on the final path segment.
 *
 * Each is a read Graph could not express as a GET because its argument is a body. `getByIds` and
 * `getAvailableExtensionProperties` are directory-wide lookups; the four membership calls are the transitive
 * closure of group and role membership, which is the single most load-bearing question an Entra
 * investigation asks and which no GET on this surface answers.
 */
const OBSERVATIONAL_POST_TAILS: ReadonlySet<string> = new Set([
  "checkMemberGroups",
  "checkMemberObjects",
  "getAvailableExtensionProperties",
  "getByIds",
  "getMemberGroups",
  "getMemberObjects",
]);

/**
 * What one rule decided, and the sentence a reader gets for it.
 *
 * @internal
 */
export interface Microsoft365DispositionRuling {
  readonly disposition: Microsoft365Disposition;
  /** Why, in English. Never empty, including for `reachable`. */
  readonly reason: string;
  /** Which rule decided it, so a surprising row can be traced to the line that produced it. */
  readonly ruleId: string;
}

/** One reviewed rule: what it matches, what it decides, and the sentence it writes. */
interface DispositionRule {
  readonly id: string;
  readonly disposition: Microsoft365Disposition;
  readonly pattern: RegExp;
  readonly reason: string;
}

/**
 * The voluminous families, in the order they are tested.
 *
 * Order matters only where two could match; each reason states the OBSERVATION being declared rather than
 * the product it belongs to, because the product is not what the criterion tests.
 */
const VOLUMINOUS_RULES: readonly DispositionRule[] = [
  {
    disposition: "voluminous",
    id: "mail-messages",
    pattern: /^\/(me|users\/\{user-id\})\/(mailFolders\/[^/]+\/)*(childFolders\/[^/]+\/)*messages(\/|$)/,
    reason:
      "mailbox messages are platform-emitted, unbounded and identified by the instant they arrived — the " +
      "operation is enumerated and declared; no message is ever stored here",
  },
  {
    disposition: "voluminous",
    id: "chat-and-channel-messages",
    pattern: /\/(chats\/\{chat-id\}|channels\/\{channel-id\}|primaryChannel)\/messages(\/|$)/,
    reason:
      "chat and channel messages are unbounded and grow with the clock — enumerated and declared, never " +
      "stored whole; the world model is where conversation goes",
  },
  {
    disposition: "voluminous",
    id: "calendar-events",
    pattern: /\/(events|calendarView|calendars\/\{calendar-id\}\/(events|calendarView))(\/|$)/,
    reason:
      "calendar events and calendar views are unbounded and indexed by instant — the operation is declared, " +
      "and no event is stored",
  },
  {
    disposition: "voluminous",
    id: "list-items",
    pattern: /^\/sites\/.*\/lists\/\{[^}]+\}\/items(\/|$)/,
    reason:
      "SharePoint list items are authored rows without bound — declared. The LIST is configuration somebody " +
      "created and stays reachable. This rule sits ABOVE the file rule deliberately: a list item path also " +
      "contains `/items/`, and matched there it would be given the wrong reason",
  },
  {
    disposition: "voluminous",
    id: "drive-items-and-file-content",
    pattern: /(^\/(drives|shares)(\/|$))|\/drive(\/|$)|\/(items|root|content|thumbnails|versions)(\/|$)|\/\$value$/,
    reason:
      "file listings and file bytes are the voluminous file class — enumerated and declared, never stored " +
      "whole; nothing here holds a document's contents",
  },
  {
    disposition: "voluminous",
    id: "hosted-content-bytes",
    pattern: /\/hostedContents(\/|$)|\/(preview|photo|photos)(\/|$)/,
    reason:
      "raw content bytes — a hosted attachment, a preview render or a profile photo. The operation is " +
      "declared; the bytes are not held",
  },
  {
    disposition: "voluminous",
    id: "unified-audit-log",
    pattern: /^\/auditLogs\/(directoryAudits|signIns|provisioning)(\/|$)/,
    reason:
      "the unified audit log: sign-ins, directory audits and provisioning events are the canonical " +
      "time-series observation on this platform — enumerated and declared, never stored whole",
  },
  {
    disposition: "voluminous",
    id: "device-management-audit",
    pattern: /^\/deviceManagement\/(auditEvents|troubleshootingEvents|userExperienceAnalytics)/,
    reason:
      "Intune audit events, troubleshooting events and endpoint-analytics series are platform-emitted and " +
      "unbounded — declared, not stored",
  },
  {
    disposition: "voluminous",
    id: "identity-risk-detections",
    pattern:
      /^\/identityProtection\/(riskDetections|servicePrincipalRiskDetections)(\/|$)|^\/identityProtection\/risky(Users|ServicePrincipals)\/\{[^}]+\}\/history(\/|$)/,
    reason:
      "risk detections and risk history are emitted by Identity Protection as they happen — declared, and " +
      "never stored whole; the CURRENT risk state of a principal is configuration and stays reachable",
  },
  {
    disposition: "voluminous",
    id: "usage-reports",
    pattern: /^\/reports\//,
    reason:
      "usage and activity reports are period-indexed aggregates the platform emits — declared, and never " +
      "stored whole; several return a CSV rather than JSON at all",
  },
  {
    disposition: "voluminous",
    id: "security-alerts-and-incidents",
    pattern: /^\/security\/(alerts|alerts_v2|incidents)(\/|$)/,
    reason:
      "alerts and incidents are emitted as they fire and grow without bound — enumerated and declared. " +
      "Reading them live is what an investigation does; holding them is what an atlas must not do",
  },
  {
    disposition: "voluminous",
    id: "security-telemetry",
    pattern:
      /^\/security\/(threatIntelligence|secureScores|runHuntingQuery|microsoft\.graph\.security\.runHuntingQuery)/,
    reason:
      "threat-intelligence records, daily secure scores and hunting-query results are observations over a " +
      "window — declared, never stored. `secureScoreControlProfiles` is the catalogue behind them and stays " +
      "reachable, which is the criterion cutting through a family rather than along it",
  },
  {
    disposition: "voluminous",
    id: "call-records",
    pattern: /^\/communications\/callRecords/,
    reason: "call records are per-call telemetry, unbounded and instant-identified — declared, never stored",
  },
  {
    disposition: "voluminous",
    id: "print-jobs",
    pattern: /^\/print\/.*\/jobs(\/|$)/,
    reason: "print jobs accumulate with use — the queue is declared; its rows are not held",
  },
  {
    disposition: "voluminous",
    id: "service-announcements",
    pattern: /^\/admin\/serviceAnnouncement\/(messages|issues|healthOverviews\/\{[^}]+\}\/issues)(\/|$)/,
    reason:
      "service-health messages and issues are published by Microsoft continuously — declared, and read live " +
      "when an investigation needs them",
  },
  {
    disposition: "voluminous",
    id: "meeting-artefacts",
    pattern: /\/onlineMeetings\/\{[^}]+\}\/(recordings|transcripts|attendanceReports)(\/|$)/,
    reason: "recordings, transcripts and attendance reports accumulate per meeting — declared, never stored",
  },
  {
    disposition: "voluminous",
    id: "personal-insights",
    pattern: /^\/(me|users\/\{user-id\})\/(insights|activities|analytics)(\/|$)/,
    reason:
      "usage-derived insights and activity histories are observations the platform computes over time — " +
      "declared, never stored",
  },
  {
    disposition: "voluminous",
    id: "document-body-surfaces",
    pattern: /\/(workbook|onenote)(\/|$)/,
    reason:
      "workbook cells and OneNote page bodies are document CONTENT reached through an operation surface — " +
      "declared, and held by nothing in this atlas",
  },
];

/**
 * Whether an operation is a read at all.
 *
 * @param method the HTTP method, upper-cased
 * @param pathShape the normalized path template
 * @returns true for a GET, and for the reviewed read-shaped POSTs
 */
function isObservational({ method, pathShape }: { method: string; pathShape: string }): boolean {
  if (method === "GET") {
    return true;
  }
  if (method !== "POST") {
    return false;
  }
  // `split` always yields at least one element, so the last one is present for any string at all.
  return OBSERVATIONAL_POST_TAILS.has(pathShape.split("/").at(-1)!);
}

/**
 * Decide what this atlas may do with one operation.
 *
 * Pure and total: every operation gets a ruling, and the ruling always carries the rule that produced it, so
 * a surprising row in a published generation can be traced back to the line that decided it.
 *
 * @param method the HTTP method, upper-cased
 * @param pathShape the normalized path template, parameters left as placeholders
 * @returns the disposition, the reason, and the rule id
 */
export function microsoft365DispositionFor({
  method,
  pathShape,
}: {
  method: string;
  pathShape: string;
}): Microsoft365DispositionRuling {
  if (!isObservational({ method, pathShape })) {
    return {
      disposition: "excluded",
      reason:
        `${method} mutates. This atlas only ever reads: no user is provisioned, no policy or group ` +
        "membership is edited, no device action is taken and no mail is sent. The row exists so the atlas " +
        "can say the operation is THERE without being able to perform it",
      ruleId: "mutation",
    };
  }
  if (pathShape.endsWith("/$count")) {
    return {
      disposition: "reachable",
      reason:
        "a count over a collection is the enumeration itself — it is what `enumerated and declared` means " +
        "for a voluminous family, and it returns one number rather than a row",
      ruleId: "collection-count",
    };
  }
  const matched = VOLUMINOUS_RULES.find((rule) => rule.pattern.test(pathShape));
  if (matched !== undefined) {
    return { disposition: matched.disposition, reason: matched.reason, ruleId: matched.id };
  }
  return {
    disposition: "reachable",
    reason:
      "identity or configuration: something a person or a system created, listable exhaustively, and not " +
      "identified by an instant. Nothing else in this installation holds this platform's directory, so the " +
      "atlas holds it",
    ruleId: "configuration-default",
  };
}

/**
 * Every rule id this module can return, so a test can assert the published rulings use no other.
 *
 * @returns the rule ids, sorted
 */
export function microsoft365DispositionRuleIds(): readonly string[] {
  return [
    "collection-count",
    "configuration-default",
    "mutation",
    ...VOLUMINOUS_RULES.map((rule) => rule.id),
  ].toSorted();
}
