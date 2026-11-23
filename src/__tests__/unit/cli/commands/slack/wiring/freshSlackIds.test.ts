/*
 * `freshSlackIds`: a workspace-shape write keeps an id the derived roster vouches for while it is fresh, drops it once
 * that roster is stale and its one refresh is spent, keeps an id the HUMAN roster settled, and answers a write naming
 * nobody without opening the store.
 */
import { describe, expect, it } from "vitest";

import { freshSlackIds } from "../../../../../../cli/commands/slack/wiring.js";
import { unwrap, unwrapErr } from "../../../../../../lib/result.js";
import { observeSources, writeFreshnessStamp } from "../../../../../../silver/derive/stamp.js";
import type { IdentityRecord } from "../../../../../../silver/identity.js";
import { unavailableIdentityRosterPort } from "../../../../../identityRosterFixture.js";
import { derivedPerson, freshHome, ROSTER_REVISION, rosterPort, useFreshHomes, writeDerived } from "./harness.js";

useFreshHomes();

/** An ask older than any just-in-time derive this process runs, so a primed home never derives again. */
const ASKED_BEFORE_THE_PRIMING_DERIVE = "2026-01-01T00:00:00.000Z";

/** `freshSlackIds`, unwrapped: the ids resolved over a roster holding the given human records. */
async function idsOf({
  home,
  people,
  records,
}: {
  home: string;
  people: readonly string[];
  records?: readonly IdentityRecord[];
}): Promise<ReadonlyMap<string, string>> {
  return unwrap(
    await freshSlackIds({
      askedAtIso: ASKED_BEFORE_THE_PRIMING_DERIVE,
      home,
      identityRoster: rosterPort(records === undefined ? {} : { records }),
      people,
    }),
  );
}

/**
 * A home whose one just-in-time derive for this ask is already spent, holding a derived roster that resolves
 * `p-ada` and a stamp that is either current or recording MORE slack bronze than is on disk — a shrink, which
 * no ask settles.
 */
async function primedHome({ prefix, stale }: { prefix: string; stale: boolean }): Promise<string> {
  const home = freshHome({ prefix });
  await idsOf({ home, people: ["p-ada"] });
  writeDerived({
    home,
    value: {
      candidates: [],
      conflicts: [],
      observedAtIso: "2026-08-23T08:59:00.000Z",
      people: [derivedPerson({ handle: "ada-l", id: "p-ada", slackId: "U_fake_ada" })],
    },
  });
  const observed = observeSources({ home, rosterRevision: ROSTER_REVISION });
  const slack = { ...observed.sources.slack, bronzeBytes: observed.sources.slack.bronzeBytes + (stale ? 1000 : 0) };
  writeFreshnessStamp({
    artefacts: null,
    derivedAtIso: "2026-08-23T09:00:00.000Z",
    home,
    observation: { ...observed, sources: { ...observed.sources, slack } },
    observedAtIso: "2026-08-23T08:59:00.000Z",
  });
  return home;
}

describe("freshSlackIds — a workspace-shape write refuses a stale roster as a card send does", () => {
  it("keeps an id the derived roster vouches for while that roster is fresh", async () => {
    const home = await primedHome({ prefix: "pr5-wiring-ids-fresh-", stale: false });

    const ids = await idsOf({ home, people: ["p-ada"] });

    expect([...ids]).toEqual([["p-ada", "U_fake_ada"]]);
  });

  it("drops an id only the derived roster vouches for once that roster is stale and its refresh is spent", async () => {
    const home = await primedHome({ prefix: "pr5-wiring-ids-stale-", stale: true });

    const ids = await idsOf({ home, people: ["p-ada"] });

    expect([...ids]).toEqual([]);
  });

  it("keeps an id the HUMAN roster settled, which no refresh could change, beside a stale derived roster", async () => {
    const home = await primedHome({ prefix: "pr5-wiring-ids-override-", stale: true });
    const records: readonly IdentityRecord[] = [
      { handle: "ada-l", id: "p-ada", identities: [{ nativeId: "U_fake_right", source: "slack" }], name: "ada" },
    ];

    const ids = await idsOf({ home, people: ["p-ada"], records });

    expect([...ids]).toEqual([["p-ada", "U_fake_right"]]);
  });

  it("answers a write naming nobody without opening the store, so a store outage cannot stop it", async () => {
    const home = freshHome({ prefix: "pr5-wiring-ids-nobody-" });

    const ids = await freshSlackIds({
      askedAtIso: ASKED_BEFORE_THE_PRIMING_DERIVE,
      home,
      identityRoster: unavailableIdentityRosterPort(),
      people: [],
    });

    expect([...unwrap(ids)]).toEqual([]);
  });

  it("refuses a write naming someone when the store cannot be opened", async () => {
    const home = freshHome({ prefix: "pr5-wiring-ids-outage-" });

    const ids = await freshSlackIds({
      askedAtIso: ASKED_BEFORE_THE_PRIMING_DERIVE,
      home,
      identityRoster: unavailableIdentityRosterPort(),
      people: ["p-ada"],
    });

    expect(unwrapErr(ids).code).toBe("IDENTITY_ROSTER_STORE_UNAVAILABLE");
  });
});
