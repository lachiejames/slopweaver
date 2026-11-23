/**
 * The eleven `SlackWriteTransport` methods that reshape a WORKSPACE rather than send a message — creating a
 * channel, opening a DM, inviting people, joining one as the token's own account, naming a purpose or topic, archiving, and the four canvas
 * operations — as a spreadable block of refusals.
 *
 * Shared, and spread into every existing message-path fake rather than copied eleven times into each, because
 * the property being asserted is the same in all of them and it is a REFUSAL: no message-sending path in
 * this repo has any business minting a channel or a canvas, so a change that starts doing so must fail the
 * existing suites loudly instead of finding a permissive stub already waiting for it.
 *
 * A plain hand-written object, never `vi.fn`/`vi.mock` — see `.claude/rules/testing.md`.
 */
import type { SlackWriteTransport } from "../corpus/slack/writeTransport.js";

/** Exactly the workspace-shape half of the transport, so a fake spreading this still type-checks whole. */
type WorkspaceShapeMethods = Pick<
  SlackWriteTransport,
  | "archiveChannel"
  | "createCanvas"
  | "createChannel"
  | "createChannelCanvas"
  | "deleteCanvas"
  | "inviteToChannel"
  | "joinChannel"
  | "openConversation"
  | "replaceCanvas"
  | "setChannelPurpose"
  | "setChannelTopic"
>;

/**
 * Every workspace-shape method, each throwing with its own name.
 *
 * @param path what the fake is exercising, named in the throw so a surprise call says which suite caught it
 * @returns the eleven methods, ready to spread into a transport fake
 */
export function workspaceShapeRefusals({ path }: { path: string }): WorkspaceShapeMethods {
  const refuse =
    ({ method }: { method: string }) =>
    async (): Promise<never> => {
      throw new Error(`${method} is not part of ${path}`);
    };
  return {
    archiveChannel: refuse({ method: "archiveChannel" }),
    createCanvas: refuse({ method: "createCanvas" }),
    createChannel: refuse({ method: "createChannel" }),
    createChannelCanvas: refuse({ method: "createChannelCanvas" }),
    deleteCanvas: refuse({ method: "deleteCanvas" }),
    inviteToChannel: refuse({ method: "inviteToChannel" }),
    joinChannel: refuse({ method: "joinChannel" }),
    openConversation: refuse({ method: "openConversation" }),
    replaceCanvas: refuse({ method: "replaceCanvas" }),
    setChannelPurpose: refuse({ method: "setChannelPurpose" }),
    setChannelTopic: refuse({ method: "setChannelTopic" }),
  };
}
