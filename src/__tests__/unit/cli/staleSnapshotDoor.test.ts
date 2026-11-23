import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OPEN_PAGES_LABEL, type StaleSnapshot, YOUR_LIST_LABEL } from "../../../briefing/snapshotAge.js";
import { staleSnapshotRefusal, staleSnapshotRefusalLines } from "../../../cli/staleSnapshotDoor.js";
import { appendHatchGrant } from "../../../hatch/grantStore.js";
import { CLAUDE_CODE_SESSION_ID_ENV } from "../../../supervisor/session.js";

/** The session a grant is issued to, and the instant every case below is judged at. */
const SESSION = "c0ffee00-1111-2222-3333-444455556666";
const NOW = "2026-09-21T15:26:00.000Z";

/** The variable this journalled row once opened on, which a refusal must never recommend and which opens nothing. */
const RETIRED_VARIABLE = "SLOPWEAVER_ALLOW_STALE_SNAPSHOT";

/** The environment naming the session the grants below are issued to. */
const SESSION_ENV = { [CLAUDE_CODE_SESSION_ID_ENV]: SESSION };

/** The incident's own verdict: the owner's list, fifteen hours and three minutes behind the render. */
const YOUR_LIST: StaleSnapshot = {
  ageMs: 54_180_000,
  flag: "--your-list",
  label: YOUR_LIST_LABEL,
  source: "run.json",
  takenIso: "2026-09-20T23:51:00.000Z",
};

/** The other half, a day cold, so a two-verdict refusal has a second subject to name. */
const OPEN_PAGES: StaleSnapshot = {
  ageMs: 86_400_000,
  flag: "--open-artifacts",
  label: OPEN_PAGES_LABEL,
  source: "open-pages.json",
  takenIso: "2026-09-20T14:54:00.000Z",
};

describe("staleSnapshotRefusalLines", () => {
  it("names the flag, the path, the instant and the age of one stale half", () => {
    const lines = staleSnapshotRefusalLines({ stale: [YOUR_LIST] });

    // The register's own `caught` prose opens the line; the detail this module builds is what closes it.
    expect(lines[0]!.startsWith("slopweaver briefing render blocked because a half the page is built on")).toBe(true);
    expect(
      lines[0]!.endsWith("(--your-list run.json was taken 2026-09-20T23:51:00.000Z — your list 15h 3m old)."),
    ).toBe(true);
  });

  it("names BOTH halves in one refusal, in the order the run judged them", () => {
    const lines = staleSnapshotRefusalLines({ stale: [YOUR_LIST, OPEN_PAGES] });

    expect(lines[0]).toContain("--your-list run.json was taken 2026-09-20T23:51:00.000Z — your list 15h 3m old;");
    expect(lines[0]).toContain(
      "--open-artifacts open-pages.json was taken 2026-09-20T14:54:00.000Z — open pages 24h 0m old)",
    );
  });

  it("offers the two legitimate exceptions the register declares", () => {
    const lines = staleSnapshotRefusalLines({ stale: [YOUR_LIST] });

    expect(lines[1]).toBe(
      "Legitimate exceptions may include you are re-rendering a historical page on purpose, and its age is " +
        "the point; the snapshot is a fixture with a frozen clock, so its instant is deliberately not now.",
    );
  });

  it("points at the journalled hatch rather than at the ambient variable", () => {
    const lines = staleSnapshotRefusalLines({ stale: [YOUR_LIST] });

    expect(lines[2]).toBe(
      "To override use the designated escape hatch slopweaver hatch open stale-snapshot " +
        '--reason "<why this one is a legitimate exception>", then re-run slopweaver briefing render.',
    );
    expect(lines.join("\n")).not.toContain(RETIRED_VARIABLE);
  });

  it("closes on the judgement line the renderer owns, never a blanket refusal", () => {
    const lines = staleSnapshotRefusalLines({ stale: [OPEN_PAGES] });

    expect(lines[3]).toBe(
      "Use good judgement to determine whether the owner would approve of this, then proceed or correct your approach.",
    );
    expect(lines.length).toBe(4);
  });
});

describe("staleSnapshotRefusal", () => {
  let home = "";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "stale-snapshot-"));
  });

  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("refuses a stale half when no grant is held and no variable is set", () => {
    const lines = staleSnapshotRefusal({ env: SESSION_ENV, home, nowIso: NOW, stale: [YOUR_LIST] });

    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("your list 15h 3m old");
  });

  it("says nothing at all when no half is stale", () => {
    expect(staleSnapshotRefusal({ env: {}, home, nowIso: NOW, stale: [] })).toEqual([]);
  });

  it("opens on the JOURNALLED grant the refusal's own third line tells the operator to take", () => {
    appendHatchGrant({
      grant: {
        claudeSessionId: SESSION,
        expiresAtIso: "2026-09-21T15:30:00.000Z",
        hatchId: "stale-snapshot",
        issuedAtIso: "2026-09-21T15:00:00.000Z",
        reason: "re-rendering the 20 Sep page on purpose",
      },
      home,
    });

    expect(staleSnapshotRefusal({ env: SESSION_ENV, home, nowIso: NOW, stale: [YOUR_LIST] })).toEqual([]);
  });

  it("refuses a grant issued to another session, because a grant is never transferable", () => {
    appendHatchGrant({
      grant: {
        claudeSessionId: SESSION,
        expiresAtIso: "2026-09-21T15:30:00.000Z",
        hatchId: "stale-snapshot",
        issuedAtIso: "2026-09-21T15:00:00.000Z",
        reason: "re-rendering the 20 Sep page on purpose",
      },
      home,
    });

    const otherSession = { [CLAUDE_CODE_SESSION_ID_ENV]: "d00d0000-1111-2222-3333-444455556666" };
    expect(staleSnapshotRefusal({ env: otherSession, home, nowIso: NOW, stale: [YOUR_LIST] }).length).toBe(4);
  });

  it("refuses again once that grant has expired, because a grant is spent by time", () => {
    appendHatchGrant({
      grant: {
        claudeSessionId: SESSION,
        expiresAtIso: "2026-09-21T14:30:00.000Z",
        hatchId: "stale-snapshot",
        issuedAtIso: "2026-09-21T14:00:00.000Z",
        reason: "re-rendering the 20 Sep page on purpose",
      },
      home,
    });

    expect(staleSnapshotRefusal({ env: SESSION_ENV, home, nowIso: NOW, stale: [YOUR_LIST] }).length).toBe(4);
  });

  it("refuses with the retired variable set and no grant held, because a variable leaves no journal row", () => {
    const env = { ...SESSION_ENV, [RETIRED_VARIABLE]: "1" };

    expect(staleSnapshotRefusal({ env, home, nowIso: NOW, stale: [YOUR_LIST] }).length).toBe(4);
  });
});
