/*
 * The `talk transcript` argv one batch becomes: the batch read from stdin, never a staged file; the server's own origin
 * flags always, and the desktop test instance's marker beside them — never in place of one — so a walk's call is
 * stamped as the walk's and never read as the owner's words.
 */
import { describe, expect, it } from "vitest";

import { transcriptArgv } from "../../lib/talkCallAppend";

const CALL = "a0000041-0000-4000-8000-000000000044";
const ORIGIN = ["--console-root", "/w/main", "--console-port", "3000", "--console-default-port", "3000"];
const HANDOFF = "/h/talk/card-landings.jsonl.intent.handoff.42.1";

describe("transcriptArgv", () => {
  it("passes the marker beside the server's origin flags when the test instance posted the batch", () => {
    expect(transcriptArgv({ callId: CALL, handoff: HANDOFF, instance: "e2e", originArgv: ORIGIN })).toEqual([
      "talk",
      "transcript",
      "--call",
      CALL,
      "--entries-file",
      "-",
      ...ORIGIN,
      "--console-instance",
      "e2e",
      "--handoff",
      HANDOFF,
      "--json",
    ]);
  });

  it("passes no marker for the owner's page's batch, and reads it from stdin", () => {
    expect(transcriptArgv({ callId: CALL, handoff: HANDOFF, instance: undefined, originArgv: ORIGIN })).toEqual([
      "talk",
      "transcript",
      "--call",
      CALL,
      "--entries-file",
      "-",
      ...ORIGIN,
      "--handoff",
      HANDOFF,
      "--json",
    ]);
  });
});
