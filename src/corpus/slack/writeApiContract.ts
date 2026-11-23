/**
 * The Slack WRITE seam's CONTRACT — what the CLI may ask a workspace to do, and nothing about how.
 *
 * Split out of `./writeApi.ts` when the no-fold form's own send method pushed that file past
 * `file-size-ratchet`'s 600-code-line cap. The seam is a real one rather than a place to cut: everything
 * here is the TYPE every caller and every test fake is written against, while everything left there is the
 * live construction — the clients, the retry policy, the 429 scope, the transport wiring. A fake in a unit
 * test needs this file and none of that, and the compiler now says so.
 *
 * `./writeApi.ts` re-exports {@link SlackWriteApi}, so nothing importing it from there had to change.
 */
import type {
  NoFoldRecurrence,
  SlackCardPayload,
  SlackDripMessagePayload,
  SlackDripSendResult,
  SlackNoFoldPayload,
  SlackSendResult,
} from "../../outbound/slack/types.js";
import type { SlackUpload } from "./writeTransport.js";

/** What the seam can do to a workspace, as the CLI consumes it. */
export interface SlackWriteApi {
  /**
   * Send a card through the composite send — post, attach media, read back — and return its identity.
   *
   * Named for what it does rather than `send`, because `prLeadSeams/` keys a write by its member's NAME: a
   * bare `.send` is every websocket and mail client, so this one needs a name only it carries.
   */
  sendComposite(args: {
    channel: string;
    payload: SlackCardPayload;
    threadTs?: string | undefined;
    uploads: readonly SlackUpload[];
  }): Promise<SlackSendResult>;
  /**
   * Send a NO-FOLD bot message and return its identity.
   *
   * No `uploads` parameter, and that absence is the contract rather than an omission. Media rides on a card
   * through a COMPOSITE send — post, `chat.update` with `file_ids`, read back — and that update re-sends the
   * `attachments` array, which is exactly the wrapper a no-fold message must never have. `slack post`
   * refuses `--media` on this form before a byte is uploaded, and this signature is why that refusal cannot
   * be forgotten: there is nowhere here to pass a file. `recurrence` is required so no caller can leave the
   * repeat guard's question unanswered.
   */
  sendNoFold(args: {
    channel: string;
    payload: SlackNoFoldPayload;
    threadTs?: string | undefined;
    recurrence: NoFoldRecurrence;
  }): Promise<SlackSendResult>;
  /**
   * Send ONE message of an as-me drip and return its identity.
   *
   * One message per call, never the whole sequence, and that is the point: the caller has to hold each
   * message's reservation, pacing and outcome individually, so a drip that fails partway is recoverable.
   * A `sendDrip(messages)` here would bury the ordering and the per-message bookkeeping inside the seam,
   * where the partial-failure path could not be exercised.
   *
   * `uploads` is REQUIRED and empty for a message carrying no media, never optional: a drip attaches its
   * files to exactly one of its N messages, so "this call had no uploads" and "this caller forgot to pass
   * them" must not look the same at the seam.
   */
  sendDripMessage(args: {
    channel: string;
    payload: SlackDripMessagePayload;
    threadTs?: string | undefined;
    uploads: readonly SlackUpload[];
  }): Promise<SlackDripSendResult>;
  /**
   * Read one of OUR OWN just-posted messages back, for the send receipt.
   *
   * Returns what Slack STORED — the parsed blocks — plus the workspace url a permalink is built on, and
   * nothing else, because those are the two things a receipt needs and a wider return would make this a
   * general read path. `undefined` when the read could not answer at all; the caller reports that as "not
   * checked" and never as a failed send, since the message is already published by then.
   */
  readOwnMessage(args: {
    channel: string;
    ts: string;
  }): Promise<
    { readonly blocks?: readonly unknown[] | undefined; readonly workspaceUrl?: string | undefined } | undefined
  >;
  /**
   * Delete one of OUR OWN messages — the last step of a render proof, which must leave nothing behind.
   *
   * Returns whether it is gone rather than throwing on an already-absent message, matching
   * `deleteMessage`'s own idempotence: the desired end state is the message not being there.
   */
  deleteOwnMessage(args: { channel: string; ts: string }): Promise<boolean>;
}
