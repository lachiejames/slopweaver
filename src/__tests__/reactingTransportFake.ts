/**
 * A fake Slack message whose reactions are a REAL set — the shared fake every lifecycle-reaction test drives.
 *
 * `addReaction` inserts, `removeReaction` deletes, `readReactions` reports what is actually standing, and a
 * delete of something absent succeeds exactly as `reactions.remove`'s `no_reaction` does on the wire. Every
 * other transport method throws, so a stray call fails loudly instead of passing by coincidence.
 *
 * A real set rather than a call log, because the defects this fake exists to catch are STATES: "the message
 * is wearing two reactions that contradict each other" and "the message is wearing the warning a phantom
 * finding raised while a live worker answers". Neither is visible in a list of calls that were made.
 *
 * Shared rather than local to one test file because two lanes now need it — the convergence's own regression
 * tests and the per-tick reaction assertion — and a second copy is how two fakes come to disagree about what
 * `no_reaction` does.
 */

import type { SlackWriteTransport } from "../corpus/slack/writeTransport.js";
import { ok } from "../lib/result.js";
import { workspaceShapeRefusals } from "./slackWorkspaceShapeFake.js";

/**
 * A write transport whose reaction calls read and write `standing`, keyed by message ts.
 *
 * @param standing the reactions each message is wearing, mutated in place so a test can seed and read it
 * @returns the fake transport
 */
export function reactingTransport({ standing }: { standing: Map<string, Set<string>> }): SlackWriteTransport {
  const unused =
    ({ method }: { method: string }) =>
    async (): Promise<never> => {
      throw new Error(`${method} is not part of a lifecycle-reaction transition`);
    };
  // Creates the message's set on first touch rather than dropping a write into a discarded copy — a fake
  // whose writes silently go nowhere would make every assertion built on it pass for the wrong reason.
  const setFor = ({ ts }: { ts: string }): Set<string> => {
    const existing = standing.get(ts);
    if (existing !== undefined) {
      return existing;
    }
    const created = new Set<string>();
    standing.set(ts, created);
    return created;
  };
  return {
    ...workspaceShapeRefusals({ path: "the turn lifecycle-react path" }),
    addReaction: async ({ name, posted }) => {
      setFor({ ts: posted.ts }).add(name);
      return true;
    },
    appendStream: unused({ method: "appendStream" }),
    attachAssistantMedia: unused({ method: "attachAssistantMedia" }),
    attachMedia: unused({ method: "attachMedia" }),
    attachRecipeResponseMedia: unused({ method: "attachRecipeResponseMedia" }),
    conversationInfo: async () => ({ name: undefined, surface: "public-channel" as const }),
    deleteMessage: unused({ method: "deleteMessage" }),
    deleteMessageOnce: unused({ method: "deleteMessageOnce" }),
    postAssistantMessage: unused({ method: "postAssistantMessage" }),
    postCard: unused({ method: "postCard" }),
    postDripMessage: unused({ method: "postDripMessage" }),
    postNoFold: unused({ method: "postNoFold" }),
    postPoll: unused({ method: "postPoll" }),
    postRecipeResponse: unused({ method: "postRecipeResponse" }),
    postTurn: async ({ channel }) => ({ channel, ts: "1787540563.000900" }),
    readBackFileCount: unused({ method: "readBackFileCount" }),
    readMessage: unused({ method: "readMessage" }),
    // The LIVE read, answered off the same set the writes mutate. `users` is empty because nothing that
    // reads this fake branches on who added a reaction — the lifecycle predicate reads names.
    readReactions: async ({ posted }) => [...setFor({ ts: posted.ts })].map((name) => ({ count: 1, name, users: [] })),
    removeReaction: async ({ name, posted }) => {
      setFor({ ts: posted.ts }).delete(name);
      return true;
    },
    setAssistantStatus: async () => ok(undefined),
    setThreadTitle: async () => ok(undefined),
    startStream: unused({ method: "startStream" }),
    stopStream: unused({ method: "stopStream" }),
    updateCard: unused({ method: "updateCard" }),
    correctMessage: unused({ method: "correctMessage" }),
    updateDripMessage: unused({ method: "updateDripMessage" }),
    updateTurn: async () => {},
    uploadPrivately: unused({ method: "uploadPrivately" }),
    userGroupIds: async () => new Map<string, string>(),
    whoAmI: async () => ({}),
  };
}
