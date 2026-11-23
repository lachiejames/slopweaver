/**
 * Shared literals for the Slack atlas's unit tests: an SDK method row, a captured call, a driven page.
 *
 * Plain builders over plain literals — no mock, no fake module, nothing that stands in for a real seam. A
 * test that needs a driven page hands one in, exactly as `drivenBrowser.ts` would.
 */
import type { DrivenPage } from "../../../../atlas/slackApi/atlasProjection.js";
import type { DrivenWalkedPage } from "../../../../atlas/slackApi/drivenSession.js";
import type { CapturedCall } from "../../../../atlas/slackApi/harObservations.js";
import type { SdkMethod } from "../../../../atlas/slackApi/model.js";

/**
 * An SDK method row, overridable field by field.
 *
 * @returns one `conversations.history` row as the typings extractor would produce it
 */
export function sdkMethod(over: Partial<SdkMethod> = {}): SdkMethod {
  return {
    argsType: "ConversationsHistoryArguments",
    description: "Fetches a conversation's history of messages and events.",
    name: "conversations.history",
    params: [
      { name: "channel", optional: false, type: "string" },
      { name: "limit", optional: true, type: "number" },
    ],
    responseFields: [
      { name: "ok", optional: false, type: "boolean" },
      { name: "messages", optional: true, type: "Message[]" },
    ],
    responseNested: { messages: ["text", "ts"] },
    responseType: "ConversationsHistoryResponse",
    ...over,
  };
}

/**
 * One reduced call, as the driven browser hands it over.
 *
 * @returns one captured call, its body already reduced to the shape the redactor reads
 */
export function capturedCall(over: Partial<CapturedCall> = {}): CapturedCall {
  return {
    body: { messages: [{ ts: "1.2" }], ok: true },
    name: "conversations.history",
    paramNames: ["channel"],
    ...over,
  };
}

/**
 * One page the driven browser reached, as the PROJECTION consumes it — screenshot already stored.
 *
 * The declared key is a real one, `/client/<team>/today`, so a test that counts reached pages against the
 * surface map counts one rather than none.
 *
 * @returns one driven page carrying a call, a screenshot and a browser-discovered address
 */
export function drivenPage(over: Partial<DrivenPage> = {}): DrivenPage {
  return {
    calls: [capturedCall()],
    observedAt: "2026-08-31T09:00:00.000Z",
    path: "/client/<team>/today",
    screenshotMissingBecause: null,
    screenshot: {
      byteLength: 1024,
      kind: "page-png",
      mediaType: "image/png",
      relativePath: "artifacts/pages/" + "a".repeat(64) + ".png",
      sha256: "a".repeat(64),
    },
    title: "Today",
    url: "https://app.slack.com/client/T0SYN1ABCDEFGH/today",
    ...over,
  };
}

/**
 * One page as the WALK DOCUMENT records it — a local screenshot path, never an artifact reference.
 *
 * `screenshotPath` defaults to `null` — reached but not photographed — so a test that wants a picture names
 * a real file it wrote itself. A default pointing at a path no test created would make every sync run fail
 * on a read, which is exactly the noise a fixture is supposed to remove.
 *
 * @returns one walked page
 */
export function walkedPage(over: Partial<DrivenWalkedPage> = {}): DrivenWalkedPage {
  return {
    calls: [capturedCall()],
    observedAt: "2026-08-31T09:00:00.000Z",
    path: "/client/<team>/today",
    screenshotMissingBecause: null,
    screenshotPath: null,
    title: "Today",
    url: "https://app.slack.com/client/T0SYN1ABCDEFGH/today",
    ...over,
  };
}

/** Where the roots hang in a test — no private identifier, and the two ids deliberately differ. */
export const TEST_ROOTS = {
  clientWorkspaceId: "E0SYN1ABCDEFGH",
  teamId: "T0SYN1ABCDEFGH",
  workspaceOrigin: "https://example-workspace.slack.com",
} as const;
