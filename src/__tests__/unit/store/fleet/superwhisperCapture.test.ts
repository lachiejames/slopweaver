/**
 * One Superwhisper `meta.json` into the `owner_capture` row it becomes: the final text verbatim, the instant the owner said
 * it checked against its folder, and a named refusal for anything that cannot be trusted.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { projectSuperwhisperCapture } from "../../../../store/fleet/superwhisperCapture.js";

/** A fixed instant as Superwhisper names the folder. */
const FOLDER = String(Date.UTC(2026, 5, 3, 2, 6, 31) / 1000);

/** A `meta.json`'s bytes, with the fields a case does not care about defaulted. */
function meta(over: Record<string, unknown> = {}): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      datetime: "2026-06-03T02:06:31",
      duration: 4210,
      promptContext: { applicationContext: { name: "cmux" } },
      rawResult: "um merge it",
      result: "Merge it.",
      ...over,
    }),
    "utf8",
  );
}

describe("projectSuperwhisperCapture", () => {
  it("stores the final result, never the raw transcript, with the instant, the app and the length", () => {
    const projected = unwrap(projectSuperwhisperCapture({ bytes: meta(), folderName: FOLDER, path: "/r/meta.json" }));

    expect(projected).toEqual({
      kind: "captured",
      row: {
        body: "Merge it.",
        bodySha256: createHash("sha256").update("Merge it.").digest("hex"),
        byteLength: 9,
        durationMs: 4210,
        saidAt: new Date("2026-06-03T02:06:31.000Z"),
        source: "superwhisper",
        sourceId: FOLDER,
        targetApplication: "cmux",
      },
    });
  });

  it("counts the UTF-8 bytes of a body, not its characters", () => {
    const projected = unwrap(
      projectSuperwhisperCapture({ bytes: meta({ result: "café — ok" }), folderName: FOLDER, path: "/r" }),
    );

    expect(projected).toEqual(expect.objectContaining({ row: expect.objectContaining({ byteLength: 12 }) }));
  });

  it("skips a recording with no speech as empty, rather than storing or refusing it", () => {
    expect(unwrap(projectSuperwhisperCapture({ bytes: meta({ result: "" }), folderName: FOLDER, path: "/r" }))).toEqual(
      {
        kind: "empty",
      },
    );
  });

  it("stores null for an app or a length the record does not carry", () => {
    const projected = unwrap(
      projectSuperwhisperCapture({
        bytes: meta({ duration: null, promptContext: { applicationContext: { name: "" } } }),
        folderName: FOLDER,
        path: "/r",
      }),
    );

    expect(projected).toEqual(
      expect.objectContaining({ row: expect.objectContaining({ durationMs: null, targetApplication: null }) }),
    );
  });

  it("refuses a length that is not a whole non-negative number of milliseconds, rather than storing null", () => {
    const refusedFor = ({ duration }: { duration: unknown }): string =>
      unwrapErr(projectSuperwhisperCapture({ bytes: meta({ duration }), folderName: FOLDER, path: "/r" })).message;

    expect([refusedFor({ duration: 1.5 }), refusedFor({ duration: -1 }), refusedFor({ duration: "4210" })]).toEqual(
      Array.from(
        { length: 3 },
        () =>
          "/r cannot be stored as the owner's captured words: its duration is not a whole non-negative number of milliseconds",
      ),
    );
  });

  it("refuses an escaped lone surrogate in the app name or the result, which UTF-8 would store as U+FFFD", () => {
    const badApp = meta({ promptContext: { applicationContext: { name: "\ud800" } } });
    const badResult = meta({ result: "\udfff" });

    expect(
      unwrapErr(projectSuperwhisperCapture({ bytes: badApp, folderName: FOLDER, path: "/r/meta.json" })).message,
    ).toBe(
      "/r/meta.json cannot be stored as the owner's captured words: its application name contains a lone surrogate, which has no UTF-8 encoding",
    );
    expect(
      unwrapErr(projectSuperwhisperCapture({ bytes: badResult, folderName: FOLDER, path: "/r/meta.json" })).message,
    ).toBe(
      "/r/meta.json cannot be stored as the owner's captured words: its text contains a lone surrogate, which has no UTF-8 encoding",
    );
  });

  it("refuses a NUL in the app name by the record's own name, before any write could fail on it", () => {
    const nulApp = meta({ promptContext: { applicationContext: { name: "\u0000" } } });

    expect(
      unwrapErr(projectSuperwhisperCapture({ bytes: nulApp, folderName: FOLDER, path: "/r/meta.json" })).message,
    ).toBe(
      "/r/meta.json cannot be stored as the owner's captured words: its application name contains a NUL, which a Postgres text column cannot hold",
    );
  });

  it("refuses a datetime that disagrees with its folder, naming both", () => {
    const refused = unwrapErr(
      projectSuperwhisperCapture({ bytes: meta({ datetime: "2026-06-03T02:06:32" }), folderName: FOLDER, path: "/r" }),
    );

    expect(refused.code).toBe("UNSTORABLE_OWNER_CAPTURE");
    expect(refused.message).toContain(`disagrees with its folder ${FOLDER}`);
  });

  it("refuses a datetime carrying a zone, which is not the shape Superwhisper writes", () => {
    const refused = unwrapErr(
      projectSuperwhisperCapture({ bytes: meta({ datetime: "2026-06-03T02:06:31Z" }), folderName: FOLDER, path: "/r" }),
    );

    expect(refused.message).toContain("its datetime is not YYYY-MM-DDTHH:MM:SS");
  });

  it("refuses a folder that is not epoch seconds", () => {
    const refused = unwrapErr(projectSuperwhisperCapture({ bytes: meta(), folderName: "draft", path: "/r" }));

    expect(refused.message).toContain("disagrees with its folder draft");
  });

  it("refuses a record with no result field, bytes that are not UTF-8, and a body carrying a NUL", () => {
    expect(
      unwrapErr(projectSuperwhisperCapture({ bytes: meta({ result: 3 }), folderName: FOLDER, path: "/r" })).message,
    ).toContain("it carries no result text");
    expect(
      unwrapErr(projectSuperwhisperCapture({ bytes: Uint8Array.of(0xff, 0xfe), folderName: FOLDER, path: "/r" }))
        .message,
    ).toContain("its bytes are not UTF-8");
    expect(
      unwrapErr(projectSuperwhisperCapture({ bytes: meta({ result: "a\u0000b" }), folderName: FOLDER, path: "/r" }))
        .message,
    ).toContain("contains a NUL");
  });
});
