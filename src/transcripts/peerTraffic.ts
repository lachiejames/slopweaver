/**
 * The cross-session traffic on one transcript line: a message another session sent this one, a `SendMessage`
 * this one made, or the result a `SendMessage` returned.
 *
 * ## Why `./record.ts` cannot answer this
 *
 * `./record.ts` decodes `user` and `assistant` lines only. A peer message that arrives while the session is
 * mid-turn is written as an `attachment` line of type `queued_command` instead, and never as a `user` line.
 * MEASURED over 17 supervisor chairs: 150 of 229 peer deliveries were
 * that shape, invisible to every reader built on `./record.ts`. Reproduce on one transcript with
 * `grep -F cross-session-message <transcript.jsonl> | jq -r '[.type, (.origin.kind // ""), (.attachment.type // "")] | @tsv' | sort | uniq -c`.
 *
 * Both delivery shapes carry the same `origin` object — `kind: "peer"`, the sender's address in `name`, and a
 * `msg_id` — so a message is identified by that id, never by its text.
 *
 * ## A result belongs to its call
 *
 * A `SendMessage` call and its result are two lines: the assistant's `tool_use` (with the address and the
 * call's id) and the next user line's `tool_result` (quoting that id, with `toolUseResult.success` and the
 * `msg_id` it delivered). Both are read here with the id that joins them, and `../supervisor/inbound.ts` joins
 * them — so a failed send answers nothing, and a `msg_id` some other tool happened to return is never taken for
 * a chair's own delivery.
 *
 * ## A substring gate, then a structured read
 *
 * Every line of a transcript walked for owner turns passes through here too, and nearly none of them are
 * cross-session traffic. So a line is parsed only when it contains one of the literal keys the shapes below
 * require, spelled as Claude Code's own serialiser writes them (it escapes none of these ASCII keys). A line a
 * different producer wrote with those keys escaped would pass the gate unread — a property of the producer this
 * reads, stated rather than assumed away. Every decision after the gate is made on the parsed object.
 *
 * Pure: text in, typed values out.
 */

import { isRecord } from "../lib/parsers.js";

/** How a peer message reached the session. */
type PeerDelivery = "direct" | "queued";

/** One message another session sent this one. */
export interface PeerInbound {
  /** The harness's id for the message — what a `SendMessage` result names, and what groups two records of it. */
  readonly msgId: string;
  /** The sender's address, the name `SendMessage` would reply to. */
  readonly senderName: string;
  /** The line's ISO instant, or "" when it carried none. */
  readonly timestamp: string;
  /** The line's uuid — what a `transcript:<session>#<uuid>` pointer names. */
  readonly uuid: string;
  readonly lineNumber: number;
  /** `direct` for a `user` line, `queued` for a `queued_command` attachment written mid-turn. */
  readonly delivery: PeerDelivery;
  /** The message body as the harness recorded it. */
  readonly body: string;
}

/** One `SendMessage` call this session made. */
export interface PeerSend {
  /** The call's id, which its result quotes back. */
  readonly toolUseId: string;
  /**
   * The address it was sent to, EXACTLY as `input.to` carried it — a ` [ref]` disambiguation suffix included.
   *
   * `ListAgents` appends that suffix precisely when two live sessions share a bare name, so dropping it makes
   * a send to one of them answer a message from the other.
   * Kept whole, a reply addressed by ref simply does not clear the message, which is the soft direction.
   */
  readonly to: string;
  /** The line's ISO instant, or "" when it carried none. */
  readonly timestamp: string;
}

/** What one tool result reported about the call it answers. */
export interface PeerSendResult {
  /** The call this result answers. */
  readonly toolUseId: string;
  /**
   * The id it reports delivering, or "" when it named none. A result CAN report success without one, so the id
   * is what chair-to-chair traffic is matched on while success alone decides whether a reply happened — dropping
   * such a result would carry a message somebody had answered.
   */
  readonly msgId: string;
  readonly success: boolean;
}

/** What one line carried. Every field is empty on a line with no cross-session traffic. */
export interface PeerTraffic {
  readonly inbound: PeerInbound | undefined;
  readonly sends: readonly PeerSend[];
  readonly results: readonly PeerSendResult[];
}

/**
 * The literals a line must contain to be worth parsing: one per shape this module reads.
 *
 * `"toolUseResult"` earns its place even though it sits on every tool result, not just a `SendMessage` one: a
 * result CAN report success without naming a delivered id, and gating on `"msg_id"` alone discarded exactly
 * those replies. Those lines are already decoded once by `./record.ts` on the
 * same walk, so what this admits is a second parse of a line the reader was parsing anyway.
 */
const GATE_LITERALS: readonly string[] = ['"peer"', '"SendMessage"', '"msg_id"', '"toolUseResult"'];

/** A string field, or "" when absent or not a string. */
function str({ on, key }: { on: Record<string, unknown>; key: string }): string {
  const value = on[key];
  return typeof value === "string" ? value : "";
}

/**
 * A peer `origin` object as an inbound message, or `undefined` when it is not a complete one.
 *
 * @param origin the decoded `origin` field
 * @param line the decoded line, for its uuid and instant
 * @param lineNumber the 1-based position
 * @param delivery which shape carried it
 * @returns the message, or `undefined`
 */
function inboundOf({
  origin,
  line,
  lineNumber,
  delivery,
}: {
  origin: unknown;
  line: Record<string, unknown>;
  lineNumber: number;
  delivery: PeerDelivery;
}): PeerInbound | undefined {
  if (!isRecord(origin) || origin["kind"] !== "peer") {
    return undefined;
  }
  const msgId = str({ key: "msg_id", on: origin });
  const senderName = str({ key: "name", on: origin });
  if (msgId === "" || senderName === "") {
    return undefined;
  }
  return {
    body: str({ key: "body", on: origin }),
    delivery,
    lineNumber,
    msgId,
    senderName,
    timestamp: str({ key: "timestamp", on: line }),
    uuid: str({ key: "uuid", on: line }),
  };
}

/** A line's `message.content`, when it is a block array. */
function contentBlocks({ line }: { line: Record<string, unknown> }): readonly unknown[] {
  const message = isRecord(line["message"]) ? line["message"] : {};
  const content = message["content"];
  return Array.isArray(content) ? content : [];
}

/**
 * Every `SendMessage` call on an assistant line.
 *
 * @param line the decoded line
 * @returns the calls, empty for any other line
 */
function sendsOf({ line }: { line: Record<string, unknown> }): readonly PeerSend[] {
  if (line["type"] !== "assistant") {
    return [];
  }
  const timestamp = str({ key: "timestamp", on: line });
  return contentBlocks({ line }).flatMap((block: unknown): PeerSend[] => {
    if (!isRecord(block) || block["type"] !== "tool_use" || block["name"] !== "SendMessage") {
      return [];
    }
    const to = isRecord(block["input"]) ? str({ key: "to", on: block["input"] }) : "";
    const toolUseId = str({ key: "id", on: block });
    return to === "" || toolUseId === "" ? [] : [{ timestamp, to, toolUseId }];
  });
}

/**
 * The delivered `msg_id` a tool result reports, joined to the call it answers by the `tool_result` block's id.
 *
 * @param line the decoded line
 * @returns the result, empty for any line whose `toolUseResult` carries no `msg_id`
 */
function resultsOf({ line }: { line: Record<string, unknown> }): readonly PeerSendResult[] {
  const result = line["toolUseResult"];
  if (line["type"] !== "user" || !isRecord(result)) {
    return [];
  }
  const block = contentBlocks({ line }).find((candidate) => isRecord(candidate) && candidate["type"] === "tool_result");
  const toolUseId = isRecord(block) ? str({ key: "tool_use_id", on: block }) : "";
  if (toolUseId === "") {
    return [];
  }
  return [{ msgId: str({ key: "msg_id", on: result }), success: result["success"] === true, toolUseId }];
}

/** The reading for a line that carried nothing. */
const NO_TRAFFIC: PeerTraffic = { inbound: undefined, results: [], sends: [] };

/**
 * Read the cross-session traffic off one transcript line.
 *
 * @param line the raw JSONL line
 * @param lineNumber the 1-based position, carried into an inbound message
 * @returns what the line carried; every field empty when it carried nothing or would not parse
 */
export function readPeerTraffic({ line, lineNumber }: { line: string; lineNumber: number }): PeerTraffic {
  if (!GATE_LITERALS.some((literal) => line.includes(literal))) {
    return NO_TRAFFIC;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return NO_TRAFFIC;
  }
  if (!isRecord(parsed)) {
    return NO_TRAFFIC;
  }
  const attachment = isRecord(parsed["attachment"]) ? parsed["attachment"] : {};
  let inbound: PeerInbound | undefined;
  if (parsed["type"] === "user") {
    inbound = inboundOf({ delivery: "direct", line: parsed, lineNumber, origin: parsed["origin"] });
  } else if (parsed["type"] === "attachment" && attachment["type"] === "queued_command") {
    inbound = inboundOf({ delivery: "queued", line: parsed, lineNumber, origin: attachment["origin"] });
  }
  return { inbound, results: resultsOf({ line: parsed }), sends: sendsOf({ line: parsed }) };
}
