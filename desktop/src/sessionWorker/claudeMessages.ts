/**
 * What crosses between the worker wire and the Agent SDK's messages, both ways. Pure.
 *
 * Out: one typed prompt becomes one SDK user message. In: an assistant message's text becomes `agent-text`, and a
 * result — the SDK's one message per turn — becomes exactly one `turn-ended`. Everything else the SDK streams
 * (system, hook, task and status messages) reports nothing. The account the session opened on is judged here too:
 * a session that resolved an API key or a key helper instead of the routed subscription login is refused.
 */
import type { AccountInfo, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import type { FromWorker } from "./workerWire";

// The SDK shapes this module judges, for its tests: the root manifest does not list the SDK the desktop depends on.
export type { AccountInfo, SDKMessage };

/** The key sources that mean metered spend the plan never named. */
const METERED_KEY_SOURCES: readonly string[] = Object.freeze([
  "ANTHROPIC_API_KEY",
  "apiKeyHelper",
  "/login managed key",
]);

/**
 * The SDK message one typed prompt becomes.
 *
 * @param text what the owner, or a verb on the owner's behalf, typed
 * @returns a top-level user message
 */
export function userMessageOf({ text }: { text: string }): SDKUserMessage {
  return { message: { content: text, role: "user" }, parent_tool_use_id: null, type: "user" };
}

/**
 * What one SDK message reports to the control plane.
 *
 * @param message what the SDK streamed
 * @param sessionId the control plane's id, echoed on every report
 * @returns the reports, in order; none for a message the card does not show
 */
export function reportsOf({ message, sessionId }: { message: SDKMessage; sessionId: string }): readonly FromWorker[] {
  if (message.type === "assistant" && message.parent_tool_use_id === null) {
    return message.message.content.flatMap((block) =>
      block.type === "text" ? [{ kind: "agent-text" as const, sessionId, text: block.text }] : [],
    );
  }
  if (message.type === "result") {
    const stopReason = message.subtype === "success" && !message.is_error ? "end_turn" : message.subtype;
    return [{ kind: "turn-ended", sessionId, stopReason }];
  }
  return [];
}

/**
 * Why a streamed message shows the session is not the transcript the app minted for it.
 *
 * @param message what the SDK streamed
 * @param vendorSessionId the transcript id the app handed the SDK
 * @returns the refusal, or `undefined` when the message carries that id
 */
export function transcriptRefusal({
  message,
  vendorSessionId,
}: {
  message: SDKMessage;
  vendorSessionId: string;
}): string | undefined {
  if (message.session_id === vendorSessionId) {
    return undefined;
  }
  return `the session streamed transcript ${message.session_id}, not the ${vendorSessionId} the app recorded for it`;
}

/**
 * Why the account a session opened on may not run it.
 *
 * @param account what the SDK's initialisation reported
 * @returns the refusal, or `undefined` for a subscription login with no key source
 */
export function accountRefusal({ account }: { account: AccountInfo }): string | undefined {
  const { apiKeySource, subscriptionType } = account;
  if (apiKeySource !== undefined && METERED_KEY_SOURCES.includes(apiKeySource)) {
    return `the session resolved a metered credential (${apiKeySource}) instead of the plan's routed login`;
  }
  if (subscriptionType === undefined || subscriptionType.length === 0) {
    return "the session reported no subscription for its login, so the plan's routed login could not be confirmed";
  }
  return undefined;
}
