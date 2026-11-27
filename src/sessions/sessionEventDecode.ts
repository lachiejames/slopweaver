/**
 * One session ledger line, decoded: the field-by-field reading `./session.ts`'s `parseSessionLog` applies to every
 * line it parses, kept apart from the event shapes and the fold so each stays a file a reader can hold. A field whose
 * absence is ordinary decodes to nothing; one present and malformed makes the whole line unreadable, which the parser
 * reports rather than drops.
 */
import { isRecord } from "../lib/parsers.js";
import { decodePlanChoice, type SessionPlanChoice } from "./planChoice.js";
import type { BootModel, SessionEvent, SessionOpenedBy } from "./session.js";

/** Every {@link SessionOpenedBy}, for the decoder. */
const OPENED_BY: readonly SessionOpenedBy[] = ["open", "resume"];

/**
 * One line's `bootModel` field, or `undefined` when the line carries none.
 *
 * A malformed value — a `pinned` with no model string, an unknown `kind` — reads as `undefined`, i.e. exactly
 * as unrecorded. Refusing the whole `spawned` event over it would lose the workspace refs a supervisor needs
 * to close the session, which is a far worse trade than losing one tier label.
 */
function bootModelOf({ value }: { value: unknown }): BootModel | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (value["kind"] === "inherited") {
    return { kind: "inherited" };
  }
  const model = value["model"];
  return value["kind"] === "pinned" && typeof model === "string" ? { kind: "pinned", model } : undefined;
}

/**
 * One parsed line as a `spawned` event, or `undefined` when its own fields do not hold up.
 *
 * `slug` and `workspaceId` are the fields whose ABSENCE is ordinary rather than malformed: an ask worker and an
 * answer reviewer answer to no handover doc, and are keyed by their dispatch coordinates instead, and a row
 * written before `cmux spawn` recorded the id carries none. Either present but not a string is still a malformed
 * line, exactly as a bad `cwd` is.
 *
 * @param parsed the already-JSON-parsed line, known to be a record carrying a `sessionKey` and a `tsIso`
 * @param sessionKey the line's already-validated session key
 * @param tsIso the line's already-validated timestamp
 * @returns the event, or `undefined` when a required field is missing or the optional slug is mistyped
 */
function spawnedEventOf({
  parsed,
  sessionKey,
  tsIso,
}: {
  parsed: Record<string, unknown>;
  sessionKey: string;
  tsIso: string;
}): SessionEvent | undefined {
  const { slug, workspaceId, workspaceRef, surfaceRef, cwd, branch } = parsed;
  if (
    (slug !== undefined && typeof slug !== "string") ||
    (workspaceId !== undefined && typeof workspaceId !== "string") ||
    typeof workspaceRef !== "string" ||
    typeof surfaceRef !== "string" ||
    typeof cwd !== "string" ||
    typeof branch !== "string"
  ) {
    return undefined;
  }
  const harnessFields = harnessFieldsOf({ parsed });
  if (harnessFields === undefined) {
    return undefined;
  }
  const planChoiceField = planChoiceFieldOf({ parsed });
  if (planChoiceField === undefined) {
    return undefined;
  }
  const bootModel = bootModelOf({ value: parsed["bootModel"] });
  return {
    branch,
    ...(bootModel === undefined ? {} : { bootModel }),
    cwd,
    kind: "spawned",
    sessionKey,
    surfaceRef,
    tsIso,
    workspaceRef,
    ...(slug === undefined ? {} : { slug }),
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...planChoiceField,
    ...harnessFields,
  };
}

/**
 * A `spawned` line's `planChoice` field: absent on a row written before it existed, which is ordinary. Unlike
 * `bootModel`, one present but malformed makes the line unreadable — it is the record of a routing decision, and
 * reading a corrupt one as unrecorded would hide which plan the session actually spends.
 *
 * @param parsed the already-JSON-parsed line
 * @returns the field when present and valid, nothing when absent, or `undefined` when it is malformed
 */
function planChoiceFieldOf({
  parsed,
}: {
  parsed: Record<string, unknown>;
}): { readonly planChoice?: SessionPlanChoice } | undefined {
  const raw = parsed["planChoice"];
  if (raw === undefined) {
    return {};
  }
  const planChoice = decodePlanChoice({ value: raw });
  if (planChoice === undefined) {
    return undefined;
  }
  return { planChoice };
}

/**
 * A `spawned` line's three session-harness fields, each absent on a row no session harness wrote. One present but
 * mistyped — or an `openedBy` naming no act — makes the line malformed, exactly as a mistyped `slug` does.
 *
 * @param parsed the already-JSON-parsed line
 * @returns the fields present, or `undefined` when one is malformed
 */
function harnessFieldsOf({
  parsed,
}: {
  parsed: Record<string, unknown>;
}): Pick<SessionEvent & { kind: "spawned" }, "harness" | "openedBy" | "sessionId"> | undefined {
  const { harness, openedBy, sessionId } = parsed;
  const openedByKnown = OPENED_BY.find((act) => act === openedBy);
  if (
    (sessionId !== undefined && typeof sessionId !== "string") ||
    (harness !== undefined && typeof harness !== "string") ||
    (openedBy !== undefined && openedByKnown === undefined)
  ) {
    return undefined;
  }
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(openedByKnown === undefined ? {} : { openedBy: openedByKnown }),
    ...(harness === undefined ? {} : { harness }),
  };
}

/**
 * One parsed ledger line as an event.
 *
 * @param parsed the line, already JSON-parsed
 * @returns the event, or `undefined` when the line is not one
 */
export function sessionEventOf({ parsed }: { parsed: unknown }): SessionEvent | undefined {
  if (!isRecord(parsed) || typeof parsed["sessionKey"] !== "string" || typeof parsed["tsIso"] !== "string") {
    return undefined;
  }
  const line = { parsed, sessionKey: parsed["sessionKey"], tsIso: parsed["tsIso"] };
  switch (parsed["kind"]) {
    case "spawned":
      return spawnedEventOf(line);
    case "noted":
      return notedEventOf(line);
    case "resumed":
      return resumedEventOf(line);
    case "closed":
      return closedEventOf(line);
    default:
      return undefined;
  }
}

/** The fields every event's decoder is handed: the parsed line and its already-validated key and timestamp. */
interface DecodedLine {
  readonly parsed: Record<string, unknown>;
  readonly sessionKey: string;
  readonly tsIso: string;
}

/** One line as a `noted` event, or `undefined` when its note is not a string. */
function notedEventOf({ parsed, sessionKey, tsIso }: DecodedLine): SessionEvent | undefined {
  const { note } = parsed;
  return typeof note === "string" ? { kind: "noted", note, sessionKey, tsIso } : undefined;
}

/** One line as a `resumed` event, or `undefined` when it names no session. */
function resumedEventOf({ parsed, sessionKey, tsIso }: DecodedLine): SessionEvent | undefined {
  const { sessionId } = parsed;
  return typeof sessionId === "string" && sessionId.length > 0
    ? { kind: "resumed", sessionId, sessionKey, tsIso }
    : undefined;
}

/** One line as a `closed` event, each of its optional fields kept only when it is a string. */
function closedEventOf({ parsed, sessionKey, tsIso }: DecodedLine): SessionEvent {
  const { sessionId, spawnedIso, workspaceRef } = parsed;
  return {
    kind: "closed",
    sessionKey,
    tsIso,
    ...(typeof workspaceRef === "string" ? { workspaceRef } : {}),
    ...(typeof spawnedIso === "string" ? { spawnedIso } : {}),
    ...(typeof sessionId === "string" ? { sessionId } : {}),
  };
}
