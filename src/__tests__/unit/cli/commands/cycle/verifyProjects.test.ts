/**
 * The project-update `--verify` leg, driven through its two seams — the credential read and the live
 * `projectUpdates` read — so the cap, the keyed histories and every way a project stays unknown are pinned
 * without a network.
 */
import { describe, expect, it } from "vitest";

import {
  type ProjectTokenReader,
  type ProjectUpdatesReader,
  type ProjectVerifyTarget,
  verifyOverdueProjects,
} from "../../../../../cli/commands/cycle/verifyProjects.js";
import type { ProjectUpdateHistory } from "../../../../../cycle/projectHistory.js";
import { err, ok } from "../../../../../lib/result.js";
import { LinearLiveErrors } from "../../../../../live/linear/errors.js";

/** What one scripted live read answers. */
type ReadAnswer = Awaited<ReturnType<ProjectUpdatesReader>>;

const HOME = "/nonexistent/verify-projects-home";

/** A target whose URL is derived from its id, so a test can name either. */
const target = ({ id }: { id: string }): ProjectVerifyTarget => ({ id, url: `https://linear.app/acme/project/${id}` });

/** A complete connection holding no update at all — conclusive "never updated". */
const EMPTY_COMPLETE = { nodes: [], pageInfo: { hasNextPage: false } };

/** A token reader answering one fixed value, recording each home it was asked about. */
const tokenReader = ({ token }: { token: string | undefined }) => {
  const homes: string[] = [];
  const read: ProjectTokenReader = ({ home }) => {
    homes.push(home);
    return token;
  };
  return { homes, read };
};

/**
 * An updates reader answering per address — a complete empty page for any address not named — recording
 * each read's address and page size.
 */
const updatesReader = ({ answers }: { answers: ReadonlyMap<string, ReadAnswer> }) => {
  const calls: { address: string; limit: number }[] = [];
  const read: ProjectUpdatesReader = async ({ address, limit }) => {
    calls.push({ address, limit });
    const named = answers.get(address);
    if (named === undefined) {
      return ok(EMPTY_COMPLETE);
    }
    return named;
  };
  return { calls, read };
};

describe("verifyOverdueProjects", () => {
  it("attempts nothing and names every project unknown when no Linear token resolves", async () => {
    const token = tokenReader({ token: undefined });
    const updates = updatesReader({ answers: new Map() });
    const targets = [target({ id: "p1" }), target({ id: "p2" })];

    const outcome = await verifyOverdueProjects({
      home: HOME,
      readUpdates: updates.read,
      targets,
      tokenFor: token.read,
    });

    expect(token.homes).toEqual([HOME]);
    expect(updates.calls).toEqual([]);
    expect(outcome.attempted).toBe(0);
    expect([...outcome.seen]).toEqual([]);
    expect(outcome.stillUnknown).toEqual(["https://linear.app/acme/project/p1", "https://linear.app/acme/project/p2"]);
  });

  it("reads the first 20 projects at a page of 250 and leaves the 21st unattempted and unknown", async () => {
    const token = tokenReader({ token: "lin_api_test" });
    const updates = updatesReader({ answers: new Map() });
    const ids = Array.from({ length: 21 }, (_unused, index) => `p${String(index + 1)}`);

    const outcome = await verifyOverdueProjects({
      home: HOME,
      readUpdates: updates.read,
      targets: ids.map((id) => target({ id })),
      tokenFor: token.read,
    });

    expect(updates.calls).toEqual(
      ids.slice(0, 20).map((id) => ({ address: `https://linear.app/acme/project/${id}`, limit: 250 })),
    );
    expect(outcome.attempted).toBe(20);
    expect([...outcome.seen.keys()]).toEqual(ids.slice(0, 20));
    expect(outcome.stillUnknown).toEqual(["https://linear.app/acme/project/p21"]);
  });

  it("keys conclusive histories by project id in order, and keeps a failed or inconclusive read unknown", async () => {
    const token = tokenReader({ token: "lin_api_test" });
    const updates = updatesReader({
      answers: new Map<string, ReadAnswer>([
        [
          "https://linear.app/acme/project/updated",
          ok({
            nodes: [{ createdAt: "2026-10-01T00:00:00.000Z" }, { createdAt: "2026-10-09T00:00:00.000Z" }],
            pageInfo: { hasNextPage: false },
          }),
        ],
        [
          "https://linear.app/acme/project/failed",
          err(LinearLiveErrors.readFailed({ message: "Linear answered 500" })),
        ],
        ["https://linear.app/acme/project/partial", ok({ nodes: [], pageInfo: { hasNextPage: true } })],
      ]),
    });
    const targets = ["updated", "failed", "partial", "never"].map((id) => target({ id }));

    const outcome = await verifyOverdueProjects({
      home: HOME,
      readUpdates: updates.read,
      targets,
      tokenFor: token.read,
    });

    expect(outcome).toEqual({
      attempted: 4,
      seen: new Map<string, ProjectUpdateHistory>([
        ["updated", { lastUpdateIso: "2026-10-09T00:00:00.000Z", updateCount: 2 }],
        ["never", { lastUpdateIso: undefined, updateCount: 0 }],
      ]),
      stillUnknown: ["https://linear.app/acme/project/failed", "https://linear.app/acme/project/partial"],
    });
    expect([...outcome.seen.keys()]).toEqual(["updated", "never"]);
  });
});
