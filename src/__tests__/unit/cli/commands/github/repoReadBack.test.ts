/**
 * `github repo`'s send and read-back over a plain fake administration API: success is the read-back alone, keyed
 * on the repository's immutable id, never the send's own response. The door and the preview around it are
 * `repoAdministrationRun.test.ts`'s.
 */
import { errAsync, okAsync } from "neverthrow";
import { describe, expect, it } from "vitest";

import { planRepoAdministration } from "../../../../../cli/commands/github/repoPlan.js";
import { readState, sendAndConfirm } from "../../../../../cli/commands/github/repoReadBack.js";
import type {
  GithubRepoAdministrationApi,
  RepoAdministrationState,
} from "../../../../../outbound/github/repoAdministration.js";

const WIDGETS: RepoAdministrationState = {
  archived: false,
  fullName: "acme/widgets",
  htmlUrl: "https://github.com/acme/widgets",
  id: 4242,
  name: "widgets",
  ownerLogin: "acme",
};

/** The address the operator typed. */
const WIDGETS_SOURCE = { owner: "acme", repo: "widgets" };

/** A fake API whose every read answers `readBack`, recording each write as `<kind> <address>`. */
function fakeApi({
  readBack,
  sent,
}: {
  readBack: RepoAdministrationState;
  sent: string[];
}): GithubRepoAdministrationApi {
  return {
    archive: ({ owner, repo }) => {
      sent.push(`archive ${owner}/${repo}`);
      return okAsync(undefined);
    },
    read: () => okAsync(readBack),
    rename: ({ owner, repo }) => {
      sent.push(`rename ${owner}/${repo}`);
      return okAsync(undefined);
    },
    transfer: ({ owner, repo }) => {
      sent.push(`transfer ${owner}/${repo}`);
      return okAsync(undefined);
    },
  };
}

/** A transfer wait that never sleeps. */
const NO_WAIT = { attempts: 1, intervalMs: 0, sleep: async (): Promise<void> => {} };

describe("sendAndConfirm", () => {
  it("confirms an archive only when the same repository reads back archived", async () => {
    const sent: string[] = [];
    const plan = planRepoAdministration({ action: { kind: "archive" }, current: WIDGETS, source: WIDGETS_SOURCE });
    const api = fakeApi({ readBack: { ...WIDGETS, archived: true }, sent });
    const result = await sendAndConfirm({ plan, seams: { api, wait: NO_WAIT } });
    expect(result._unsafeUnwrap().archived).toBe(true);
    expect(sent).toEqual(["archive acme/widgets"]);
  });

  it("reports a rename unconfirmed when a different repository answers at the new address", async () => {
    const sent: string[] = [];
    const action = { kind: "rename", newName: "gadgets" } as const;
    const plan = planRepoAdministration({ action, current: WIDGETS, source: WIDGETS_SOURCE });
    const api = fakeApi({ readBack: { ...WIDGETS, fullName: "acme/gadgets", id: 7, name: "gadgets" }, sent });
    const result = await sendAndConfirm({ plan, seams: { api, wait: NO_WAIT } });
    expect(result._unsafeUnwrapErr().code).toBe("WRITE_UNCONFIRMED");
    expect(sent).toEqual(["rename acme/widgets"]);
  });
});

describe("readState", () => {
  it("maps a provider failure into an upstream refusal naming the address", async () => {
    const api: GithubRepoAdministrationApi = {
      ...fakeApi({ readBack: WIDGETS, sent: [] }),
      read: () =>
        errAsync({ kind: "http", message: "HTTP 500", operation: "github.repos.get", provider: "github", status: 500 }),
    };
    const result = await readState({ api, owner: "acme", repo: "widgets" });
    expect(result._unsafeUnwrapErr().code).toBe("UPSTREAM_REFUSED");
  });
});
