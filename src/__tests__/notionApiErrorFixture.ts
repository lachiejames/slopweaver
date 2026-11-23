/**
 * The failures a fake Notion seam answers with, in the shape the real seam returns: an `IngestError` whose `cause`
 * is what the transport threw. A refusal carries the guard's own error class as that cause, so the code that asks
 * whether a write was refused before the wire (`src/outbound/notion/sendFailure.ts`) answers it exactly as it would
 * for a real one — nothing here sets a flag or a message that the classifier could be fooled by.
 */
import type { IngestError } from "../lib/ingestError.js";
import { InvalidDatadogHostRefusedError } from "../outbound/invalidDatadogHost.js";
import { NotionPrivacyRefusedError } from "../outbound/notion/writePrivacy.js";

/** The text a privacy-refused fake write carries, as the transport's refusal opens. */
export const NOTION_REFUSED_TEXT = "notion pages.create refused before sending: the outbound privacy check stopped it.";

/** The text a dead-host-refused fake write carries. */
const NOTION_DEAD_HOST_TEXT = "notion pages.create blocked because it carries a dead Datadog console host.";

/**
 * An ambiguous failure — a timeout, a reset, a provider error — whose request may well have landed.
 *
 * @param message what the failure says, as a caller displays it
 * @returns the failure a fake seam method returns
 */
export function notionApiFailure({ message }: { message: string }): IngestError {
  return { cause: new Error(message), kind: "network", message, operation: "notion.write", provider: "notion" };
}

/**
 * A write the transport refused before the wire on a privacy finding.
 *
 * @returns the failure, its cause the privacy guard's own error
 */
export function notionPrivacyRefusal(): IngestError {
  const cause = new NotionPrivacyRefusedError(NOTION_REFUSED_TEXT);
  return { cause, kind: "http", message: NOTION_REFUSED_TEXT, operation: "notion.write", provider: "notion" };
}

/**
 * A write the transport refused before the wire because it carried a dead Datadog console host.
 *
 * @returns the failure, its cause the dead-host guard's own error
 */
export function notionDeadHostRefusal(): IngestError {
  const cause = new InvalidDatadogHostRefusedError(NOTION_DEAD_HOST_TEXT);
  return { cause, kind: "http", message: NOTION_DEAD_HOST_TEXT, operation: "notion.write", provider: "notion" };
}
