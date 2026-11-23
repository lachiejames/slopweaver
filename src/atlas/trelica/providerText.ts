/**
 * Provider-authored free text — a step's failure message, a run's fired error or blocked reason, an
 * integration's last error — as a generation holds it.
 *
 * Every other field a projection reads is either Trelica's own vocabulary (a status, a type, a code) or data the
 * tenant configured (a person, a workflow, a step's name); these are the ones whose content a provider chooses, and
 * an integration that echoes its request or response into an error carries whatever that held with it. A
 * scrubber only catches a secret it can recognise, and a syntactic shape cannot tell a capitalised password from a
 * reason phrase, so the text is held only when it is a CLOSED value — and withheld otherwise.
 */
import { STATUS_CODES } from "node:http";

import { isRecord } from "#lib/parsers.js";

import { trelicaSecretsPruned } from "./browserReduction.js";
import type { TrelicaAtlasEntity } from "./model.js";

/**
 * The platform's own codes and states, held as they stand. MEASURED over the live store
 * (`jq -r '.. | objects | (.failureMessage?, .blockedReason?) // empty' ~/.slopweaver/atlas/trelica/workflow-runs.jsonl | sort | uniq -c`).
 * A code first seen after that is withheld until it is added here: the cost is one unread code, never a value.
 *
 * What this closes, and what it does not: a held text is always one of these constants or the withheld marker, so
 * nothing outside the set can be held. A secret someone chose to SPELL as one of these codes is held as that code,
 * which discloses only the public constant; telling the two apart would need the secret itself, which is never read.
 */
const TRELICA_CLOSED_TEXTS: ReadonlySet<string> = new Set([
  "AwaitingInput",
  "AwaitingIntegration",
  "AwaitingUserInput",
  "flow_error_integration_timeout",
  "flow_error_missing_external_id_and_backup",
  "flow_error_person_no_longer_exists",
  "flow_error_provisioning",
  "flow_general_error",
]);

/** A step's HTTP failure, `API call returned 415 Unsupported Media Type`. */
const API_CALL_STATUS = /^API call returned (\d{3}) ([A-Za-z ]+)$/;

/** An integration's last error, `401: Unauthorized - <the response body it echoes>`; only the status is held. */
const STATUS_THEN_BODY = /^(\d{3}): ([A-Za-z ]+?)(?: -.*)?$/s;

/** What is held in place of a text that is no closed value. */
export const TRELICA_PROVIDER_TEXT_WITHHELD = "(withheld: provider text of no known shape)";

/**
 * Whether a reason phrase is the standard one for its status — the check that makes a status line closed.
 *
 * @param status the three-digit status as written
 * @param reason the phrase written after it
 * @returns whether the phrase is exactly the standard reason for that status
 */
function isStandardReason({ reason, status }: { reason: string; status: string }): boolean {
  return STATUS_CODES[Number(status)] === reason;
}

/**
 * Hold one piece of provider-authored text: a platform code or state as it stands, a status line whose reason is
 * the standard phrase for its status, or {@link TRELICA_PROVIDER_TEXT_WITHHELD} for anything else.
 *
 * @param text the text as the provider wrote it, or `null` when it wrote none
 * @returns the held text, or `null` for none or only whitespace
 */
export function heldTrelicaProviderText({ text }: { text: string | null }): string | null {
  if (text === null || text.trim().length === 0) {
    return null;
  }
  const trimmed = text.trim();
  if (TRELICA_CLOSED_TEXTS.has(trimmed)) {
    return trimmed;
  }
  const apiCall = API_CALL_STATUS.exec(trimmed);
  if (apiCall !== null && isStandardReason({ reason: apiCall[2]!, status: apiCall[1]! })) {
    return trimmed;
  }
  const statusLine = STATUS_THEN_BODY.exec(trimmed);
  if (statusLine !== null && isStandardReason({ reason: statusLine[2]!, status: statusLine[1]! })) {
    return `${statusLine[1]!}: ${statusLine[2]!}`;
  }
  return TRELICA_PROVIDER_TEXT_WITHHELD;
}

/**
 * The states the platform writes on a run (`uiStatus`, `status`) and on each of its steps (`status`). MEASURED
 * over all runs in one generation (`jq -c '.channels["first-party-api"].detail | [.uiStatus, .status, .steps[]?.status]'
 * ~/.slopweaver/atlas/trelica/workflow-runs.jsonl`). The field is a free string at the boundary, so a state first seen
 * after that is held as {@link TRELICA_STATE_UNRECOGNISED}, which the verdicts read as `unknown`.
 */
const TRELICA_RUN_STATES: ReadonlySet<string> = new Set([
  "Blocked",
  "Completed",
  "CompletedWithErrors",
  "Failed",
  "NeedsInput",
  "NotStarted",
  "Skipped",
  "SkippedWithError",
  "Terminated",
  "WaitingForUser",
]);

/** What is held in place of a run or step state outside the measured set. */
export const TRELICA_STATE_UNRECOGNISED = "(unrecognised state)";

/**
 * Hold one run or step state: a measured platform state as it stands, {@link TRELICA_STATE_UNRECOGNISED} otherwise.
 *
 * @param state the state as the platform wrote it
 * @returns the held state
 */
export function heldTrelicaState({ state }: { state: string }): string {
  return TRELICA_RUN_STATES.has(state) ? state : TRELICA_STATE_UNRECOGNISED;
}

/** The keys under which a held detail carries provider-authored text; a fired error's own `message` is the fourth. */
const PROVIDER_TEXT_KEYS: ReadonlySet<string> = new Set(["blockedReason", "failureMessage", "lastError"]);

/** One field of a held detail, its provider text re-held and everything else walked. */
function reheldField({ field, key }: { field: unknown; key: string }): unknown {
  if (PROVIDER_TEXT_KEYS.has(key) && (typeof field === "string" || field === null)) {
    return heldTrelicaProviderText({ text: field });
  }
  if (key === "uiStatus" && typeof field === "string") {
    return heldTrelicaState({ state: field });
  }
  if (key === "firedErrors" && Array.isArray(field)) {
    return field.map((fired) => {
      if (!isRecord(fired) || typeof fired["message"] !== "string") {
        return fired;
      }
      return { ...fired, message: heldTrelicaProviderText({ text: fired["message"] }) };
    });
  }
  return reheldTrelicaProviderTexts({ value: field });
}

/**
 * A held detail with every piece of provider-authored text in it passed through today's rule again, at any
 * depth. Holding is idempotent, so a text held today is unchanged; a text an older generation held under a looser
 * rule is withheld rather than carried forward.
 *
 * @param value a held detail, as a kind file stores it
 * @returns the same detail with its provider text re-held
 * @internal
 */
export function reheldTrelicaProviderTexts({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => reheldTrelicaProviderTexts({ value: item }));
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, reheldField({ field, key })]));
}

/** A held record with its `status` closed when it carries one as a string; anything else as it stands. */
function withClosedStatus({ value }: { value: unknown }): unknown {
  if (!isRecord(value) || typeof value["status"] !== "string") {
    return value;
  }
  return { ...value, status: heldTrelicaState({ state: value["status"] }) };
}

/**
 * A held run's detail with its own `status` and every step's `status` closed. Scoped to a run: elsewhere a `status`
 * is platform vocabulary held as Trelica sets it (a person's, an integration's sync status), never a run state.
 */
function reheldRunStates({ detail }: { detail: unknown }): unknown {
  const run = withClosedStatus({ value: detail });
  if (!isRecord(run) || !Array.isArray(run["steps"])) {
    return run;
  }
  return { ...run, steps: run["steps"].map((step: unknown) => withClosedStatus({ value: step })) };
}

/**
 * An entity as a kind file is written with it: its first-party detail's provider text re-held, a run's states
 * closed, and anything beneath a secret-bearing key name pruned. No projection writes such a key — MEASURED, a jq over
 * every held detail's key paths found none of `browserReduction.ts`'s `TRELICA_SECRET_BEARING_KEYS` — so the prune costs nothing
 * today and stops a generation an older rule wrote from being republished as it stands.
 *
 * @param entity the entity, fresh or as the previous generation held it
 * @returns the entity with nothing an older rule let through
 */
export function reheldTrelicaEntity({ entity }: { entity: TrelicaAtlasEntity }): TrelicaAtlasEntity {
  const view = entity.channels["first-party-api"];
  if (view === null) {
    return entity;
  }
  const reheld = reheldTrelicaProviderTexts({ value: trelicaSecretsPruned({ value: view.detail }) });
  const detail = entity.kind === "workflow-run" ? reheldRunStates({ detail: reheld }) : reheld;
  return { ...entity, channels: { ...entity.channels, "first-party-api": { ...view, detail } } };
}
