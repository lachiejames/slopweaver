/**
 * What one settled tool call established for the messenger band (`messengerBand.ts`). A row only ever claims what a
 * tool's own answer proved, so a refused call, a look with no frame and a read of something else establish nothing. Pure.
 */
import type { MessengerReadSubject } from "./messengerBand";

/** A card key out of a tool call's raw arguments. */
function cardKeyOf({ rawArguments }: { rawArguments: string }): string | undefined {
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    if (typeof parsed !== "object" || parsed === null || !("key" in parsed) || typeof parsed.key !== "string") {
      return undefined;
    }
    return parsed.key === "" ? undefined : parsed.key;
  } catch {
    return undefined;
  }
}

/**
 * What the voice now knows from one settled tool call.
 *
 * @param name the tool
 * @param rawArguments its arguments as the model sent them, where `read_card` names its card
 * @param refused whether the call came back without what it asked for
 * @param page the page the console window showed as the call ran
 * @param lookedApp the application a look landed on, `undefined` unless it stayed in front throughout
 * @returns what it established, or `undefined` for nothing
 */
export function messengerKnowledgeOf({
  name,
  rawArguments,
  refused,
  page,
  lookedApp,
}: {
  name: string;
  rawArguments: string;
  refused: boolean;
  page: { readonly path: string; readonly open: string | undefined };
  lookedApp: string | undefined;
}): MessengerReadSubject | undefined {
  if (refused) {
    return undefined;
  }
  if (name === "read_page") {
    return { kind: "page", open: page.open, path: page.path };
  }
  if (name === "read_card") {
    const key = cardKeyOf({ rawArguments });
    return key === undefined ? undefined : { key, kind: "card" };
  }
  if (name === "slack_open") {
    return { kind: "slack-thread" };
  }
  if (name === "slack_channel") {
    return { kind: "slack-channel" };
  }
  if (name === "read_screen" && lookedApp !== undefined) {
    return { appKey: lookedApp, kind: "screen" };
  }
  return undefined;
}
