/**
 * Which window a message came from: the voice's window keeps its identity while a recovery has the console's origin
 * unset, and nothing else gains one.
 */
import { describe, expect, it } from "vitest";

import { roleForSenderPage } from "../../src/windowRole";

const origin = "http://localhost:3000";

describe("roleForSenderPage", () => {
  it("keeps the voice's window its role while a recovery has the console's origin unset", () => {
    const role = roleForSenderPage({
      candidate: "overlay",
      consoleOrigin: undefined,
      frameUrl: `${origin}/voice`,
      overlayOrigin: origin,
      topLevel: true,
    });
    expect(role).toBe("overlay");
  });

  it("gives a console tab no role while the console's origin is unset", () => {
    const role = roleForSenderPage({
      candidate: "main",
      consoleOrigin: undefined,
      frameUrl: `${origin}/queue`,
      overlayOrigin: origin,
      topLevel: true,
    });
    expect(role).toBeUndefined();
  });

  it("gives a console tab its role on the console's origin now", () => {
    const role = roleForSenderPage({
      candidate: "main",
      consoleOrigin: origin,
      frameUrl: `${origin}/queue`,
      overlayOrigin: undefined,
      topLevel: true,
    });
    expect(role).toBe("main");
  });

  it("refuses the voice's window on an origin other than the one its page was loaded from", () => {
    const role = roleForSenderPage({
      candidate: "overlay",
      consoleOrigin: "http://localhost:3001",
      frameUrl: "http://localhost:3001/voice",
      overlayOrigin: origin,
      topLevel: true,
    });
    expect(role).toBeUndefined();
  });

  it("refuses the voice's window once its loaded origin is forgotten", () => {
    const role = roleForSenderPage({
      candidate: "overlay",
      consoleOrigin: origin,
      frameUrl: `${origin}/voice`,
      overlayOrigin: undefined,
      topLevel: true,
    });
    expect(role).toBeUndefined();
  });

  it("refuses a frame inside the voice's page", () => {
    const role = roleForSenderPage({
      candidate: "overlay",
      consoleOrigin: origin,
      frameUrl: `${origin}/voice`,
      overlayOrigin: origin,
      topLevel: false,
    });
    expect(role).toBeUndefined();
  });

  it("refuses a sender that is none of the shell's windows", () => {
    const role = roleForSenderPage({
      candidate: undefined,
      consoleOrigin: origin,
      frameUrl: `${origin}/queue`,
      overlayOrigin: origin,
      topLevel: true,
    });
    expect(role).toBeUndefined();
  });

  it("refuses an address that does not parse", () => {
    const role = roleForSenderPage({
      candidate: "overlay",
      consoleOrigin: origin,
      frameUrl: "not a url",
      overlayOrigin: origin,
      topLevel: true,
    });
    expect(role).toBeUndefined();
  });
});
