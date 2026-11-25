/*
 * `profile words <anchor>` over a chair transcript and a call stretch: a chair's turn read only inside its tenure,
 * a turn with no promptSource refused as the list names it, a non-final stretch cut at its end by either read, and
 * the console's own relay line typed into a chair refused as the list leaves it out.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EXIT_ERROR, EXIT_OK } from "../../../../../../cli/exitCodes.js";
import { writeSupervisorPin } from "../../../../../../sessions/supervisorPinStore.js";
import { appendSupervisorLink } from "../../../../../../supervisor/chainStore.js";
import { CHAIR, claudeHome, home, OTHER_TURN, run, useWordsHomes } from "./harness.js";

useWordsHomes();

describe("profile words — one anchor", () => {
  it("prints a chair's turn inside its tenure and refuses one typed after another chair took the pin", () => {
    const inside = "2a3b4c5d-6e7f-4801-9a2b-3c4d5e6f7081";
    const after = "3b4c5d6e-7f80-4912-8b3c-4d5e6f708192";
    const typed = ({ uuid, at, text }: { uuid: string; at: string; text: string }): string =>
      JSON.stringify({
        cwd: "/repo",
        message: { content: [{ text, type: "text" }], role: "user" },
        promptSource: "typed",
        timestamp: at,
        type: "user",
        uuid,
      });
    writeFileSync(
      join(claudeHome, "projects", "-repo", `${CHAIR}.jsonl`),
      `${typed({ at: "2026-10-04T09:00:00.000Z", text: "hold the atlas", uuid: inside })}\n${typed({ at: "2026-10-04T11:00:00.000Z", text: "typed by somebody else", uuid: after })}\n`,
      "utf8",
    );
    const other = {
      session: { host: "claude-code" as const, id: OTHER_TURN },
      pinnedAtIso: "2026-10-04T10:00:00.000Z",
      workspaceId: "ws-2",
      workspaceRef: "w:2",
    };
    appendSupervisorLink({ home, link: { ...other, source: "pin" } });
    writeSupervisorPin({ home, record: other });

    expect(run({ rest: [`transcript:${CHAIR}#${inside}`] }).code).toBe(EXIT_OK);
    expect(run({ rest: [`transcript:${CHAIR}#${after}`] })).toEqual({
      code: EXIT_ERROR,
      lines: [
        `profile words: transcript:${CHAIR}#${after} was typed while that session did not hold the supervisor pin, ` +
          "so it is not read as the owner's — only a chair's turns inside its tenure are",
      ],
    });
  });

  // A user record with no promptSource is not proven the owner's, so the list names it and the read refuses it.
  it("names a chair turn with no promptSource as unread and refuses it by anchor, never listing it", () => {
    const uuid = "5e6f7081-92a3-4b4c-8d5e-6f708192a3b4";
    writeFileSync(
      join(claudeHome, "projects", "-repo", `${CHAIR}.jsonl`),
      `${JSON.stringify({
        cwd: "/repo",
        message: { content: [{ text: "ship the atlas", type: "text" }], role: "user" },
        timestamp: "2026-10-04T09:00:00.000Z",
        type: "user",
        uuid,
      })}\n`,
      "utf8",
    );

    const list = run({ rest: [] });
    const one = run({ rest: [`transcript:${CHAIR}#${uuid}`] });

    expect([list.code, list.lines.slice(1), one]).toEqual([
      EXIT_ERROR,
      [
        `  not read — supervisor: 1 turn(s) carry no promptSource saying the owner typed or queued them, so none is read as theirs (first: transcript:${CHAIR}#${uuid})`,
      ],
      {
        code: EXIT_ERROR,
        lines: [
          `profile words: transcript:${CHAIR}#${uuid} carries no promptSource saying the owner typed or queued it, so it is not read as the owner's words`,
        ],
      },
    ]);
  });

  // A segment the call never finalised may still have been growing, so both reads say its end is cut.
  it("marks a short non-final call stretch cut at its end in the list and by anchor alike", () => {
    const call = "5d6e7f80-9102-4a3b-8c4d-5e6f70819203";
    mkdirSync(join(home, "talk", "calls"), { recursive: true });
    writeFileSync(
      join(home, "talk", "calls", `${call}.jsonl`),
      `${JSON.stringify({ atIso: "2026-10-04T08:00:00.000Z", final: false, id: "s-1", kind: "segment", text: "move it", who: "owner" })}\n`,
      "utf8",
    );

    const list = JSON.parse(run({ rest: ["--json"] }).lines.join("\n")) as { shown: readonly { cut: unknown }[] };
    const one = JSON.parse(run({ rest: [`talk-call:${call}#s-1`, "--json"] }).lines.join("\n")) as { cut: unknown };

    const endLost = { end: "lost", start: "kept" };
    expect([list.shown.map((shown) => shown.cut), one.cut]).toEqual([[endLost], endLost]);
  });

  it("refuses the console's relay line typed into a chair, as the list leaves it out", () => {
    const relayUuid = "1c2d3e4f-5061-4728-893a-4b5c6d7e8f90";
    writeFileSync(
      join(claudeHome, "projects", "-repo", `${CHAIR}.jsonl`),
      `${JSON.stringify({
        cwd: "/repo",
        message: {
          content: [{ text: "[voice relay talk-1] the owner asked for the atlas", type: "text" }],
          role: "user",
        },
        promptSource: "typed",
        timestamp: "2026-10-04T09:00:00.000Z",
        type: "user",
        uuid: relayUuid,
      })}\n`,
      "utf8",
    );

    const { code, lines } = run({ rest: [`transcript:${CHAIR}#${relayUuid}`] });

    expect(code).toBe(EXIT_ERROR);
    expect(lines).toEqual([
      `profile words: transcript:${CHAIR}#${relayUuid} is a line the console typed into the chair, not words the owner ` +
        "wrote — anchor on the relay itself (talk:<turn>) or the call words a wake points at " +
        "(talk-call:<call>#<segment>), which `slopweaver profile words` lists",
    ]);
  });
});
