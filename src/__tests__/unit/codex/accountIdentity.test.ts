/**
 * Which provider account each registered Codex store draws on — `codex/accountIdentity.ts`, pure, over hand-built
 * live rows. The join is shared by `codex reset --at-limit` and the pass reservation, so what is held down here is
 * which stores pair, and which groups are PROVEN well enough for a reservation to key on.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { type CodexAccountCandidate, codexAccountRoots, groupCodexAccounts } from "../../../codex/accountIdentity.js";
import { accountRow } from "./passReservationFixtures.js";
import { observation } from "./rankFixtures.js";

/** The digest a provider identity takes in a group. */
function digest({ text }: { text: string }): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const candidates = ({ rows }: { rows: readonly CodexAccountCandidate[] }): readonly CodexAccountCandidate[] => rows;

/** The same candidate registered on another spelling of its store directory. */
const on = ({ codexHome, row }: { codexHome: string; row: CodexAccountCandidate }): CodexAccountCandidate => ({
  ...row,
  destination: { ...row.destination, codexHome },
});

describe("joining stores into provider accounts", () => {
  it("joins two stores that share a provider account id", () => {
    const rows = candidates({
      rows: [
        accountRow({ account: "acct-one", alias: "plan-one", percent: 10 }),
        accountRow({ account: "acct-two", alias: "plan-two", percent: 10 }),
        accountRow({ account: "acct-one", alias: "plan-three", percent: 10 }),
      ],
    });

    expect(codexAccountRoots({ candidates: rows })).toEqual([0, 1, 0]);
    expect(groupCodexAccounts({ candidates: rows }).map((group) => group.members)).toEqual([[0, 2], [1]]);
  });

  it("joins two stores on the signed-in address whatever its case", () => {
    const rows = candidates({
      rows: [
        accountRow({ account: undefined, alias: "plan-one", email: "Ops@Acme.example", percent: 10 }),
        accountRow({ account: undefined, alias: "plan-two", email: "ops@acme.example", percent: 10 }),
      ],
    });

    const [group] = groupCodexAccounts({ candidates: rows });
    expect(group!.members).toEqual([0, 1]);
    expect(group!.provenIdentities).toEqual([digest({ text: "email:ops@acme.example" })]);
  });

  // The provider may omit its id on one store and give it on another, so a third store sharing the address with
  // one and the id with the other joins all three.
  it("joins transitively through a store that shares one identity with each side", () => {
    const rows = candidates({
      rows: [
        accountRow({ account: "acct-one", alias: "plan-one", percent: 10 }),
        accountRow({ account: undefined, alias: "plan-two", email: "ops@acme.example", percent: 10 }),
        accountRow({ account: "acct-one", alias: "plan-three", email: "ops@acme.example", percent: 10 }),
      ],
    });

    const groups = groupCodexAccounts({ candidates: rows });
    expect(groups.map((group) => group.members)).toEqual([[0, 1, 2]]);
    expect(groups[0]!.provenIdentities).toEqual(
      [digest({ text: "account:acct-one" }), digest({ text: "email:ops@acme.example" })].toSorted(),
    );
  });

  // The register accepts both spellings as two rows; split, an unlimited alias would skip the limited one's
  // reservations (found by a Codex review). The two rows share NO provider identity, so only the store joins them.
  it("joins two spellings of one store directory, a trailing slash included", () => {
    const rows = candidates({
      rows: [
        on({
          codexHome: "/stores/shared/.codex",
          row: accountRow({ account: "acct-one", alias: "plan-one", percent: 49 }),
        }),
        on({
          codexHome: "/stores/shared/./.codex/",
          row: accountRow({ account: undefined, alias: "plan-two", email: "ops@acme.example", percent: 0 }),
        }),
        accountRow({ account: "acct-three", alias: "plan-three", percent: 10 }),
      ],
    });

    const groups = groupCodexAccounts({ candidates: rows });
    expect(groups.map((group) => group.members)).toEqual([[0, 1], [2]]);
    const shared = digest({ text: "store:/stores/shared/.codex" });
    expect(groups[0]!.storeIdentities).toEqual([shared, shared]);
  });

  // A relative store must keep ONE identity whichever directory a pass starts in, so its digest is of the relative
  // spelling itself — the exact digest is the witness, since a working-directory join would prefix it.
  it("joins two spellings of one RELATIVE store without consulting the working directory", () => {
    const rows = candidates({
      rows: [
        on({ codexHome: "stores/shared/./.codex/", row: observation({ alias: "plan-one" }) }),
        on({ codexHome: "stores/shared/.codex", row: observation({ alias: "plan-two" }) }),
      ],
    });

    const groups = groupCodexAccounts({ candidates: rows });
    expect(groups.map((group) => group.members)).toEqual([[0, 1]]);
    const shared = digest({ text: "store:stores/shared/.codex" });
    expect(groups[0]!.storeIdentities).toEqual([shared, shared]);
  });

  // macOS hands back a decomposed accent where a typed path carries a composed one. Neither row names an account, so
  // only the store can join them.
  it("joins a composed and a decomposed accent in one store directory", () => {
    const rows = candidates({
      rows: [
        on({ codexHome: "/stores/café/./.codex", row: observation({ alias: "plan-one" }) }),
        on({ codexHome: "/stores/café/.codex", row: observation({ alias: "plan-two" }) }),
        observation({ alias: "plan-three" }),
      ],
    });

    const groups = groupCodexAccounts({ candidates: rows });
    expect(groups.map((group) => group.members)).toEqual([[0, 1], [2]]);
    const shared = digest({ text: "store:/stores/café/.codex" });
    expect(groups[0]!.storeIdentities).toEqual([shared, shared]);
  });

  it("leaves a group no provider identity proves without an account key", () => {
    const rows = candidates({
      rows: [observation({ alias: "plan-one" }), accountRow({ account: "acct-two", alias: "plan-two", percent: 10 })],
    });

    const groups = groupCodexAccounts({ candidates: rows });
    expect(groups.map((group) => [group.members, group.accountKey, group.provenIdentities])).toEqual([
      [[0], undefined, []],
      [[1], digest({ text: digest({ text: "account:acct-two" }) }), [digest({ text: "account:acct-two" })]],
    ]);
  });
});
