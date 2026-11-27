/**
 * The chain walk's coverage over the throwaway `~/.claude` in `./chainReadHarness.ts`: where a span stops, what a
 * chain that misses the floor says, and every chair it could not read named rather than dropped. The carried-report
 * cases are `./chainIntake.test.ts`.
 */
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../lib/result.js";
import { writeSupervisorPin } from "../../../sessions/supervisorPinStore.js";
import { CODEX_CHAIR_PEER_TRAFFIC_UNREAD } from "../../../supervisor/chain.js";
import { readSupervisorChain, readSupervisorChainEvents } from "../../../supervisor/chainStore.js";
import { CodexChairReadErrors } from "../../../supervisor/codexChairRead.js";
import { readSupervisorChainIntake } from "../../../supervisor/intakeRead.js";
import { buildSupervisorLink } from "../../../supervisor/supervisorLink.js";
import {
  CHAIN,
  claudeHome,
  cleanScratch,
  linkFor,
  NEW,
  NEW_ASK,
  NEW_PINNED,
  NO_DOCS,
  NOW,
  OLD,
  OLD_ASK,
  OLD_PINNED,
  read,
  stateHome,
  unwrapLink,
} from "./chainReadHarness.js";

afterEach(cleanScratch);

describe("readSupervisorChainIntake", () => {
  it("stops a span at the instant its successor took over, so a stale session claims no turn", () => {
    const claude = claudeHome();
    const home = stateHome({ links: CHAIN });

    const report = readSupervisorChainIntake({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    expect(read({ report }).turns.map((item) => item.turn.turnUuid)).toEqual([OLD_ASK, NEW_ASK]);
  });

  it("states that a chain starting after the floor did not reach it, rather than reading clean", () => {
    const claude = claudeHome();
    const home = stateHome({ links: [CHAIN[1]!] });

    const report = readSupervisorChainIntake({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    const finding = read({ report });

    expect(finding.coverage.reachesSince).toBe(false);
    expect(finding.coverage.walked).toEqual([NEW]);
  });

  it("names a link whose transcript is gone as unreadable rather than dropping its turns silently", () => {
    const claude = claudeHome();
    const home = stateHome({
      links: [...CHAIN, linkFor({ at: "2026-09-05T06:00:00.000Z", session: "ffffffff-ffff-4fff-8fff-ffffffffffff" })],
    });

    const report = readSupervisorChainIntake({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    expect(read({ report }).coverage.unreadable.map((gap) => gap.claudeSessionId)).toEqual([
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
    ]);
    // It still holds the pin, so nothing ends it: a card asked at any instant could have words in it.
    expect(read({ report }).coverage.unreadable[0]!.untilIso).toBeUndefined();
  });

  it("ends an unreadable chair at its successor's pin, so a card asked later knows it holds nothing after", () => {
    const claude = claudeHome();
    const gone = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const home = stateHome({
      links: [CHAIN[0]!, linkFor({ at: "2026-09-05T00:00:00.000Z", session: gone }), CHAIN[1]!],
    });

    const report = readSupervisorChainIntake({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    expect(
      read({ report }).coverage.unreadable.map(({ claudeSessionId, untilIso }) => ({ claudeSessionId, untilIso })),
    ).toStrictEqual([{ claudeSessionId: gone, untilIso: NEW_PINNED }]);
  });

  it("ends a chair that took the pin twice at its LATEST tenure, never its first successor's pin", () => {
    const claude = claudeHome();
    const gone = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const retook = "2026-09-05T04:00:00.000Z";
    const handedOn = "2026-09-05T06:00:00.000Z";
    const home = stateHome({
      links: [
        linkFor({ at: OLD_PINNED, session: gone }),
        CHAIN[1]!,
        linkFor({ at: retook, session: gone }),
        linkFor({ at: handedOn, session: OLD }),
      ],
    });

    // The production read passes the UNMERGED journal (`handover/intakeHalves.ts`), which is what holds the retake.
    const report = readSupervisorChainIntake({
      chain: readSupervisorChainEvents({ home }),
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    expect(
      read({ report }).coverage.unreadable.map(({ claudeSessionId, untilIso }) => ({ claudeSessionId, untilIso })),
    ).toStrictEqual([{ claudeSessionId: gone, untilIso: handedOn }]);
  });

  it("leaves a chair that took the pin twice and still holds it open, whatever its first successor's pin", () => {
    const claude = claudeHome();
    const gone = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const home = stateHome({
      links: [
        linkFor({ at: OLD_PINNED, session: gone }),
        CHAIN[1]!,
        linkFor({ at: "2026-09-05T04:00:00.000Z", session: gone }),
      ],
    });

    const report = readSupervisorChainIntake({
      chain: readSupervisorChainEvents({ home }),
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    expect(
      read({ report }).coverage.unreadable.map(({ claudeSessionId, untilIso }) => ({ claudeSessionId, untilIso })),
    ).toStrictEqual([{ claudeSessionId: gone, untilIso: undefined }]);
  });

  it("ends a chair the owner window dropped, whose late walk failed, at its successor's pin as well", () => {
    const claude = claudeHome();
    // OLD's transcript was written after the floor, so it is walked for late traffic, and invalid UTF-8 fails that pass.
    appendFileSync(join(claude, "projects", "-handoff-9068", `${OLD}.jsonl`), Buffer.from([0xff, 0xfe, 0x0a]));
    const home = stateHome({ links: CHAIN });

    const report = readSupervisorChainIntake({
      chain: readSupervisorChainEvents({ home }),
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sinceIso: "2026-09-05T04:00:00.000Z",
    });
    const finding = read({ report });

    expect(finding.coverage.walked).toStrictEqual([NEW]);
    expect(
      finding.coverage.unreadable.map(({ claudeSessionId, untilIso }) => ({ claudeSessionId, untilIso })),
    ).toStrictEqual([{ claudeSessionId: OLD, untilIso: NEW_PINNED }]);
  });

  it("reads a Codex chair's owner turns off the rollout its pin recorded, in every tenure, and discloses its peer traffic", () => {
    const claude = claudeHome();
    const codexHome = mkdtempSync(join(tmpdir(), "slopweaver-chain-codex-"));
    const thread = "a0000401-0000-4000-8000-000000000001";
    const day = join(codexHome, "sessions", "2026", "09", "05");
    mkdirSync(day, { recursive: true });
    const said = ({ at, text }: { at: string; text: string }): string =>
      JSON.stringify({ payload: { message: text, type: "user_message" }, timestamp: at, type: "event_msg" });
    writeFileSync(
      join(day, `rollout-2026-09-05T00-00-00-${thread}.jsonl`),
      `${[
        JSON.stringify({ payload: { id: thread }, timestamp: "2026-09-04T21:00:00.000Z", type: "session_meta" }),
        said({ at: "2026-09-04T23:00:00.000Z", text: "first tenure" }),
        said({ at: "2026-09-05T03:00:00.000Z", text: "while NEW held it" }),
        said({ at: "2026-09-05T07:00:00.000Z", text: "after it retook" }),
      ].join("\n")}\n`,
    );
    const codex = { host: "codex", id: thread } as const;
    const first = unwrap(
      buildSupervisorLink({
        codexHome,
        pinnedAtIso: OLD_PINNED,
        session: codex,
        source: "pin",
        target: { kind: "cmux", workspaceId: "W", workspaceRef: "workspace:1" },
      }),
    );
    const home = stateHome({ links: [first, linkFor({ at: NEW_PINNED, session: NEW })] });
    writeSupervisorPin({
      home,
      record: {
        codexHome,
        pinnedAtIso: "2026-09-05T06:00:00.000Z",
        session: codex,
        workspaceId: "W",
        workspaceRef: "workspace:1",
      },
    });

    try {
      const finding = read({
        report: readSupervisorChainIntake({
          chain: readSupervisorChain({ home }),
          claudeHome: claude,
          docs: NO_DOCS,
          home,
          marks: [],
          nowIso: NOW,
          sinceIso: "2026-09-04T00:00:00.000Z",
        }),
      });

      expect(
        finding.turns.filter((item) => item.turn.sessionId === `codex:${thread}`).map((item) => item.turn.text),
      ).toEqual(["first tenure", "after it retook"]);
      expect(finding.coverage.unreadable.filter((gap) => gap.claudeSessionId === `codex:${thread}`)).toStrictEqual([
        { claudeSessionId: `codex:${thread}`, untilIso: undefined, why: CODEX_CHAIR_PEER_TRAFFIC_UNREAD },
      ]);
    } finally {
      rmSync(codexHome, { force: true, recursive: true });
    }
  });

  it("names a Codex chair with no recorded home as unread, never dropping it at that chair's pin", () => {
    const claude = claudeHome();
    const codex = { host: "codex", id: "thread-1" } as const;
    const retook = "2026-09-05T06:00:00.000Z";
    const first = unwrapLink({ at: OLD_PINNED, session: codex });
    const home = stateHome({ links: [first, linkFor({ at: NEW_PINNED, session: NEW })] });
    writeSupervisorPin({
      home,
      record: { pinnedAtIso: retook, session: codex, workspaceId: "W", workspaceRef: "workspace:1" },
    });

    const report = readSupervisorChainIntake({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sinceIso: "2026-09-05T04:00:00.000Z",
    });
    const finding = read({ report });

    // Its first span ended at NEW's pin, but it retook the pin and holds it still: the latest tenure is open.
    expect(finding.coverage.unreadable).toStrictEqual([
      {
        claudeSessionId: "codex:thread-1",
        untilIso: undefined,
        why: `CODEX_HOME_UNRECORDED: ${CodexChairReadErrors.homeUnrecorded().message}`,
      },
    ]);
    expect(finding.coverage.walked).toStrictEqual([NEW]);
  });

  it("folds the live pin in, so a machine whose journal never caught it is no worse off", () => {
    const claude = claudeHome();
    const home = stateHome({ links: [] });
    writeSupervisorPin({
      home,
      record: {
        session: { host: "claude-code", id: NEW },
        pinnedAtIso: NEW_PINNED,
        workspaceId: "W",
        workspaceRef: "workspace:1",
      },
    });

    const report = readSupervisorChainIntake({
      chain: readSupervisorChain({ home }),
      claudeHome: claude,
      docs: NO_DOCS,
      home,
      marks: [],
      nowIso: NOW,
      sinceIso: "2026-08-28T00:00:00.000Z",
    });

    const finding = read({ report });

    expect(finding.legs.map((leg) => leg.sessionId)).toEqual([NEW]);
    expect(finding.coverage.reachesSince).toBe(false);
  });
});
