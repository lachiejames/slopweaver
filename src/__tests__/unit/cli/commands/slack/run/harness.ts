/*
 * The shared harness for the `--as bot` card-lane tests of `runSlackWrite`: the forms and chrome they post, the
 * recording write api, the argv builders, a Slack platform error, and the throwaway-home helpers every one of
 * those test files leans on. The full fake `SlackWriteDeps` is built in `deps.ts`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SlackWriteApi } from "../../../../../../corpus/slack/writeApi.js";
import type { SlackUpload } from "../../../../../../corpus/slack/writeTransport.js";
import type { SlackCardChrome, SlackCardPayload } from "../../../../../../outbound/slack/types.js";

/** The bot card chrome every fake world renders with. */
export const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#12B5A6",
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

/** The plain update card most cases post. */
export const FORM = JSON.stringify({
  detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }],
  kind: "update",
  tldr: "A short lead.",
});

/** An update card mentioning `ghost`, the one person the fake roster cannot resolve. */
export const MENTION_FORM = JSON.stringify({
  detail: [{ runs: [{ person: "ghost", type: "mention" }], type: "paragraph" }],
  kind: "update",
  tldr: "A short lead.",
});

/**
 * A recording fake — NOT a mock. It is a plain object that appends to an array, so a test can assert
 * that the effect never happened without any mocking framework.
 */
export interface Recorder {
  readonly sends: { channel: string; payload: SlackCardPayload; uploads: readonly SlackUpload[] }[];
  readonly api: SlackWriteApi;
}

/**
 * A write api that records every composite send, throwing `failWith` after recording when one is given.
 *
 * @param failWith what the composite send throws once it has recorded the attempt; absent, it succeeds.
 * @returns the api and the array of sends it recorded.
 */
export function recorder({ failWith }: { failWith?: Error } = {}): Recorder {
  const sends: { channel: string; payload: SlackCardPayload; uploads: readonly SlackUpload[] }[] = [];
  return {
    api: {
      sendComposite: async ({ channel, payload, uploads }) => {
        sends.push({ channel, payload, uploads });
        if (failWith !== undefined) {
          throw failWith;
        }
        return {
          channel,
          fileIds: uploads.map((_, i) => `F${String(i)}`),
          missingMedia: [],
          ok: true,
          ts: "1700000000.000100",
        };
      },
      deleteOwnMessage: async () => true,
      readOwnMessage: async () => undefined,
      sendDripMessage: async ({ channel }) => ({ channel, fileIds: [], ts: "1700000000.000900" }),
      sendNoFold: async ({ channel }) => ({
        channel,
        fileIds: [],
        missingMedia: [],
        ok: true,
        ts: "1700000000.000901",
      }),
    },
    sends,
  };
}

// Every fixture directory these tests have minted, so a test file's `afterEach` can remove them.
const fixtureDirs: string[] = [];

/**
 * Remove every fixture directory minted since the last call; each test file registers it with `afterEach`.
 *
 * @returns nothing.
 */
export function removeFixtureDirs(): void {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
}

/**
 * Mint a throwaway home that `removeFixtureDirs` will remove.
 *
 * @returns the new directory's path.
 */
export function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "pr5-run-"));
  fixtureDirs.push(dir);
  return dir;
}

/**
 * The argv for a top-level `--as bot` card to C1.
 *
 * @param extra flags appended after `--home`.
 * @param form the card JSON passed to `--form`.
 * @returns the verb's flag tail.
 */
export function argv({
  home,
  extra = [],
  form = FORM,
}: {
  home: string;
  extra?: readonly string[];
  form?: string;
}): string[] {
  return ["--as", "bot", "--channel", "C1", "--form", form, "--home", home, ...extra];
}

/**
 * The argv for an `--as bot` card replying in C1's thread `1699.0001`.
 *
 * @param extra flags appended after `--thread-ts`.
 * @returns the verb's flag tail.
 */
export function replyArgv({ home, extra = [] }: { home: string; extra?: readonly string[] }): string[] {
  return ["--as", "bot", "--channel", "C1", "--form", FORM, "--home", home, "--thread-ts", "1699.0001", ...extra];
}

/**
 * The shape the Slack SDK throws for an `ok: false` answer — the boundary refusal the reservation must not outlive.
 *
 * @param error the Slack error code the platform answered with.
 * @returns the error, carrying the SDK's code and data fields.
 */
export function platformError({ error }: { error: string }): Error {
  return Object.assign(new Error(`An API error occurred: ${error}`), {
    code: "slack_webapi_platform_error",
    data: { error, ok: false },
  });
}
