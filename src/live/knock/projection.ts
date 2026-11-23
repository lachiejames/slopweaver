/**
 * What a Knock message, event or delivery log becomes before anything prints it: delivery facts, and nothing a
 * person could be identified by or that says what they were told.
 *
 * The views are the ONLY thing the CLI receives, and none has a field `recipient`, `actors`, `data`, `metadata`,
 * the recipient snapshot, an engagement timestamp or any delivery request or response body or header could
 * reach — so "the door never prints who it was or what was sent" is a property of these types rather than of
 * each caller's care. A message's id, status, channel and workflow are the investigation's handle: the id is what
 * `knock message-events` and `knock delivery-logs` take next.
 */
import { unsetFieldAsNull } from "#lib/absent.js";

import type { KnockDeliveryLogWire, KnockMessageEventWire, KnockMessageWire } from "./boundaries.js";

/** One message's delivery facts, safe to print. */
export interface KnockMessageView {
  readonly id: string;
  /** `queued`, `sent`, `delivered`, `undelivered`, `not_sent`, `bounced`, … — Knock's word, unchanged. */
  readonly status: string;
  readonly insertedAt: string;
  readonly updatedAt: string;
  readonly scheduledAt: string | null;
  readonly channelId: string;
  /** `sms`, `email`, `push`, … — `null` when Knock omitted the channel object. */
  readonly channelType: string | null;
  /** The provider Knock sent through, e.g. `twilio`. */
  readonly channelProvider: string | null;
  /** The workflow key the message came from. */
  readonly sourceKey: string;
  readonly sourceType: string | null;
  readonly stepRef: string | null;
  readonly workflowRunId: string | null;
  readonly workflowRecipientRunId: string | null;
}

/** One message event, safe to print. */
export interface KnockEventView {
  readonly id: string;
  /** `message.sent`, `message.delivered`, `message.undelivered`, … */
  readonly type: string;
  readonly insertedAt: string;
}

/** One delivery log — the call Knock made to the provider — reduced to which service and what it answered. */
export interface KnockDeliveryLogView {
  readonly id: string;
  readonly insertedAt: string;
  readonly serviceName: string;
  /** The provider's HTTP status, or `null` when Knock recorded none. */
  readonly responseStatus: number | null;
}

/**
 * Project one parsed message.
 *
 * @param message the message as the strict boundary parsed it
 * @returns its printable view
 */
export function projectKnockMessage({ message }: { message: KnockMessageWire }): KnockMessageView {
  return {
    channelId: message.channel_id,
    channelProvider: message.channel === undefined ? null : message.channel.provider,
    channelType: message.channel === undefined ? null : message.channel.type,
    id: message.id,
    insertedAt: message.inserted_at,
    scheduledAt: unsetFieldAsNull({ key: "scheduled_at", record: message }),
    sourceKey: message.source.key,
    sourceType: unsetFieldAsNull({ key: "type", record: message.source }),
    status: message.status,
    stepRef: unsetFieldAsNull({ key: "step_ref", record: message.source }),
    updatedAt: message.updated_at,
    workflowRecipientRunId: unsetFieldAsNull({ key: "workflow_recipient_run_id", record: message.source }),
    workflowRunId: unsetFieldAsNull({ key: "workflow_run_id", record: message.source }),
  };
}

/**
 * Project one parsed event.
 *
 * @param event the event as the strict boundary parsed it
 * @returns its printable view
 */
export function projectKnockEvent({ event }: { event: KnockMessageEventWire }): KnockEventView {
  return { id: event.id, insertedAt: event.inserted_at, type: event.type };
}

/**
 * Project one parsed delivery log.
 *
 * @param log the log as the strict boundary parsed it
 * @returns its printable view
 */
export function projectKnockDeliveryLog({ log }: { log: KnockDeliveryLogWire }): KnockDeliveryLogView {
  return {
    id: log.id,
    insertedAt: log.inserted_at,
    responseStatus: unsetFieldAsNull({ key: "status", record: log.response }),
    serviceName: log.service_name,
  };
}

/**
 * The human lines for one message.
 *
 * @param view the projected message
 * @returns the lines, in print order
 */
export function renderKnockMessage({ view }: { view: KnockMessageView }): readonly string[] {
  const channel = [view.channelType, view.channelProvider].filter((part) => part !== null).join(" via ");
  return [
    `${view.id}  ${view.status}  ${channel.length === 0 ? `channel ${view.channelId}` : channel}`,
    `    workflow ${view.sourceKey}${view.stepRef === null ? "" : ` step ${view.stepRef}`}  inserted ${view.insertedAt}  updated ${view.updatedAt}`,
  ];
}
