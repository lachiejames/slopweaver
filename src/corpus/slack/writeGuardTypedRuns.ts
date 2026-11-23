/**
 * The ONE DOOR for "no outbound text run carries a raw link or a raw mention".
 *
 * Every Slack write in this program goes through a {@link SlackWriteTransport}, and the live one is built
 * in exactly one place (`./writeApi.ts`'s `makeSlackWriteTransport`). So wrapping the transport is what
 * makes the refusal unroutable-around: a composer added next year that renders its own blocks and posts
 * them still passes through here, whether or not anybody remembers this rule exists.
 *
 * The wrapper is a pure function over a transport — hand it a plain fake and every branch is exercised
 * with no mock, no network and no clock, which is why the guard lives here rather than inside each
 * `*Call` function in `./writeApi.ts`.
 *
 * ## What is guarded, and what is not
 *
 * Guarded: every method that carries a rendered PAYLOAD — the card, the assistant answer, the as-me drip,
 * the recipe response, the poll, the progress frame, the turn frame, the stream's open/close payloads, and
 * every `chat.update` twin of those. That is the complete set of ways block content reaches Slack.
 *
 * Not guarded, and deliberately: `appendStream`'s chunks (native `task_update` objects, not `rich_text`),
 * the reaction/read/upload/identity calls (no content at all), and `deleteMessage` (it removes content).
 * The WORKSPACE-SHAPE methods (`createChannel`, `openConversation`, `inviteToChannel`, `joinChannel`,
 * `setChannelPurpose`, `setChannelTopic`, `archiveChannel`) join that list for the same reason: they carry names and ids, never
 * a block payload. The CANVAS methods (`createCanvas`, `createChannelCanvas`, `replaceCanvas`) carry PROSE
 * and still do not belong here — a canvas body is Slack's own canvas-flavoured markdown, which is the
 * document format rather than a `rich_text` block array, so there are no text RUNS for this rule to judge
 * and passing one through `assertTypedRunsOnly` would find nothing while implying it had checked.
 * Adding a payload-carrying method to the transport without adding it here is the one way to slip past
 * this, which is what `typedRunsOnly`'s own unit test pins.
 */
import { assertTypedRunsOnly } from "../../outbound/slack/typedRunsOnly.js";
import type { SlackWriteTransport } from "./writeTransport.js";

/**
 * A transport that REFUSES any payload whose `rich_text` text runs carry raw markup.
 *
 * Refusal is a throw rather than a `Result`, matching the seam it wraps: every method here already throws
 * on a failed write, and a caller that must handle "Slack said no" already handles "this must not be
 * sent". The error names the surface, so a refusal points at the composer rather than at the wire.
 *
 * @param transport the transport to wrap — the live one, or a fake in a test
 * @returns the same transport with every payload-carrying method guarded
 */
// max-lines-exempt: a flat one-line-per-method wiring table; splitting it would hide which surfaces are guarded
export function guardTypedRuns({ transport }: { transport: SlackWriteTransport }): SlackWriteTransport {
  const check = ({ payload, surface }: { payload: unknown; surface: string }): void => {
    assertTypedRunsOnly({ payload, surface });
  };
  return {
    ...transport,
    attachAssistantMedia: (args) => {
      check({ payload: args.payload, surface: "chat.update (assistant answer media)" });
      return transport.attachAssistantMedia(args);
    },
    attachMedia: (args) => {
      check({ payload: args.payload, surface: "chat.update (card media)" });
      return transport.attachMedia(args);
    },
    attachRecipeResponseMedia: (args) => {
      check({ payload: args.payload, surface: "chat.update (recipe response media)" });
      return transport.attachRecipeResponseMedia(args);
    },
    correctMessage: (args) => {
      // The stored blocks plus the one Correction line: the line is the authored part, the rest already shipped.
      check({ payload: args.corrected, surface: "chat.update (correction)" });
      return transport.correctMessage(args);
    },
    postAssistantMessage: (args) => {
      check({ payload: args.payload, surface: "chat.postMessage (assistant answer)" });
      return transport.postAssistantMessage(args);
    },
    postCard: (args) => {
      check({ payload: args.payload, surface: "chat.postMessage (card)" });
      return transport.postCard(args);
    },
    postDripMessage: (args) => {
      check({ payload: args.payload, surface: "chat.postMessage (as-me)" });
      return transport.postDripMessage(args);
    },
    postNoFold: (args) => {
      check({ payload: args.payload, surface: "chat.postMessage (no-fold)" });
      return transport.postNoFold(args);
    },
    postPoll: (args) => {
      check({ payload: args.payload, surface: "chat.postMessage (poll)" });
      return transport.postPoll(args);
    },
    postRecipeResponse: (args) => {
      check({ payload: args.payload, surface: "chat.postMessage (recipe response)" });
      return transport.postRecipeResponse(args);
    },
    postTurn: (args) => {
      check({ payload: args.payload, surface: "chat.postMessage (turn)" });
      return transport.postTurn(args);
    },
    startStream: (args) => {
      check({ payload: args.payload, surface: "chat.startStream" });
      return transport.startStream(args);
    },
    stopStream: (args) => {
      check({ payload: args.payload, surface: "chat.stopStream" });
      return transport.stopStream(args);
    },
    updateCard: (args) => {
      check({ payload: args.payload, surface: "chat.update (card)" });
      return transport.updateCard(args);
    },
    updateDripMessage: (args) => {
      check({ payload: args.payload, surface: "chat.update (as-me)" });
      return transport.updateDripMessage(args);
    },
    updateTurn: (args) => {
      check({ payload: args.payload, surface: "chat.update (turn)" });
      return transport.updateTurn(args);
    },
  };
}
