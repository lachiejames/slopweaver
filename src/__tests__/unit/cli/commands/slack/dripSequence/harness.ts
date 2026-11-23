/*
 * What the drip-sequence test files share: the reservation window, the throwaway homes each case sends into
 * (removed after every case by the `afterEach` that `useFreshHomes()` registers), a plan whose per-message keys are
 * stated outright, a recording send seam, and the injected send deps with a ticking clock and a pass-through pacer.
 * It moved here when `dripSequence.test.ts` was split by behaviour.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import type { SlackDripPlan } from "../../../../../../cli/commands/slack/dripCore.js";
import type { DripSendDeps } from "../../../../../../cli/commands/slack/dripRun.js";
import type { SlackWriteApi } from "../../../../../../corpus/slack/writeApi.js";
import type { SlackUpload } from "../../../../../../corpus/slack/writeTransport.js";
import type { DripShape, SlackDripMessagePayload } from "../../../../../../outbound/slack/types.js";

export const WINDOW = 24;

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

/** Register the `afterEach` that removes every home minted since the last case. Call it once per test file. */
export function useFreshHomes(): void {
  afterEach(() => {
    for (const dir of fixtureDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });
}

/**
 * A throwaway home the registered cleanup removes.
 *
 * @returns the new directory's path, recorded for the registered cleanup
 */
export function freshHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "pr51-drip-"));
  fixtureDirs.push(dir);
  return dir;
}

/** A payload whose only distinguishing feature is its text — enough to key on. */
function payload({ text }: { text: string }): SlackDripMessagePayload {
  return { form: "plain", text, unfurl_links: true, unfurl_media: true };
}

/**
 * A plan whose per-message keys are stated outright, so a test can pre-seed a reservation exactly.
 *
 * @returns a drip plan keyed `key-<text>` per message, its media on the last message only
 */
export function plan({
  texts,
  shape = "top-level",
  threadTs,
  media = [],
}: {
  texts: readonly string[];
  shape?: DripShape;
  threadTs?: string;
  media?: readonly string[];
}): SlackDripPlan {
  const lastIndex = texts.length - 1;
  return {
    actor: "me",
    artifact: { kind: "drip", messages: texts.map((text) => ({ runs: [{ text, type: "text" as const }] })) },
    channel: "C1",
    duplicateKey: "seq-key",
    intervalMs: 0,
    media,
    messages: texts.map((text, index) => ({
      duplicateKey: `key-${text}`,
      index,
      media: index === lastIndex ? media : [],
      payload: payload({ text }),
    })),
    shape,
    ...(threadTs !== undefined ? { threadTs } : {}),
  };
}

/**
 * A recording send seam. `failOn` makes exactly one message throw, which is the interesting case.
 *
 * @returns the write api and the list of drip sends it recorded, in call order
 */
export function recorder({ failOn }: { failOn?: string } = {}): {
  readonly calls: { text: string; threadTs: string | undefined; filenames: readonly string[] }[];
  readonly api: SlackWriteApi;
} {
  const calls: { text: string; threadTs: string | undefined; filenames: readonly string[] }[] = [];
  let counter = 0;
  return {
    api: {
      sendComposite: async () => {
        throw new Error("the card lane is not under test here");
      },
      deleteOwnMessage: async () => true,
      readOwnMessage: async () => undefined,
      sendNoFold: async () => {
        throw new Error("sendNoFold is not part of the drip lane");
      },
      sendDripMessage: async ({ channel, payload: sent, threadTs, uploads }) => {
        calls.push({ filenames: uploads.map((upload) => upload.filename), text: sent.text, threadTs });
        if (sent.text === failOn) {
          throw new Error("slack said no");
        }
        counter += 1;
        return {
          channel,
          fileIds: uploads.map((upload) => `F-${upload.filename}`),
          ts: `170000000${String(counter)}.000100`,
        };
      },
    },
    calls,
  };
}

/**
 * The drip's injected send deps: a clock that ticks one second per read, and a pacer that runs each task at once.
 *
 * @returns the send deps over this home and api, with no uploads and an empty read-back unless given
 */
export function deps({
  home,
  api,
  uploads = new Map(),
  readBack = async () => undefined,
}: {
  home: string;
  api: SlackWriteApi;
  uploads?: ReadonlyMap<string, SlackUpload>;
  readBack?: DripSendDeps["readBack"];
}): DripSendDeps {
  let tick = 0;
  return {
    api,
    home,
    nowIso: () => {
      tick += 1;
      return `2026-07-26T10:00:${String(tick).padStart(2, "0")}.000Z`;
    },
    pace: async (task) => task(),
    readBack,
    uploads,
  };
}
