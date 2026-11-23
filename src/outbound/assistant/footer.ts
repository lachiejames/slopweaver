/**
 * The PROVENANCE footer — one `context` block, `·`-separated, on the turn's WORKING message.
 *
 * This started as the reference agent's own footer, read raw off the reference thread:
 *
 *     { "type": "context", "elements": [ { "type": "mrkdwn", "verbatim": false, "text":
 *       "<https://claude.ai/code/session_<sessionId>|Open session in Claude> · claude-fable-5[1m] · <https://claude.ai/claude-in-slack/<teamId>/<channelId>/configure|Configure>" } ] }
 *
 * ## The session link is GONE, on the owner's explicit ruling
 *
 * The id behind that link names a LOCAL terminal session — nobody but the machine that started it can ever
 * open it, including the owner. A link that cannot open for anyone is not provenance, it is
 * decoration that looks like provenance, and it was ruled out rather than left to stand. The model id STAYS:
 * the owner values knowing which model answered, and that part of the trust claim is genuinely checkable.
 *
 * `TurnProvenance` carries the visible host and its opaque local id for enforcement, but no Slack surface
 * renders it. A local harness identity is not a shareable URL and must not be made to look like one.
 *
 * Two things that shape the code below still fall out of the original reference string:
 *
 *  1. **The model id is bare text, not a link,** and it carries its own brackets (`claude-fable-5[1m]`).
 *     Brackets are inert in mrkdwn, but `<`, `>` and `&` are not, so the id is escaped.
 *  2. **The separator is U+00B7 with single spaces,** not an em dash and not a pipe.
 *
 * The configure link is per-CHANNEL — `…/claude-in-slack/<teamId>/<channelId>/configure`. That shape is
 * theirs and is not reproducible by us, so this module takes a URL and builds none.
 *
 * Pure, and it holds no default for the model: a footer that invents a model id is worse than no footer,
 * because its whole job is to be checkable.
 */
import type { ContextBlock } from "@slack/types";

import { escapeMrkdwn } from "../slack/render.js";

/** The separator between footer parts — U+00B7, spaced, measured off the reference payload. */
const FOOTER_SEPARATOR = " · ";

/** The configure link's label, measured. */
const CONFIGURE_LABEL = "Configure";

/**
 * The three characters that terminate an mrkdwn link, percent-encoded.
 *
 * `<`, `>` and `|` are mrkdwn's own link delimiters, so a URL containing one cannot be expressed inside
 * `<url|label>` unambiguously — the parser has no way to tell the payload from the delimiter. Exactly what
 * Slack renders for such a URL was NOT measured here; what is certain is that the intended link is not
 * recoverable from the text, and a provenance footer whose whole job is to be checkable must not emit one.
 *
 * Encoding rather than refusing, because encoding is LOSSLESS: these three bytes must be percent-encoded in
 * a URL anyway, so the encoded form addresses the same resource. Refusing would kill a turn's footer over
 * something that has one correct answer we already know.
 */
const LINK_UNSAFE: readonly (readonly [string, string])[] = [
  ["<", "%3C"],
  [">", "%3E"],
  ["|", "%7C"],
];

/**
 * A URL made safe to sit inside `<url|label>`. Pure — no regex, so nothing can backtrack.
 *
 * @param url the target URL
 * @returns the URL with the three link-terminating characters percent-encoded
 */
export function linkSafeUrl({ url }: { url: string }): string {
  let out = url;
  for (const [raw, encoded] of LINK_UNSAFE) {
    out = out.split(raw).join(encoded);
  }
  return out;
}

/**
 * One mrkdwn link. The URL is encoded, the label is escaped — they are different jobs and swapping them
 * is the mistake this pair of helpers exists to prevent. Pure.
 *
 * @param url the target URL
 * @param label the visible text
 * @returns the mrkdwn link
 */
function link({ url, label }: { url: string; label: string }): string {
  return `<${linkSafeUrl({ url })}|${escapeMrkdwn({ text: label })}>`;
}

/**
 * Compose the footer text.
 *
 * The model id is required — it is the trust claim this footer still makes: WHAT produced the message. The
 * configure link is optional because it is a property of the deployment rather than of the turn, and a
 * footer missing it is still fully checkable. Pure.
 *
 * @param modelId the model that produced it, e.g. `claude-opus-5[1m]`
 * @param configureUrl the per-channel configure link, omitted when the deployment has none
 * @returns the `·`-separated mrkdwn footer text
 */
export function footerText({ modelId, configureUrl }: { modelId: string; configureUrl?: string | undefined }): string {
  const parts = [escapeMrkdwn({ text: modelId })];
  if (configureUrl !== undefined && configureUrl.length > 0) {
    parts.push(link({ label: CONFIGURE_LABEL, url: configureUrl }));
  }
  return parts.join(FOOTER_SEPARATOR);
}

/**
 * Render the provenance footer as its `context` block. Pure.
 *
 * `verbatim` is left unset rather than set to `false`. The reference payload READS BACK as
 * `"verbatim": false`, but that is Slack echoing its own default — sending the field would add a byte
 * that changes nothing, and this repo would then have to keep asserting it.
 *
 * @param modelId the model that produced it, e.g. `claude-opus-5[1m]`
 * @param configureUrl the per-channel configure link, omitted when the deployment has none
 * @returns the footer's `context` block
 */
export function renderFooter({
  modelId,
  configureUrl,
}: {
  modelId: string;
  configureUrl?: string | undefined;
}): ContextBlock {
  return {
    elements: [{ text: footerText({ configureUrl, modelId }), type: "mrkdwn" }],
    type: "context",
  };
}
