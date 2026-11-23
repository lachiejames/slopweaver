/**
 * Listener supervision's typed failures, built through their two factories: an invalid field that prints what
 * was found as JSON, a malformed file refused rather than read as unarmed, unreadable and unwritable files
 * that keep their io cause, and an arm refused beside a live one, explaining the Socket Mode load-balancing
 * that makes a second listener a silent half-outage.
 */
import { describe, expect, it } from "vitest";

import { ListenerArmErrors, ListenerStateErrors } from "../../../../../live/listen/supervise/errors.js";

describe("ListenerStateErrors", () => {
  it("invalid is LISTENER_STATE_INVALID, printing the found value as JSON", () => {
    expect(ListenerStateErrors.invalid({ field: "pid", found: { pid: "12" } })).toEqual({
      code: "LISTENER_STATE_INVALID",
      field: "pid",
      message: 'listener supervision state field "pid" is invalid: {"pid":"12"}',
    });
  });

  it("malformedJson is LISTENER_STATE_MALFORMED_JSON, refusing rather than treating the file as unarmed", () => {
    expect(ListenerStateErrors.malformedJson({ path: "/h/listen/arm.json" })).toEqual({
      code: "LISTENER_STATE_MALFORMED_JSON",
      message:
        "listener supervision state at /h/listen/arm.json is not parseable JSON; refusing rather than treating it as unarmed",
      path: "/h/listen/arm.json",
    });
  });

  it("unreadable is LISTENER_STATE_UNREADABLE, keeping the io cause", () => {
    const cause = new Error("EACCES");

    const error = ListenerStateErrors.unreadable({ cause, path: "/h/listen/arm.json" });

    expect(error).toEqual({
      cause,
      code: "LISTENER_STATE_UNREADABLE",
      message: "listener supervision state at /h/listen/arm.json could not be read",
      path: "/h/listen/arm.json",
    });
    expect(error.cause).toBe(cause);
  });

  it("writeFailed is LISTENER_STATE_WRITE_FAILED, keeping the io cause", () => {
    const cause = new Error("ENOSPC");

    const error = ListenerStateErrors.writeFailed({ cause, path: "/h/listen/arm.json" });

    expect(error).toEqual({
      cause,
      code: "LISTENER_STATE_WRITE_FAILED",
      message: "listener supervision state at /h/listen/arm.json could not be written",
      path: "/h/listen/arm.json",
    });
    expect(error.cause).toBe(cause);
  });
});

describe("ListenerArmErrors", () => {
  it("alreadyArmed is LISTENER_ALREADY_ARMED, naming the live arm and why a second one is refused", () => {
    expect(ListenerArmErrors.alreadyArmed({ armId: "arm-7", pid: 4242 })).toEqual({
      armId: "arm-7",
      code: "LISTENER_ALREADY_ARMED",
      message:
        "listener arm arm-7 is already live at pid 4242 — refusing to arm a second one; " +
        "Slack load-balances a tag across two Socket Mode connections and only one would answer",
      pid: 4242,
    });
  });
});
