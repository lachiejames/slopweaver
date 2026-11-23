/*
 * The acting seams of the as-me drip shell harness: the fake write api, the input and output channels, and the
 * release lane's register, re-read and join. Each builder records into the one `HarnessRecord` `harness()` made.
 */
import { readSlackDraftMedia } from "../../../../../../admit/slackDraftMediaStore.js";
import type { SlackWriteDeps } from "../../../../../../cli/commands/slack/run.js";
import type { SlackWriteApi } from "../../../../../../corpus/slack/writeApi.js";
import { ok } from "../../../../../../lib/result.js";
import type { HarnessRecord, ResolvedHarnessOptions } from "./harnessTypes.js";

/**
 * The fake write api: records every drip send, then fails, refuses or answers a fresh timestamp.
 *
 * @returns the api `makeApi` hands the run.
 */
function fakeWriteApi({ options, record }: { options: ResolvedHarnessOptions; record: HarnessRecord }): SlackWriteApi {
  const { failOn, refuseOn } = options;
  let counter = 0;
  return {
    sendComposite: async () => {
      throw new Error("the card lane is not under test here");
    },
    deleteOwnMessage: async () => true,
    readOwnMessage: async () => undefined,
    sendNoFold: async () => {
      throw new Error("sendNoFold is not part of the drip lane");
    },
    sendDripMessage: async ({ channel, payload, threadTs, uploads }) => {
      record.sends.push({ filenames: uploads.map((upload) => upload.filename), payload, threadTs });
      record.uploaded.push(uploads);
      if (payload.text === failOn) {
        throw new Error("slack said no");
      }
      if (payload.text === refuseOn) {
        throw Object.assign(new Error("An API error occurred: channel_not_found"), {
          code: "slack_webapi_platform_error",
          data: { error: "channel_not_found", ok: false },
        });
      }
      counter += 1;
      return {
        channel,
        fileIds: uploads.map((upload) => `F-${upload.filename}`),
        ts: `170000000${String(counter)}.000100`,
      };
    },
  };
}

/**
 * The seams a run reads and writes through: the api, stdout, the media reader, stdin and the pain-point sink.
 *
 * @returns the input and output half of the fake deps.
 */
export function ioSeams({
  options,
  record,
}: {
  options: ResolvedHarnessOptions;
  record: HarnessRecord;
}): Pick<SlackWriteDeps, "makeApi" | "out" | "readMedia" | "readStdin" | "recordVoicePainPoints"> {
  const { stdin, unreadableMedia } = options;
  const api = fakeWriteApi({ options, record });
  return {
    makeApi: () => api,
    out: (line) => {
      record.out.push(line);
    },
    readMedia: async ({ path }) => {
      record.mediaReads.push(path);
      if (path === unreadableMedia) {
        throw new Error(`could not read the image at "${path}"`);
      }
      return { bytes: new Uint8Array([1]), filename: path };
    },
    readStdin: async () => stdin,
    recordVoicePainPoints: ({ findings }) => {
      record.painPoints.push([...findings]);
    },
  };
}

/**
 * The release lane's seams: the draft register, the re-read of where it lands, the earlier ask, and the join.
 *
 * @returns the release half of the fake deps.
 */
export function releaseSeams({
  options,
  record,
}: {
  options: ResolvedHarnessOptions;
  record: HarnessRecord;
}): Pick<
  SlackWriteDeps,
  | "appendDraftEvent"
  | "channelAccess"
  | "joinChannel"
  | "readDraftLog"
  | "readDraftMedia"
  | "readPriorAsk"
  | "readReleaseConversation"
> {
  const { channelAccess, draftLog, joinRefusal, priorRead, releaseConversation } = options;
  return {
    readDraftLog: () => draftLog,
    // The REAL store, over the fixture's own throwaway home: a release's verification is under test here.
    readDraftMedia: ({ home, media }) => readSlackDraftMedia({ home, media }),
    appendDraftEvent: ({ event }) => {
      record.draftEvents.push(event);
      return ok(true as const);
    },
    readReleaseConversation: async () => ok(releaseConversation),
    readPriorAsk: async () => priorRead,
    channelAccess: async () => channelAccess,
    joinChannel: async ({ channel, confirm }) => {
      if (!confirm()) {
        throw new Error("slack.conversations.join withdrawn before dispatch");
      }
      record.joins.push(channel);
      if (joinRefusal !== undefined) {
        throw Object.assign(new Error(`An API error occurred: ${joinRefusal}`), {
          code: "slack_webapi_platform_error",
          data: { error: joinRefusal, ok: false },
        });
      }
      return { alreadyMember: false, id: channel, name: channelAccess.name };
    },
  };
}
