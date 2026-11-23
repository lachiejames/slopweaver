/**
 * The shared harness for the live turn poster's test files: the plain recording fake transport and the per-case
 * throwaway home.
 *
 * `liveTurnPoster` is the effectful shell around a real `SlackWriteTransport`. Its ORDERING claims — post is
 * a metadata-bearing post, advance updates, cleanup deletes directly, and a failed delete still finishes
 * the checklist truthfully — are exercised directly against this plain fake transport, the same no-mocks discipline
 * `run/*.test.ts` uses one level up through the `TurnPoster` seam.
 *
 * `usePosterHome()` mints the home in a `beforeEach` and removes it in the `afterEach` it registers, so read
 * `home` only inside a case. A filesystem round-trip into one `mkdtempSync` directory, nothing else.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

import { ok } from "#lib/result.js";

import type { SlackWriteTransport } from "../../../../../corpus/slack/writeTransport.js";
import { workspaceShapeRefusals } from "../../../../slackWorkspaceShapeFake.js";
import { POSTED } from "./fixtures.js";

/** The case's throwaway state home; a live binding, assigned before each case and read only inside one. */
export let home: string;

/**
 * Register the hooks that give every case its own throwaway home, and remove it after. Call it once, at the top of
 * a test file whose cases read {@link home}.
 */
export function usePosterHome(): void {
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "slop-poster-"));
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });
}

/** One recorded interaction with the transport. Plain array — no mocking framework anywhere near this. */
export interface Recorded {
  readonly method: string;
  readonly detail?: unknown;
}

/**
 * A recorded call's `detail`, narrowed to the shape the caller already knows the fake transport pushed.
 *
 * @returns the same value, typed as the shape its method pushed
 */
export function detailAs<T>({ detail }: { detail: unknown }): T {
  // `as`: `Recorded.detail` is `unknown` only because the log array is shared across every transport method;
  // the caller knows exactly which method it read this entry from, and therefore what shape it carries.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return detail as T;
}

/** A transport method that is not part of the checklist lifecycle: it throws `message` the moment it is reached. */
function refusing({ message }: { message: string }): () => Promise<never> {
  return async () => {
    throw new Error(message);
  };
}

/** The transport methods the checklist lifecycle never reaches, each throwing its own named message. */
function lifecycleRefusals(): Pick<
  SlackWriteTransport,
  | "appendStream"
  | "attachAssistantMedia"
  | "attachMedia"
  | "attachRecipeResponseMedia"
  | "correctMessage"
  | "postAssistantMessage"
  | "postCard"
  | "postDripMessage"
  | "postNoFold"
  | "postPoll"
  | "postRecipeResponse"
  | "readBackFileCount"
  | "readMessage"
  | "startStream"
  | "stopStream"
  | "updateCard"
  | "updateDripMessage"
  | "uploadPrivately"
> {
  return {
    appendStream: refusing({ message: "appendStream is not part of the static checklist lifecycle" }),
    attachAssistantMedia: refusing({ message: "attachAssistantMedia is not part of the checklist lifecycle" }),
    attachMedia: refusing({ message: "attachMedia is not part of the checklist lifecycle" }),
    attachRecipeResponseMedia: refusing({
      message: "attachRecipeResponseMedia is not part of the checklist lifecycle",
    }),
    correctMessage: refusing({ message: "correctMessage is not part of the checklist lifecycle" }),
    postAssistantMessage: refusing({ message: "postAssistantMessage is not part of the checklist lifecycle" }),
    postCard: refusing({ message: "postCard is not part of the checklist lifecycle" }),
    postDripMessage: refusing({ message: "postDripMessage is not part of the checklist lifecycle" }),
    postNoFold: refusing({ message: "postNoFold is not part of the checklist lifecycle" }),
    postPoll: refusing({ message: "postPoll is not part of the checklist lifecycle" }),
    postRecipeResponse: refusing({ message: "postRecipeResponse is not part of the checklist lifecycle" }),
    readBackFileCount: refusing({ message: "readBackFileCount is not part of the checklist lifecycle" }),
    readMessage: refusing({ message: "readMessage is not part of the checklist lifecycle" }),
    startStream: refusing({ message: "startStream is not part of the static checklist lifecycle" }),
    stopStream: refusing({ message: "stopStream is not part of the static checklist lifecycle" }),
    updateCard: refusing({ message: "updateCard is not part of the checklist lifecycle" }),
    updateDripMessage: refusing({ message: "updateDripMessage is not part of the checklist lifecycle" }),
    uploadPrivately: refusing({ message: "uploadPrivately is not part of the checklist lifecycle" }),
  };
}

/**
 * A configurable recording fake `SlackWriteTransport`. Every method not needed by the checklist lifecycle
 * throws, so a regression that reaches for the wrong verb fails loudly rather than passing by coincidence.
 *
 * @param log the array every recorded call is pushed onto, in call order
 * @param updateTurnThrows the message `updateTurn` throws as an `Error`, after recording the call
 * @param deleteSucceeds what both delete methods report; true unless the case is about a failed delete
 * @returns the fake transport
 */
export function fakeTransport({
  log,
  updateTurnThrows,
  updateTurnThrowsValue,
  deleteSucceeds = true,
}: {
  log: Recorded[];
  updateTurnThrows?: string;
  /** Throw this EXACT value instead of `new Error(updateTurnThrows)` — for a hostile, non-`Error` throw. */
  updateTurnThrowsValue?: unknown;
  deleteSucceeds?: boolean;
}): SlackWriteTransport {
  return {
    ...workspaceShapeRefusals({ path: "the turn poster" }),
    ...lifecycleRefusals(),
    addReaction: async () => true,
    conversationInfo: async () => ({ name: undefined, surface: "public-channel" as const }),
    deleteMessage: async ({ posted }) => {
      log.push({ detail: posted, method: "deleteMessage" });
      return deleteSucceeds;
    },
    deleteMessageOnce: async ({ posted }) => {
      log.push({ detail: posted, method: "deleteMessageOnce" });
      return deleteSucceeds ? { kind: "gone" } : { kind: "failed", reason: "the fake was told to fail" };
    },
    postTurn: async ({ payload }) => {
      log.push({ detail: payload, method: "postTurn" });
      return POSTED;
    },
    readReactions: async () => [],
    removeReaction: async () => true,
    setAssistantStatus: async () => ok(undefined),
    setThreadTitle: async () => ok(undefined),
    updateTurn: async ({ payload }) => {
      log.push({ detail: payload, method: "updateTurn" });
      if (updateTurnThrowsValue !== undefined) {
        // A non-`Error` throw is the point: the seam lets a case prove the poster survives any thrown value.
        // oxlint-disable-next-line typescript/only-throw-error
        throw updateTurnThrowsValue;
      }
      if (updateTurnThrows !== undefined) {
        throw new Error(updateTurnThrows);
      }
    },
    userGroupIds: async () => new Map<string, string>(),
    whoAmI: async () => ({}),
  };
}
