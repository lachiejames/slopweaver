/**
 * What became of one hand card, read off rows the register's own writers put on disk in a temp home.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { handCardFate } from "../../../hand/cardFate.js";
import { appendHandPost } from "../../../hand/multiAppend.js";
import { buildHandStep, type HandStep, type HandStepDraft } from "../../../hand/step.js";
import { appendHandRow, handRegisterPath, readHandRows } from "../../../hand/store.js";
import { unwrap } from "../../../lib/result.js";

const NOW = "2026-09-27T05:01:07.803Z";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "card-fate-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

function step(over: Partial<HandStepDraft> = {}): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "gcloud-signin",
        postedBy: "workspace:129",
        postedIso: "2026-09-27T04:35:44.113Z",
        unblocks: "handover run datadog-monitor-deploy",
        url: "https://console.cloud.google.com/",
        what: "Sign in to Google Cloud so the monitor deploy can finish",
        witness: "slopweaver hand done gcloud-signin",
        ...over,
      },
    }),
  );
}

const fate = ({ id }: { id: string }) =>
  handCardFate({ id, rows: unwrap(readHandRows({ missing: "empty", path: handRegisterPath({ home }) })).rows });

describe("handCardFate", () => {
  it("reads a card nobody posted as absent, and a posted one as open", async () => {
    expect(fate({ id: "gcloud-signin" })).toEqual({ kind: "absent" });
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    expect(fate({ id: "gcloud-signin" })).toEqual({ kind: "open" });
  });

  it("reads a settled card with every account it was settled with", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step() } }));
    unwrap(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { bySession: "workspace:129", did: "signed in", id: "gcloud-signin", kind: "settled", settledIso: NOW },
      }),
    );
    expect(fate({ id: "gcloud-signin" })).toEqual({ dids: ["signed in"], kind: "settled" });
  });

  it("reads a re-cut card as superseded by the posting whose own line settled it, not by its did's words", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts" }) } }));
    unwrap(await appendHandPost({ home, nowIso: NOW, step: step({ id: "iso-reply" }), supersedes: "iso-drafts" }));
    expect(fate({ id: "iso-drafts" })).toEqual({ kind: "superseded", successors: ["iso-reply"] });
    expect(fate({ id: "iso-reply" })).toEqual({ kind: "open" });
  });

  it("does not read a done whose account merely SAYS superseded as a re-cut", async () => {
    unwrap(await appendHandRow({ home, nowIso: NOW, row: { kind: "posted", step: step({ id: "iso-drafts" }) } }));
    unwrap(
      await appendHandRow({
        home,
        nowIso: NOW,
        row: { bySession: "s", did: "superseded by iso-reply", id: "iso-drafts", kind: "settled", settledIso: NOW },
      }),
    );
    expect(fate({ id: "iso-drafts" })).toEqual({ dids: ["superseded by iso-reply"], kind: "settled" });
  });
});
