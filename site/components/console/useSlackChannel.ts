"use client";

/*
 * One Slack channel as it is now, read when its chip's hover window opens, through `app/api/slack-channel` — live off
 * Slack, so the window shows what the room says now. Nothing here polls, the same as `./useDraftContext.ts`: opening
 * the window again reads it again, and the window says when it was read.
 *
 * A failed re-read is said as the failure and never drawn over an earlier reading, unlike the console's other by-id
 * reads (`../../lib/keptReading.ts`): a reading carries pictures, and an earlier one drawn over a refusal would show
 * files the current read never vouched for, a workspace mismatch included.
 */

import { useEffect, useState } from "react";
import { CONSOLE_READ_HEADER, CONSOLE_READ_VALUE } from "../../lib/consoleRead";
import { readSlackChannel, type SlackChannelView } from "../live/readSlackChannel";

/** A channel read that landed. */
type ReadySlackChannel = { readonly phase: "ready"; readonly view: SlackChannelView };

/** A channel read once it answered, either way. */
type SettledSlackChannel = { readonly phase: "not-measured"; readonly why: string } | ReadySlackChannel;

/** The window's view of one channel read. */
export type SlackChannelState = { readonly phase: "loading" } | SettledSlackChannel;

/** The host a reading's own link names, or `undefined` when the link will not parse. */
function linkHost({ link }: { link: string }): string | undefined {
  try {
    return new URL(link).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Read the route's answer into the window's state, refusing any shape that is not the route's own, and a reading of
 * any channel or workspace but the one asked about.
 *
 * @param workspace the lowercase workspace host the chip's link named
 * @returns the state
 */
export function slackChannelStateOf({
  body,
  channel,
  workspace,
}: {
  body: unknown;
  channel: string;
  workspace: string;
}): SettledSlackChannel {
  if (typeof body !== "object" || body === null || !("ok" in body)) {
    return { phase: "not-measured", why: "/api/slack-channel answered something that is not a SlackChannelResult" };
  }
  if (body.ok !== true) {
    const why = "notMeasured" in body && typeof body.notMeasured === "string" ? body.notMeasured : "no reason given";
    return { phase: "not-measured", why };
  }
  const view = "view" in body ? readSlackChannel(body.view) : undefined;
  if (view === undefined) {
    return { phase: "not-measured", why: "slack channel-view answered in a shape this window does not read" };
  }
  if (view.channel !== channel) {
    return { phase: "not-measured", why: `slack channel-view answered for ${view.channel}, not ${channel}` };
  }
  const readIn = linkHost({ link: view.link });
  if (readIn === undefined) {
    return {
      phase: "not-measured",
      why: `slack channel-view answered with a link naming no workspace, not ${workspace}`,
    };
  }
  if (readIn !== workspace) {
    return { phase: "not-measured", why: `slack channel-view read ${readIn}, not ${workspace}` };
  }
  return { phase: "ready", view };
}

/**
 * Read one channel, live, every time the window opens. Nothing is kept between openings, so what is drawn is always
 * what this read answered.
 *
 * @param channel the conversation id off the chip's link
 * @param workspace the lowercase workspace host off the same link, which the verb checks its token against
 * @returns the read as it stands
 */
export function useSlackChannel({ channel, workspace }: { channel: string; workspace: string }): SlackChannelState {
  const key = `${workspace}/${channel}`;
  const [reading, setReading] = useState<{ readonly key: string; readonly state: SlackChannelState }>({
    key,
    state: { phase: "loading" },
  });
  useEffect(() => {
    const control = new AbortController();
    const read = async (): Promise<void> => {
      let next: SettledSlackChannel;
      try {
        const query = new URLSearchParams({ channel, workspace });
        const response = await fetch(`/api/slack-channel?${query.toString()}`, {
          cache: "no-store",
          headers: { [CONSOLE_READ_HEADER]: CONSOLE_READ_VALUE },
          signal: control.signal,
        });
        next = slackChannelStateOf({ body: await response.json(), channel, workspace });
      } catch (cause: unknown) {
        next = { phase: "not-measured", why: cause instanceof Error ? cause.message : String(cause) };
      }
      if (!control.signal.aborted) {
        setReading({ key, state: next });
      }
    };
    void read();
    return () => {
      control.abort();
    };
  }, [channel, key, workspace]);
  if (reading.key !== key) {
    return { phase: "loading" };
  }
  return reading.state;
}
