/**
 * Which Slack conversation a link points into, so whoever adds a link can name its channel in the register's meta.
 *
 * Pure.
 */

/** A Slack archive address, capturing the conversation id it points into. */
const SLACK_ARCHIVE = /^https:\/\/[^/]+\.slack\.com\/archives\/([A-Z0-9]+)/u;

/**
 * The Slack conversation a link points into.
 *
 * @returns the conversation id, or `undefined` for a link that is not a Slack archive address
 */
export function slackChannelOf({ href }: { href: string }): string | undefined {
  return SLACK_ARCHIVE.exec(href)?.[1];
}
