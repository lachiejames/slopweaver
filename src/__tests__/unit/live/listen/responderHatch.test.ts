/*
 * `responderHatchOpenNow` — the listener's and every turn verb's one read of the responder break-glass, against a
 * REAL grant journal: open only where the home it is handed holds a live grant for this process's session.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { admitAddresser, responderHatchOpenNow } from "../../../../live/listen/responderHatch.js";
import type { ResponderWhitelist } from "../../../../live/listen/whitelist.js";
import { grantedEnv, withLiveGrant } from "../../../hatchGrantFixture.js";

describe("admitAddresser", () => {
  const LISTED: ResponderWhitelist = { identities: ["U0ACME1"], kind: "list" };

  const admit = ({ userId, open }: { userId: string; open: boolean }): { admitted: boolean; lines: string[] } => {
    const lines: string[] = [];
    const decision = admitAddresser({
      log: ({ line }) => {
        lines.push(line);
      },
      responderHatchOpen: () => open,
      responderWhitelist: () => LISTED,
      userId,
    });
    return { admitted: decision.admitted, lines };
  };

  it("admits an addresser off the list through an open grant, and says so on the operator log", () => {
    expect(admit({ open: true, userId: "U0ACME2" })).toEqual({
      admitted: true,
      lines: ["admitted U0ACME2, who is NOT on responders.json, through the journalled responder-allow-open grant"],
    });
  });

  it("admits a listed addresser silently, because the list and not the grant let them in", () => {
    expect(admit({ open: false, userId: "U0ACME1" })).toEqual({ admitted: true, lines: [] });
  });

  it("refuses an addresser off the list with the grant closed, logging nothing here", () => {
    expect(admit({ open: false, userId: "U0ACME2" })).toEqual({ admitted: false, lines: [] });
  });
});

describe("responderHatchOpenNow", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "responder-now-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("is open when the home it reads holds a live responder-allow-open grant for this session", () => {
    let open = false;
    withLiveGrant({
      hatchIds: [],
      run: () => {
        grantedEnv({ hatchIds: ["responder-allow-open"], home });
        open = responderHatchOpenNow({ home });
      },
    });

    expect(open).toBe(true);
  });

  it("is closed when that home holds a grant for a different row only", () => {
    let open = true;
    withLiveGrant({
      hatchIds: [],
      run: () => {
        grantedEnv({ hatchIds: ["wall"], home });
        open = responderHatchOpenNow({ home });
      },
    });

    expect(open).toBe(false);
  });

  it("reads the home it is handed, never the one the process names, so a grant elsewhere opens nothing", () => {
    let open = true;
    withLiveGrant({
      hatchIds: ["responder-allow-open"],
      run: () => {
        open = responderHatchOpenNow({ home });
      },
    });

    expect(open).toBe(false);
  });
});
