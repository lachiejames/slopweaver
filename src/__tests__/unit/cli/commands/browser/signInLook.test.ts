/**
 * `browser sign-in`'s look through a named session refuses before any client command when the session is not one
 * it may look through: an id the store does not hold, or a tab opened on another provider. Both paths stop at the
 * record, so neither reaches a browser.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BrowserActionErrors } from "../../../../../browser/actionErrors.js";
import { readInteractionSession, writeInteractionSession } from "../../../../../browser/interactionSessionStore.js";
import { closeNamedSession, takeLook } from "../../../../../cli/commands/browser/signInLook.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const ID = "5f2a1c30-0000-4000-8000-0000000000e1";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "sign-in-look-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The instant every look here is taken at: one minute after the stored session's last touch, well inside expiry. */
const NOW_ISO = "2026-11-04T07:00:00.000Z";
const TOUCHED_ISO = "2026-11-04T06:59:00.000Z";

/**
 * A session opened on a page that is no provider's sign-in.
 *
 * @param touchedAtIso its last touch: a minute before {@link NOW_ISO} by default
 */
function storeForeignSession({ touchedAtIso = TOUCHED_ISO }: { touchedAtIso?: string } = {}): void {
  unwrap(
    writeInteractionSession({
      home,
      stored: {
        observation: null,
        session: {
          clientSession: "slopweaver-5f2a1c30",
          id: ID,
          openedAtIso: "2026-09-16T08:00:00.000Z",
          origins: ["https://example.com"],
          owner: { cmuxWorkspace: null, pid: 4242, runSlug: null },
          ownerSessionId: "agent-1",
          placement: "background",
          touchedAtIso,
          workspace: "/nowhere/client",
        },
      },
    }),
  );
}

describe("takeLook through a named session", () => {
  it("answers SESSION_LOST for an id the store does not hold", () => {
    const chrome = { home, pinPath: join(home, "pin"), workEmail: undefined };
    const look = takeLook({
      chrome,
      nowIso: NOW_ISO,
      provider: "github",
      sessionId: ID,
      url: "https://github.com/login",
    });
    expect(unwrapErr(look)).toEqual([BrowserActionErrors.sessionLost({ sessionId: ID }).message]);
  });

  it("refuses a session opened on another provider's page without touching it", () => {
    storeForeignSession();
    const chrome = { home, pinPath: join(home, "pin"), workEmail: undefined };
    const look = takeLook({
      chrome,
      nowIso: NOW_ISO,
      provider: "github",
      sessionId: ID,
      url: "https://github.com/login",
    });
    expect(unwrapErr(look)).toEqual([
      `session ${ID} was opened on https://example.com, not a github sign-in — ` +
        "pass the session `browser sign-in --provider github` printed",
    ]);
    // A claim would have moved this to NOW_ISO; the refused session keeps its own last touch, so its expiry stands.
    expect(readInteractionSession({ home, id: ID })!.session.touchedAtIso).toBe(TOUCHED_ISO);
  });
});

describe("closeNamedSession", () => {
  it("leaves a session that is not a GitHub sign-in's own tab, record and all", () => {
    // closeNamedSession judges liveness by the wall clock, so the touch sits where no clock reads it idle: only the
    // provider check can then be what keeps the record.
    storeForeignSession({ touchedAtIso: "2999-01-01T00:00:00.000Z" });
    closeNamedSession({ chrome: { home, pinPath: join(home, "pin"), workEmail: undefined }, sessionId: ID });
    expect(readInteractionSession({ home, id: ID })!.session.id).toBe(ID);
  });
});
