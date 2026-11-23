/*
 * Fixtures for releasing a parked as-me draft: the one-card form, the parked row over its posted bytes, the register
 * lines, the release argv, and the homes that hold a picture or a video for the row to verify.
 */
import { expect } from "vitest";
import { storeSlackDraftMedia } from "../../../../../../admit/slackDraftMediaStore.js";
import { runSlackWrite } from "../../../../../../cli/commands/slack/run.js";
import { EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { unwrap } from "../../../../../../lib/result.js";
import {
  type ParkedPriorAsk,
  type ParkedSlackDraft,
  type ParkedSlackDraftMedia,
  parkedDraftDigest,
  type SlackDraftEvent,
  slackDraftEventLine,
} from "../../../../../../outbound/slack/draftRegister.js";
import type { SlackDripMessagePayload } from "../../../../../../outbound/slack/types.js";
import { storeAnnotatedShot } from "../../../../../annotatedShotFixture.js";
import { argv, freshHome, harness, RELEASE_SELF } from "./harness.js";

/**
 * A one-message form, the only shape a parked draft can be. It carries a visible link, because a top-level draft
 * released into a channel is a first message there and owes one (with a picture: `homeWithShot`).
 */
export const ONE_CARD = JSON.stringify({
  kind: "one-card",
  lines: [
    {
      runs: [
        { text: "Four groups, one question.", type: "text" },
        { label: "the pool", type: "link", url: "https://fixture.example/pool" },
      ],
    },
  ],
});

/**
 * What the ordinary lane would post for `form`, captured by posting it — so a row binds the real bytes.
 *
 * @returns the first payload the capture sent.
 */
export async function postedPayload({
  form,
  hatchIds = [],
  channel = "C1",
}: {
  form: string;
  /** Journalled hatches the capture holds a live grant for, when the form needs one to post at all. */
  hatchIds?: readonly string[];
  /** Where the capture posts; the owner's bot DM captures bytes no teammate-facing send would let out. */
  channel?: string;
}): Promise<SlackDripMessagePayload> {
  const home = freshHome();
  const probe = harness({ grants: { hatchIds, home }, stdin: form });
  expect(await runSlackWrite({ argv: argv({ channel, home }), deps: probe.deps, verb: "post" })).toBe(EXIT_OK);
  return probe.sends[0]!.payload;
}

/**
 * A parked row over `payload`, its digest computed exactly as the recorder computes it.
 *
 * @returns the parked draft row.
 */
export function parkedRow({
  form,
  payload,
  channel = "C1",
  id = "sd-1a2b3c4d",
  media = [],
  priorAsk,
}: {
  form: string;
  payload: SlackDripMessagePayload;
  /** Where the row lands; a direct-message id owes no first-message proof, and a row with proof owes no comparison. */
  channel?: string;
  id?: string;
  /** Stored attachments; empty adds no field, exactly as the recorder writes a text-only row. */
  media?: readonly ParkedSlackDraftMedia[];
  /** The asked-before declaration the recorder kept; absent adds no field. */
  priorAsk?: ParkedPriorAsk;
}): ParkedSlackDraft {
  const content = {
    authorId: RELEASE_SELF,
    channel,
    mentions: [],
    payload,
    ...(media.length > 0 ? { media } : {}),
    ...(priorAsk === undefined ? {} : { priorAsk }),
  };
  return {
    ...content,
    advisory: [],
    digest: parkedDraftDigest({ draft: content }),
    form,
    id,
    kind: "message",
    shape: "top-level",
    tsIso: "2026-09-23T12:00:00.000Z",
    why: "the release under test",
  };
}

/**
 * The register holding one parked row, plus any later events.
 *
 * @returns the register's lines.
 */
export function logOf({
  row,
  later = [],
}: {
  row: ParkedSlackDraft;
  later?: readonly SlackDraftEvent[];
}): readonly string[] {
  return [{ draft: row, id: row.id, kind: "parked" as const, tsIso: row.tsIso }, ...later].map((event) =>
    slackDraftEventLine({ event }),
  );
}

/**
 * The argv of releasing a parked draft by its approved digest.
 *
 * @returns the argv for `runSlackWrite`.
 */
export function releaseArgv({
  home,
  id,
  approve,
  extra = [],
}: {
  home: string;
  id: string;
  approve: string;
  extra?: readonly string[];
}): readonly string[] {
  return ["--as", "me", "--draft", id, "--approve", approve, "--home", home, ...extra];
}

/** A tiny stand-in for a video's bytes — the store and the release judge bytes, never a container. */
export const CLIP = Buffer.from("ftyp-shaped enough for a release, which never parses it");

/**
 * A home holding an annotated, unobstructed screenshot and the row entry for it — the proof a first message in a
 * channel owes at release — so a row parked over `media` and released with `--home home` clears that gate.
 *
 * @returns the home and the row's media entries.
 */
export function homeWithShot(): { home: string; media: readonly ParkedSlackDraftMedia[] } {
  const home = freshHome();
  return { home, media: [storeAnnotatedShot({ home })] };
}

/**
 * A home holding CLIP in the draft-media store beside the first-message screenshot, and the row entries the recorder
 * would have written for them: the clip first, the screenshot after it.
 *
 * @returns the home and the row's media entries.
 */
export function homeWithClip(): { home: string; media: readonly ParkedSlackDraftMedia[] } {
  const { home, media: shot } = homeWithShot();
  const clip = unwrap(storeSlackDraftMedia({ home, uploads: [{ bytes: CLIP, filename: "walkthrough.mp4" }] }));
  return { home, media: [...clip, ...shot] };
}
