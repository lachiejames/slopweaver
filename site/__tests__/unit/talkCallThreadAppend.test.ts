/*
 * The thread-journal append's argv: the desktop test instance's call carries `--console-instance e2e` beside the
 * server's own origin flags, never in place of one, and the owner's carries none — so the verb stamps only the walk's
 * entries as the test instance's.
 */
import { describe, expect, it } from "vitest";

import { callThreadAppendArgv } from "../../lib/talkCallThreadAppend";

const CALL = "a0000041-0000-4000-8000-000000000044";
const ORIGIN = ["--console-root", "/w/main", "--console-port", "3000", "--console-default-port", "3000"];

describe("callThreadAppendArgv", () => {
  it("passes the marker beside the server's origin flags for the test instance's call", () => {
    expect(callThreadAppendArgv({ callId: CALL, instance: "e2e", originArgv: ORIGIN })).toEqual([
      "talk",
      "call-thread-append",
      "--call",
      CALL,
      "--entries-file",
      "-",
      ...ORIGIN,
      "--console-instance",
      "e2e",
      "--json",
    ]);
  });

  it("passes no marker for the owner's call", () => {
    expect(callThreadAppendArgv({ callId: CALL, instance: undefined, originArgv: ORIGIN })).toEqual([
      "talk",
      "call-thread-append",
      "--call",
      CALL,
      "--entries-file",
      "-",
      ...ORIGIN,
      "--json",
    ]);
  });
});
