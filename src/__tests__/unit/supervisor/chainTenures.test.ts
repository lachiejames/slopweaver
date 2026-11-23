import { describe, expect, it } from "vitest";

import { chairTenures, type SupervisorLink } from "../../../supervisor/chain.js";

const A = "a0000013-0000-4000-8000-000000000014";
const B = "b3f532df-83e5-495b-b5b8-8b8c3e54d512";

/** Tenures are keyed by `linkKey`: host AND id. */
const KEY_A = `claude-code:${A}`;
const KEY_B = `claude-code:${B}`;

const link = ({
  session,
  at,
  host = "claude-code",
}: {
  session: string;
  at: string;
  host?: "claude-code" | "codex";
}): SupervisorLink => ({
  pinnedAtIso: at,
  session: { host, id: session },
  source: "pin",
  workspaceId: "W",
  workspaceRef: "workspace:1",
});

describe("chairTenures", () => {
  it("keys a Codex thread apart from a Claude session sharing its id, so each pin closes the other's tenure", () => {
    const tenures = chairTenures({
      links: [
        link({ at: "2026-09-12T01:00:00.000Z", session: A }),
        link({ at: "2026-09-12T02:00:00.000Z", host: "codex", session: A }),
      ],
    });

    expect(tenures.get(KEY_A)).toEqual([{ fromIso: "2026-09-12T01:00:00.000Z", untilIso: "2026-09-12T02:00:00.000Z" }]);
    expect(tenures.get(`codex:${A}`)).toEqual([{ fromIso: "2026-09-12T02:00:00.000Z", untilIso: undefined }]);
  });

  it("gives a session that took the pin back two tenures, the second still open", () => {
    const tenures = chairTenures({
      links: [
        link({ at: "2026-09-12T03:00:00.000Z", session: A }),
        link({ at: "2026-09-12T01:00:00.000Z", session: A }),
        link({ at: "2026-09-12T02:00:00.000Z", session: B }),
      ],
    });

    expect(tenures.get(KEY_A)).toEqual([
      { fromIso: "2026-09-12T01:00:00.000Z", untilIso: "2026-09-12T02:00:00.000Z" },
      { fromIso: "2026-09-12T03:00:00.000Z", untilIso: undefined },
    ]);
    expect(tenures.get(KEY_B)).toEqual([{ fromIso: "2026-09-12T02:00:00.000Z", untilIso: "2026-09-12T03:00:00.000Z" }]);
  });

  it("folds a second pin by the session already holding it into one tenure", () => {
    const tenures = chairTenures({
      links: [
        link({ at: "2026-09-12T01:00:00.000Z", session: A }),
        link({ at: "2026-09-12T01:30:00.000Z", session: A }),
        link({ at: "2026-09-12T02:00:00.000Z", session: B }),
      ],
    });

    expect(tenures.get(KEY_A)).toEqual([{ fromIso: "2026-09-12T01:00:00.000Z", untilIso: "2026-09-12T02:00:00.000Z" }]);
  });

  it("reads a session that has a pin link from its pins alone, ignoring its own earlier scan", () => {
    const scanned: SupervisorLink = { ...link({ at: "2026-09-12T02:00:00.000Z", session: B }), source: "scan" };

    const tenures = chairTenures({
      links: [
        link({ at: "2026-09-12T01:00:00.000Z", session: A }),
        scanned,
        link({ at: "2026-09-12T03:00:00.000Z", session: B }),
      ],
    });

    expect(tenures.get(KEY_B)).toEqual([{ fromIso: "2026-09-12T03:00:00.000Z", untilIso: undefined }]);
  });

  it("gives a session with ONLY scan links one tenure that never closes, even when another session pins later", () => {
    const scanned: SupervisorLink = { ...link({ at: "2026-09-12T01:00:00.000Z", session: A }), source: "scan" };

    const tenures = chairTenures({ links: [scanned, link({ at: "2026-09-12T02:00:00.000Z", session: B })] });

    expect(tenures.get(KEY_A)).toEqual([{ fromIso: "2026-09-12T01:00:00.000Z", untilIso: undefined }]);
    expect(tenures.get(KEY_B)).toEqual([{ fromIso: "2026-09-12T02:00:00.000Z", untilIso: undefined }]);
  });

  it("does not let a scan link close a tenure, since its instant is a skill call rather than a pin", () => {
    const scanned: SupervisorLink = { ...link({ at: "2026-09-12T02:00:00.000Z", session: B }), source: "scan" };

    const tenures = chairTenures({
      links: [
        link({ at: "2026-09-12T01:00:00.000Z", session: A }),
        scanned,
        link({ at: "2026-09-12T03:00:00.000Z", session: B }),
      ],
    });

    expect(tenures.get(KEY_A)).toEqual([{ fromIso: "2026-09-12T01:00:00.000Z", untilIso: "2026-09-12T03:00:00.000Z" }]);
  });

  it("reads an empty journal as no tenures", () => {
    expect(chairTenures({ links: [] }).size).toBe(0);
  });
});
