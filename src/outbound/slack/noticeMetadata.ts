/**
 * The metadata a plain bot NOTICE carries — the one thing that makes a sentence the bot posted about its own
 * lifecycle retractable. `slack delete` refuses a message with no slopweaver metadata, so a notice posted bare
 * stood in Slack for good: the stranded lane's re-dispatch line was refused deletion twice after the owner asked for
 * it gone.
 */
import type { SlackNoticeMetadata } from "./types.js";

/** The `metadata.event_type` every bot notice carries. Stable: a message in Slack holds it forever. */
export const NOTICE_METADATA_EVENT_TYPE = "slopweaver_notice_v1" satisfies SlackNoticeMetadata["event_type"];

/** The renderer id a notice carries, which `./lifecycleGuards.ts`'s `KNOWN_RENDERERS` recognises. */
const NOTICE_RENDERER = "slack-notice-v1" satisfies SlackNoticeMetadata["event_payload"]["renderer"];

/**
 * The metadata a plain bot notice is stamped with.
 *
 * @returns the notice metadata, identical on every call
 */
export function noticeMetadata(): SlackNoticeMetadata {
  return {
    event_payload: { artifactKind: "notice", renderer: NOTICE_RENDERER, schemaVersion: 1 },
    event_type: NOTICE_METADATA_EVENT_TYPE,
  };
}
