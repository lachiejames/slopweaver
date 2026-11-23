/**
 * incident.io Slack messages, shaped exactly as the live `#incidents` channel returned them
 * (`slopweaver slack read-thread <announcement permalink> --json`), with the people and the wording made up.
 */

/** The announcing bot, as both the root and every update carry it. */
const INCIDENT_BOT = "B0INCIDENT1";

/**
 * An announcement root, edited in place to `status`.
 *
 * @returns the raw `conversations.history` message
 */
export function announcement({
  ts = "1790126245.320409",
  number = 98,
  severity = "Critical",
  status = "Investigating",
  title = "Payment checkout regression",
  editedTs,
  latestReply,
  metadata = true,
}: {
  ts?: string;
  number?: number;
  severity?: string;
  status?: string;
  title?: string;
  editedTs?: string;
  latestReply?: string;
  metadata?: boolean;
} = {}): Record<string, unknown> {
  return {
    blocks: [
      { text: { emoji: true, text: `:clipboard: ${title}`, type: "plain_text" }, type: "header" },
      { type: "divider" },
      {
        text: {
          text:
            `:fire: *Severity*: ${severity}\n\n:pager: *Status*: ${status}\n\n` +
            ":bust_in_silhouette: *Reporter*: <https://example.slack.com/team/U0REPORT|@Wren Reporter>\n\n" +
            ":female-firefighter: *Incident Lead*: <https://example.slack.com/team/U0LEAD|@Riley Lead>\n\n" +
            ":slack: *Channel*: <#C0SYNINCCHAN1>",
          type: "mrkdwn",
          verbatim: false,
        },
        type: "section",
      },
      { type: "divider" },
      {
        elements: [
          {
            text: { text: ":globe_with_meridians: Incident homepage", type: "plain_text" },
            type: "button",
            url: `https://app.incident.io/example-org/incidents/${String(number)}`,
          },
          { text: { text: ":mailbox: Subscribe", type: "plain_text" }, type: "button", value: "01SUBSCRIBE" },
        ],
        type: "actions",
      },
    ],
    bot_id: INCIDENT_BOT,
    ...(editedTs === undefined ? {} : { edited: { ts: editedTs, user: "U0SYNBOTUSER" } }),
    ...(latestReply === undefined ? {} : { latest_reply: latestReply }),
    ...(metadata ? { metadata: { event_type: "incident_message" } } : {}),
    text: `[${severity}] ${title}`,
    thread_ts: ts,
    ts,
  };
}

/**
 * One thread update, as incident.io posts it.
 *
 * @returns the raw `conversations.replies` message
 */
export function update({
  ts,
  number = 98,
  from,
  to,
  words = "Root cause found in the payment configuration.",
  author = "Riley Lead",
  title = "Payment checkout regression",
  severity = "Critical",
  botId = INCIDENT_BOT,
}: {
  ts: string;
  number?: number;
  from?: string;
  to: string;
  words?: string;
  author?: string;
  title?: string;
  severity?: string;
  botId?: string;
}): Record<string, unknown> {
  const moved = from === undefined ? `*${to}*` : `~${from}~ → *${to}*`;
  return {
    bot_id: botId,
    text:
      `${author} updated INC-${String(number)} (${title}):  Severity: *${severity}* | Status: ${moved}  ${words}\n\n` +
      `Incident updated\n\nAvatar\n\nUpdated by: *${author}*`,
    thread_ts: "1790126245.320409",
    ts,
  };
}

/**
 * The weekly policy report the same bot posts into the channel — not an incident, though it carries the same
 * `incident_message` metadata (live, `1790611210.160899`).
 */
export const WEEKLY_REPORT: Record<string, unknown> = {
  blocks: [
    { text: { emoji: true, text: ":hourglass: Follow-up completion report", type: "plain_text" }, type: "header" },
    {
      text: {
        text: "This is your <https://app.incident.io/example-org/settings/policies/reports/01REPORT/edit|weekly report> for 1 policy",
        type: "mrkdwn",
        verbatim: false,
      },
      type: "section",
    },
  ],
  bot_id: INCIDENT_BOT,
  metadata: { event_type: "incident_message" },
  text: "This is your weekly report for 1 policy",
  thread_ts: "1790380810.000100",
  ts: "1790380810.000100",
};
