/**
 * Where `slack poll`'s form comes from — stdin, a file, or the literal JSON — and the typed refusal an
 * unreadable source earns.
 *
 * Split out of `./pollRun.ts` because it is the verb's one read of the form before anything is validated: the
 * shell asks for a validated poll or its refusal, and never handles the source itself. An unreadable source
 * and a malformed form arrive as the same `SlackDelivery` refusal, so the shell prints both one way.
 */
import { readFileSync } from "node:fs";

import { err } from "../../../lib/result.js";
import { type SlackDelivery, SlackDeliveryErrors } from "../../../outbound/slack/deliveryErrors.js";
import type { PollArtifact } from "../../../outbound/slack/pollForm.js";
import { POLL_STDIN_SENTINEL, parsePollForm } from "./pollCore.js";

/** The form text: stdin when the sentinel was passed, a file when it looks like a path, else the literal. */
async function formText({ source, readStdin }: { source: string; readStdin: () => Promise<string> }): Promise<string> {
  if (source === POLL_STDIN_SENTINEL) {
    return readStdin();
  }
  if (source.trimStart().startsWith("{")) {
    return source;
  }
  return readFileSync(source, "utf8");
}

/**
 * Read and validate the poll form, folding an unreadable source into the same refusal as a bad shape.
 *
 * @param source the `--form` value: the stdin sentinel, literal JSON, or a path
 * @param readStdin how stdin is read, injected so the shell's fake reaches it
 * @returns the validated poll, or why it could not be read or validated
 */
export async function loadPollForm({
  source,
  readStdin,
}: {
  source: string;
  readStdin: () => Promise<string>;
}): Promise<SlackDelivery<PollArtifact>> {
  let text: string;
  try {
    text = await formText({ readStdin, source });
  } catch (error) {
    return err(SlackDeliveryErrors.pollFormUnreadable({ cause: error }));
  }
  return parsePollForm({ json: text });
}
