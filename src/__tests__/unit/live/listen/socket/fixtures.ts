/**
 * The Socket Mode frames the listener loop's tests feed through a fake connection: an `events_api` envelope
 * carrying an `app_mention`, or one carrying a plain `message` in a DM, each with per-call overrides.
 */

/** This install's own Slack USER id — the tag a direct message must carry to be an address at all. */
export const SELF_USER = "U0BOT";

/**
 * An `events_api` frame carrying an `app_mention`, with per-call overrides — a peer/self bot tag included.
 *
 * @param envelopeId the Socket Mode envelope the frame is acknowledged by
 * @param event fields spread over the default mention event, overriding it
 * @param eventId Slack's event id, the key a redelivery is deduplicated on
 * @param retryAttempt Slack's redelivery counter
 * @param ts the mention's message timestamp
 * @returns the frame's JSON text
 */
export function mentionFrame({
  envelopeId,
  event = {},
  eventId,
  retryAttempt = 0,
  ts = "1785114398.557099",
}: {
  envelopeId: string;
  event?: Readonly<Record<string, unknown>>;
  eventId: string;
  retryAttempt?: number;
  ts?: string;
}): string {
  return JSON.stringify({
    envelope_id: envelopeId,
    payload: {
      event: { channel: "C0LISTEN", text: "<@U0BOT> status?", ts, type: "app_mention", user: "U0HUMAN", ...event },
      event_id: eventId,
      type: "event_callback",
    },
    retry_attempt: retryAttempt,
    type: "events_api",
  });
}

/**
 * An `events_api` frame carrying a 1:1 direct `message` that tags this bot, with per-call overrides.
 *
 * @param envelopeId the Socket Mode envelope the frame is acknowledged by
 * @param eventId Slack's event id, the key a redelivery is deduplicated on
 * @param event fields spread over the default DM event, overriding it
 * @returns the frame's JSON text
 */
export function messageFrame({
  envelopeId,
  eventId,
  event = {},
}: {
  envelopeId: string;
  eventId: string;
  event?: Readonly<Record<string, unknown>>;
}): string {
  return JSON.stringify({
    envelope_id: envelopeId,
    payload: {
      event: {
        channel: "D0OWNER",
        channel_type: "im",
        text: `<@${SELF_USER}> status?`,
        ts: "1785998605.523229",
        type: "message",
        user: "U0HUMAN",
        ...event,
      },
      event_id: eventId,
      type: "event_callback",
    },
    type: "events_api",
  });
}
