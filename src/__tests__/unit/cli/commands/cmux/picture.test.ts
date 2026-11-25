/**
 * {@link runCmuxPicture}'s argv edges and its two pure halves: the one handle and the flags it takes, the harness it
 * refuses, and what it makes of each answer the app's socket can give. The print is `cli/cmuxPictureOutput.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { cmuxUsage } from "../../../../../cli/commands/cmux/core.js";
import { answeredPictureOf, pictureAskOf, runCmuxPicture } from "../../../../../cli/commands/cmux/picture.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { cmuxManifest } from "../../../../../cli/manifests/cmux.js";
import { err, ok } from "../../../../../lib/result.js";
import type { AppSessionPicture } from "../../../../../sessionHarness/pictureWire.js";

const AT = "2026-11-11T02:00:00.000Z";

const PICTURE: AppSessionPicture = {
  facts: {
    countsByKind: {
      delegate: 0,
      delete: 0,
      edit: 0,
      execute: 0,
      fetch: 0,
      move: 0,
      other: 0,
      read: 0,
      search: 0,
      switch_mode: 0,
      think: 0,
    },
    droppedActivityEvents: 0,
    inFlight: [],
    lastCompleted: [],
  },
  readAtIso: AT,
  session: { handle: "app:0b5e", sessionId: "0b5e", state: "idle", title: "abc-1", vendor: "codex" },
};

describe("pictureAskOf", () => {
  it("asks for the one handle named, with the JSON flag it was given", () => {
    expect(pictureAskOf({ rest: ["app:0b5e", "--harness", "app", "--json"] })).toEqual({
      handle: "app:0b5e",
      json: true,
      kind: "ask",
    });
    expect(pictureAskOf({ rest: ["--harness", "app", "0b5e"] })).toEqual({ handle: "0b5e", json: false, kind: "ask" });
  });

  it("refuses the cmux harness, named or by default, because cmux hosts no worker to observe a tool call", () => {
    const refusal = {
      kind: "refused",
      lines: ["cmux picture: only --harness app has a worker that observes tool calls; cmux hosts none to read"],
    };
    expect(pictureAskOf({ rest: ["app:0b5e"] })).toEqual(refusal);
    expect(pictureAskOf({ rest: ["app:0b5e", "--harness", "cmux"] })).toEqual(refusal);
  });

  it("refuses no handle, or more than one, then prints its usage", () => {
    const refusal = {
      kind: "refused",
      lines: [
        "cmux picture: name exactly one app session handle",
        "usage: slopweaver cmux picture <handle> --harness <value> [--json]",
      ],
    };
    expect(pictureAskOf({ rest: ["--harness", "app"] })).toEqual(refusal);
    expect(pictureAskOf({ rest: ["app:0b5e", "app:1c6f", "--harness", "app"] })).toEqual(refusal);
  });

  it("refuses a flag the verb does not take", () => {
    expect(pictureAskOf({ rest: ["app:0b5e", "--harness", "app", "--home", "/tmp/acme"] })).toEqual({
      kind: "refused",
      lines: ["unknown flag: --home", "usage: slopweaver cmux picture <handle> --harness <value> [--json]"],
    });
  });
});

describe("answeredPictureOf", () => {
  it("carries the app's picture through", () => {
    expect(answeredPictureOf({ answered: ok({ kind: "picture", picture: PICTURE }) })).toEqual({
      kind: "picture",
      picture: PICTURE,
    });
  });

  it("names an app that predates picture reads apart from any other refusal", () => {
    expect(
      answeredPictureOf({ answered: err({ code: "BAD_REQUEST", kind: "refused", message: "unknown request kind" }) }),
    ).toEqual({
      kind: "failed",
      line: "cmux picture: this app predates picture reads; update the Slopweaver desktop app",
    });
    expect(
      answeredPictureOf({
        answered: err({ code: "SESSION_NOT_FOUND", kind: "refused", message: "no app session app:0b5e" }),
      }),
    ).toEqual({ kind: "failed", line: "cmux picture: no app session app:0b5e" });
  });

  it("refuses an answer of any other kind", () => {
    expect(answeredPictureOf({ answered: ok({ kind: "aborted" }) })).toEqual({
      kind: "failed",
      line: "cmux picture: the desktop app answered aborted, not picture",
    });
  });
});

describe("runCmuxPicture", () => {
  it("succeeds on --help without reaching the app, its usage line being the one the manifest prints", async () => {
    expect(await runCmuxPicture(["node", "slopweaver", "cmux", "picture", "--help"])).toBe(EXIT_OK);
    expect(cmuxUsage({ verb: "picture" })).toBe("usage: slopweaver cmux picture <handle> --harness <value> [--json]");
    expect(cmuxManifest["picture"]!.meta.usage).toBe(cmuxUsage({ verb: "picture" }));
  });

  it("refuses the cmux harness before it reaches the app", async () => {
    expect(await runCmuxPicture(["node", "slopweaver", "cmux", "picture", "app:0b5e", "--harness", "cmux"])).toBe(
      EXIT_USAGE,
    );
  });
});
