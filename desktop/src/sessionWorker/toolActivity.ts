/**
 * What a worker reports of a tool call, read off each vendor's own messages. Pure.
 *
 * The one rule every reader here keeps: a tool's identity, kind and status cross to the control plane, and nothing
 * the call was GIVEN or PRODUCED does. ACP's `title` is commonly the command line or the path itself, and its
 * `rawInput`, `rawOutput`, `content` and `locations` are the call's input and output, so none is read at all. A
 * vendor's tool name is kept only when it is a bare identifier (`../pictureWire.ts`), and every call id crosses as
 * its digest alone.
 */
import { createHash } from "node:crypto";

import { type AppToolKind, isAppToolKind, isAppToolStatus, isToolIdentifier } from "../pictureWire";
import type { ToolActivity } from "./workerWire";

/** The fields of an ACP session update this module reads; the SDK's `SessionUpdate` is assignable to it. */
interface ToolUpdateFields {
  readonly sessionUpdate: string;
  readonly toolCallId?: unknown;
  readonly name?: unknown;
  readonly kind?: unknown;
  readonly status?: unknown;
}

/** Claude Code's own tools, by the kind each one is; every other name, an MCP tool's included, is `other`. */
const CLAUDE_TOOL_KINDS: Readonly<Record<string, AppToolKind>> = {
  Agent: "delegate",
  Bash: "execute",
  Edit: "edit",
  Glob: "search",
  Grep: "search",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Read: "read",
  Task: "delegate",
  WebFetch: "fetch",
  WebSearch: "search",
  Write: "edit",
};

/**
 * A vendor's tool call id as a picture carries it: always its digest, so one call still pairs its start with its end
 * while nothing the vendor wrote crosses, even a vendor that puts a one-word command or a file name in its id.
 *
 * @param value the vendor's id for the call
 * @returns `sha256:` and the id's lowercase hex digest
 */
export function toolCallDigest({ value }: { value: string }): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * The parts of an activity that are only sometimes known, each present only when the vendor gave it in a shape the
 * picture may carry: a name that is not a bare identifier is dropped rather than shortened.
 *
 * @param name the vendor's name for the tool
 * @param toolKind the kind the vendor gave, or the one derived from the name
 * @param status the status the vendor gave
 * @param parentToolCallId the call that started the subagent making this one
 * @returns the optional fields, each absent when unknown
 */
export function knownToolFields({
  name,
  toolKind,
  status,
  parentToolCallId,
}: {
  name: unknown;
  toolKind: unknown;
  status: unknown;
  parentToolCallId: string | null | undefined;
}): Omit<ToolActivity, "toolCallId"> {
  return {
    ...(isToolIdentifier(name) ? { name } : {}),
    ...(isAppToolKind(toolKind) ? { toolKind } : {}),
    ...(isAppToolStatus(status) ? { status } : {}),
    ...(parentToolCallId == null ? {} : { parentToolCallId: toolCallDigest({ value: parentToolCallId }) }),
  };
}

/**
 * The kind a Claude Code tool is, by its name.
 *
 * @param name the `tool_use` block's tool name
 * @returns the kind, `other` for any tool Claude Code does not ship
 */
export function claudeToolKindOf({ name }: { name: string }): AppToolKind {
  const kind = CLAUDE_TOOL_KINDS[name];
  if (kind === undefined) {
    return "other";
  }
  return kind;
}

/**
 * What one ACP session update reports of a tool call: a `tool_call` or a `tool_call_update`, read for its id, name,
 * kind and status alone. A field the update leaves out, or sends as null, stays out, so the fold keeps what it had.
 *
 * @param update the ACP `session/update` payload
 * @returns the activity, or `undefined` for an update that is not about a tool call
 */
export function codexToolActivityOf({ update }: { update: ToolUpdateFields }): ToolActivity | undefined {
  const { sessionUpdate, toolCallId } = update;
  if ((sessionUpdate !== "tool_call" && sessionUpdate !== "tool_call_update") || typeof toolCallId !== "string") {
    return undefined;
  }
  return {
    toolCallId: toolCallDigest({ value: toolCallId }),
    ...knownToolFields({
      name: update.name,
      parentToolCallId: undefined,
      status: update.status,
      toolKind: update.kind,
    }),
  };
}
