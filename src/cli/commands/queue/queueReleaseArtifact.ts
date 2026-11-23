/*
 * Releasing a held draft that is an `UpdateArtifact` card rather than an answer form.
 *
 * The same accent-only wrapper renders it, so the two shapes reach Slack looking identical and the operator
 * card renderer is not imported here either. It reaches the door through `./queueReleaseDoor.ts` and cannot
 * append a queue event itself.
 */
import { type QueueItem, recordedAskIdentityForHeld } from "../../../admit/queue.js";
import { logger } from "../../../lib/logger.js";
import { updateArtifactSchema } from "../../../outbound/artifact/schema.js";
import { renderAssistantAskMessage } from "../../../outbound/assistant/answerMessage.js";
import { NO_MENTIONS } from "../../../outbound/slack/render.js";
import { EXIT_ERROR } from "../../exitCodes.js";
import { chromeFromProfile } from "../slack/wiring.js";
import { postReleasedPayload } from "./queueReleaseDoor.js";

/**
 * Say why a held draft matched neither the answer form nor the `UpdateArtifact` card schema.
 *
 * Its own function so {@link sendArtifactRelease} stays inside the body-length cap, and so this one refusal's
 * wording lives in one place rather than inline in a branch.
 *
 * @param issues what the parse reported, already in zod's own issue shape
 * @param replacement the `--form` replacement, when one was supplied — it changes which thing is named
 */
function reportArtifactDraftMismatch({
  issues,
  replacement,
}: {
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
  replacement: Readonly<Record<string, unknown>> | undefined;
}): void {
  const listed = issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  logger.error({
    msg:
      (replacement === undefined ? "the held draft" : "the --form replacement") +
      ` matches neither the answer form nor the UpdateArtifact card schema — ${listed}`,
  });
}

/**
 * Release a held `UpdateArtifact` card draft — one filed as a card rather than as a structured answer form.
 *
 * Rendered through the SAME answer renderer and composite sender a fresh turn now uses — never
 * `renderUpdateCard` itself — so a card release gets the same full chrome (author row, dividers, detail
 * label) the operator card carries, via `renderChromeBlocks` rather than the card renderer's own identity.
 * `media` is always empty on a card draft (the builder that files one never populates it), so this path
 * attaches nothing; it releases the draft's TEXT.
 *
 * @returns the verb's exit code
 */
export async function sendArtifactRelease({
  dryRun,
  home,
  item,
  note,
  raw,
  replacement,
}: {
  dryRun: boolean;
  home: string;
  item: QueueItem;
  note: string;
  raw: Readonly<Record<string, unknown>>;
  replacement: Readonly<Record<string, unknown>> | undefined;
}): Promise<number> {
  const draft = updateArtifactSchema.safeParse(raw);
  if (!draft.success) {
    reportArtifactDraftMismatch({ issues: draft.error.issues, replacement });
    return EXIT_ERROR;
  }
  const payload = renderAssistantAskMessage({
    artifact: draft.data,
    askIdentity: recordedAskIdentityForHeld({ held: item.held }),
    chrome: chromeFromProfile({ home }),
    // No mentions are ever resolved for a released card draft: it was composed by a turn, which
    // resolves none.
    mentions: NO_MENTIONS,
  });
  return postReleasedPayload({
    documents: [],
    dryRun,
    home,
    item,
    note,
    payload,
    replacement,
    uploads: [],
  });
}
