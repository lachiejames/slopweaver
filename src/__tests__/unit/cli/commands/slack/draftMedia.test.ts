/**
 * The one step `slack draft record --media` adds, over plain functions: admit the WHOLE batch, then store
 * it, and say why nothing was parked when either refuses.
 *
 * The order is the property. A store call for a batch admission refused would leave bytes nobody approved
 * sitting in the private store; a row appended before the store answered would name a blob that may not
 * exist. `draftVerb/` drives the same step through the whole runner.
 *
 * Every Datadog host in this file reads the synthetic `ap1` site rather than the install's own.
 */
import { describe, expect, it } from "vitest";

import { admitAndStoreDraftMedia, type DraftMediaDeps } from "../../../../../cli/commands/slack/draftMedia.js";
import type { RecordingDestination } from "../../../../../cli/commands/slack/draftRecordProof.js";
import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import { SlackDraftErrors } from "../../../../../outbound/slack/draftErrors.js";
import type { SlackPlainMessagePayload } from "../../../../../outbound/slack/types.js";
import { ImageAdmissionErrors } from "../../../../../visualEvidence/errors.js";
import { imageDigestOf } from "../../../../../visualEvidence/imageIo.js";
import type { ImageRecord } from "../../../../../visualEvidence/types.js";
import { annotatedRecord, failedRecord } from "../../../../annotatedShotFixture.js";

/** Every call the step made, in order, with what it was handed. */
type Calls = string[];

/** A draft the card can draw as Slack will. */
const PLAIN: SlackPlainMessagePayload = {
  form: "plain",
  text: "the pool exhausted at 09:12",
  unfurl_links: true,
  unfurl_media: true,
};

/** A draft whose source is a number standing where a linked label belongs. */
const CITED: SlackPlainMessagePayload = { ...PLAIN, text: "the pool exhausted at 09:12 [2]" };

/** A form citing no Datadog page, so the screenshot floor asks nothing. */
const NO_CITATION = { messages: [{ runs: [{ text: "the pool exhausted at 09:12", type: "text" }] }] };

/** A form citing a Datadog logs view, which owes a picture. */
const DATADOG_CITED = {
  messages: [{ runs: [{ label: "the logs", type: "link", url: "https://ap1.datadoghq.com/logs" }] }],
};

/** The leading bytes the fake admission hands back for each extension a case names. */
const SIGNATURE_BY_EXTENSION: Readonly<Record<string, readonly number[]>> = {
  mp4: [0, 0, 0, 0x10, ...Buffer.from("ftypisom"), 0, 0, 0, 0],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  tif: [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00],
};

/** The bytes the fake admission reads at `path`: its extension's signature. */
function bytesAt({ path }: { path: string }): Buffer {
  return Buffer.from(SIGNATURE_BY_EXTENSION[path.split(".").at(-1)!]!);
}

/** Where a row lands that owes no first-message proof: a DM. */
const IN_A_DM: RecordingDestination = { channel: "D0DM", payload: PLAIN, shape: "top-level", threadTs: undefined };

/** A draft carrying the link a first message owes. */
const LINKED: SlackPlainMessagePayload = { ...PLAIN, text: "the pool exhausted <https://ap1.datadoghq.com/logs|logs>" };

/** The top level of a channel, where the first-message proof applies. */
const IN_A_CHANNEL: RecordingDestination = { ...IN_A_DM, channel: "C0ISO", payload: LINKED };

/** A world whose admission and store each answer as the case says, recording every call. */
function deps({
  calls,
  admission,
  records = [],
  storage,
}: {
  calls: Calls;
  admission?: ReturnType<typeof ImageAdmissionErrors.recordMissing>;
  /** The records admission resolves for each picture, built from its digest. */
  records?: readonly ((args: { digest: string }) => ImageRecord)[];
  storage?: ReturnType<typeof SlackDraftErrors.mediaWriteFailed>;
}): Parameters<typeof admitAndStoreDraftMedia>[0]["deps"] {
  const media: DraftMediaDeps = {
    prepareMedia: async ({ env, home, nowIso, paths }) => {
      calls.push(`prepare ${paths.join(",")} home=${home} now=${nowIso} env=${String(env["HATCH"])}`);
      if (admission !== undefined) {
        return err(admission);
      }
      const uploads = paths.map((path) => ({ bytes: bytesAt({ path }), filename: path.split("/").at(-1)! }));
      const evidence = uploads
        .filter((upload) => upload.filename.endsWith(".png"))
        .map((upload) => {
          const digest = imageDigestOf({ bytes: upload.bytes });
          return {
            artifact: { digest, heightPx: 2, widthPx: 2 },
            records: records.map((build) => build({ digest })),
            ref: { artifactDigest: digest, path: upload.filename },
          };
        });
      return ok({ evidence, exceptionOpened: false, uploads });
    },
    storeMedia: ({ home, uploads }) => {
      calls.push(`store ${uploads.map((upload) => upload.filename).join(",")} home=${home}`);
      if (storage !== undefined) {
        return err(storage);
      }
      return ok(
        uploads.map((upload) => ({ bytes: upload.bytes.length, name: upload.filename, sha256: "f".repeat(64) })),
      );
    },
  };
  return { ...media, doorEnv: () => ({ HATCH: "open" }), nowIso: () => "2026-09-27T12:00:00.000Z" };
}

describe("admitAndStoreDraftMedia", () => {
  it("calls neither edge for a draft with no --media, answering no entries", async () => {
    const calls: Calls = [];
    const stored = await admitAndStoreDraftMedia({
      artifact: NO_CITATION,
      deps: deps({ calls }),
      destination: IN_A_DM,
      options: { home: "/h", media: [] },
      payload: PLAIN,
    });
    expect(unwrap(stored)).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("admits the whole batch under the door's env and clock, then stores exactly what was admitted", async () => {
    const calls: Calls = [];
    const stored = await admitAndStoreDraftMedia({
      artifact: NO_CITATION,
      deps: deps({ calls }),
      destination: IN_A_DM,
      options: { home: "/h", media: ["/tmp/walkthrough.mp4", "/tmp/still.png"] },
      payload: PLAIN,
    });
    expect(calls).toEqual([
      "prepare /tmp/walkthrough.mp4,/tmp/still.png home=/h now=2026-09-27T12:00:00.000Z env=open",
      "store walkthrough.mp4,still.png home=/h",
    ]);
    expect(unwrap(stored)).toEqual([
      { bytes: 16, name: "walkthrough.mp4", sha256: "f".repeat(64) },
      { bytes: 8, name: "still.png", sha256: "f".repeat(64) },
    ]);
  });

  it("stores nothing for a batch admission refused, and names the recorder and what was not parked", async () => {
    const calls: Calls = [];
    const refused = await admitAndStoreDraftMedia({
      artifact: NO_CITATION,
      deps: deps({ admission: ImageAdmissionErrors.recordMissing({ digests: ["d".repeat(64)] }), calls }),
      destination: IN_A_DM,
      options: { home: "/h", media: ["/tmp/unread.png"] },
      payload: PLAIN,
    });
    const lines = unwrapErr(refused);
    expect(calls.map((call) => call.split(" ")[0])).toEqual(["prepare"]);
    expect(lines.join("\n")).toContain("slopweaver slack draft record");
    expect(lines.at(-1)).toBe("NOTHING was parked and nothing was sent.");
  });

  it("refuses when the store cannot keep the bytes, naming the path and what was not parked", async () => {
    const calls: Calls = [];
    const refused = await admitAndStoreDraftMedia({
      artifact: NO_CITATION,
      deps: deps({
        calls,
        storage: SlackDraftErrors.mediaWriteFailed({ cause: new Error("EACCES"), path: "/h/queue/blob" }),
      }),
      destination: IN_A_DM,
      options: { home: "/h", media: ["/tmp/walkthrough.mp4"] },
      payload: PLAIN,
    });
    expect(unwrapErr(refused)).toEqual([
      "the attachment could not be stored at /h/queue/blob, so nothing was parked: EACCES",
      "NOTHING was parked and nothing was sent.",
    ]);
  });

  it("refuses a bare citation number in a draft with no --media, calling neither edge", async () => {
    const calls: Calls = [];
    const refused = await admitAndStoreDraftMedia({
      artifact: NO_CITATION,
      deps: deps({ calls }),
      destination: IN_A_DM,
      options: { home: "/h", media: [] },
      payload: CITED,
    });
    const lines = unwrapErr(refused);
    expect(calls).toEqual([]);
    expect(lines[0]).toBe("slopweaver slack draft record: the queue card would not show this draft as Slack will —");
    expect(lines[1]).toContain('"[2]" is a bare citation marker');
    expect(lines.at(-1)).toBe("NOTHING was parked and nothing was sent.");
  });

  it("refuses an admitted TIFF before storing it, so no unapproved bytes are kept", async () => {
    const calls: Calls = [];
    const refused = await admitAndStoreDraftMedia({
      artifact: NO_CITATION,
      deps: deps({ calls }),
      destination: IN_A_DM,
      options: { home: "/h", media: ["/tmp/scan.tif"] },
      payload: PLAIN,
    });
    const lines = unwrapErr(refused);
    expect(calls.map((call) => call.split(" ")[0])).toEqual(["prepare"]);
    expect(lines[1]).toContain("is a TIFF, which the queue card cannot draw inline");
    expect(lines.at(-1)).toBe("NOTHING was parked and nothing was sent.");
  });

  it("refuses a draft citing Datadog with no --media, calling neither edge", async () => {
    const calls: Calls = [];
    const refused = await admitAndStoreDraftMedia({
      artifact: DATADOG_CITED,
      deps: deps({ calls }),
      destination: IN_A_DM,
      options: { home: "/h", media: [] },
      payload: PLAIN,
    });
    const lines = unwrapErr(refused);
    expect(calls).toEqual([]);
    expect(lines[0]).toContain("media: this message cites Datadog (https://ap1.datadoghq.com/logs)");
    expect(lines.at(-1)).toBe("NOTHING was parked and nothing was sent.");
  });

  it("refuses a draft citing Datadog whose only attachment is a video, storing nothing", async () => {
    const calls: Calls = [];
    const refused = await admitAndStoreDraftMedia({
      artifact: DATADOG_CITED,
      deps: deps({ calls }),
      destination: IN_A_DM,
      options: { home: "/h", media: ["/tmp/walkthrough.mp4"] },
      payload: PLAIN,
    });
    const lines = unwrapErr(refused);
    expect(calls.map((call) => call.split(" ")[0])).toEqual(["prepare"]);
    expect(lines[0]).toContain("attaches no picture");
    expect(lines.at(-1)).toBe("NOTHING was parked and nothing was sent.");
  });
});

describe("admitAndStoreDraftMedia — a first message in a channel", () => {
  it("stores a screenshot whose record vouches for its box and for nothing covering it", async () => {
    const calls: Calls = [];
    const stored = await admitAndStoreDraftMedia({
      artifact: NO_CITATION,
      deps: deps({ calls, records: [({ digest }) => annotatedRecord({ digest })] }),
      destination: IN_A_CHANNEL,
      options: { home: "/h", media: ["/tmp/control.png"] },
      payload: LINKED,
    });
    expect(unwrap(stored)).toEqual([{ bytes: 8, name: "control.png", sha256: "f".repeat(64) }]);
    expect(calls.map((call) => call.split(" ")[0])).toEqual(["prepare", "store"]);
  });

  it("refuses one with no --media before either edge, naming the screenshot it owes", async () => {
    const calls: Calls = [];
    const refused = await admitAndStoreDraftMedia({
      artifact: NO_CITATION,
      deps: deps({ calls }),
      destination: IN_A_CHANNEL,
      options: { home: "/h", media: [] },
      payload: LINKED,
    });
    const lines = unwrapErr(refused);
    expect(calls).toEqual([]);
    expect(lines[0]).toContain("this draft is a first message in a channel and is missing screenshot, annotation.");
    expect(lines.at(-1)).toBe("NOTHING was parked and nothing was sent.");
  });

  it("refuses a screenshot with no annotated record, and one a later look found obscured, storing neither", async () => {
    const unboxed = (args: { digest: string }): ImageRecord =>
      annotatedRecord({ digest: args.digest, over: { annotations: undefined } });
    const covered = (args: { digest: string }): ImageRecord =>
      failedRecord({ correction: "dismiss the banner and retake", digest: args.digest, reason: "obscured" });
    const firsts = await Promise.all(
      [[unboxed], [({ digest }: { digest: string }) => annotatedRecord({ digest }), covered]].map(async (records) => {
        const calls: Calls = [];
        const refused = await admitAndStoreDraftMedia({
          artifact: NO_CITATION,
          deps: deps({ calls, records }),
          destination: IN_A_CHANNEL,
          options: { home: "/h", media: ["/tmp/control.png"] },
          payload: LINKED,
        });
        return { calls: calls.map((call) => call.split(" ")[0]), first: unwrapErr(refused)[0] };
      }),
    );
    const missing = "this draft is a first message in a channel and is missing annotation.";
    expect(firsts.map((one) => one.calls)).toEqual([["prepare"], ["prepare"]]);
    expect(firsts.map((one) => one.first!.startsWith(missing))).toEqual([true, true]);
  });

  it("refuses a video alone as no screenshot at all", async () => {
    const refused = await admitAndStoreDraftMedia({
      artifact: NO_CITATION,
      deps: deps({ calls: [] }),
      destination: IN_A_CHANNEL,
      options: { home: "/h", media: ["/tmp/walkthrough.mp4"] },
      payload: LINKED,
    });
    expect(unwrapErr(refused)[0]).toContain("is missing screenshot, annotation.");
  });
});
