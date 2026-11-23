/*
 * The SEAM, end to end: a verb's raw `--json` payload → the reader → `rowsOf` → the workspace filter.
 *
 * `workspacePlacement/*.test.ts` pins the derivation and it would stay green through the defect this file
 * exists to catch — a reader or a projection dropping a field on its way to it. `readBoard` once discarded
 * a field every board row carries, and a derivation nobody feeds is a derivation nobody has. The board row
 * here is an ISO ask whose pull requests are all `acme/acme-admin`, carrying the
 * Slopweaver checkout as its `repo:` because that is where every fleet seat runs.
 *
 * Under `site/__tests__/unit/` because `site/` is outside `src/` and a file under `src/` may not import one
 * outside it (TS6059, the CI `compile` job); the unit lane reaches both roots.
 */

import { describe, expect, it } from "vitest";

import { readBoard, readHandSteps } from "../../components/live/read";
import type { LiveState } from "../../components/live/useLive";
import { rowsOf } from "../../lib/queueRows";
import { shownInContext } from "../../lib/workspacePlacementContext";
import { ACME_PLACER, FIXTURE_SELF_REPOSITORY } from "../organisationFixture";

/** A board row exactly as `slopweaver handover list --json` publishes one, with the keys the reader needs. */
function boardPayload({
  repo,
  prUrls,
  workspace,
  slug = "iso-gdpr-data-inventory-rosa-leads",
  published = {},
}: {
  repo: string;
  prUrls: readonly string[];
  workspace?: string;
  slug?: string;
  published?: Record<string, unknown>;
}): unknown {
  return {
    rows: [
      {
        kind: "ask",
        options: [],
        ownerWait: "owner",
        prUrls,
        question: "which option?",
        questionAskedIso: "2026-09-21T09:02:12.749Z",
        reason: "declared ready",
        repo,
        section: "WAITING ON OWNER",
        slug,
        status: "ready",
        ...(workspace === undefined ? {} : { workspace }),
        ...published,
      },
    ],
    unresolved: 0,
  };
}

/** A step in the shape `slopweaver hand list --json` prints one, every value invented. */
const ISO_STEP = {
  id: "policy-pack-group-write",
  postedBy: "workspace:0000AAAA-1111-4222-8333-444455556666",
  postedIso: "2026-09-21T09:02:12.749Z",
  unblocks: "run two-group-writes-waiting-on-a-word",
  what: "Give your word on two group writes: one person into a team, and a policy pack off a default group",
  where: "the page carries both acts, with the measurement behind each",
  witness: 'slopweaver hand done policy-pack-group-write --did "gave my word"',
};

/** Every register but the one under test, in the phase that contributes no rows. */
const QUIET = { phase: "loading" } as const;

/** The instant a ready register was read at — the stamp `app/api/live/[verb]/route.ts` puts on one. */
const OBSERVED = "2026-09-21T09:04:00.000Z";

/**
 * A register that arrived, stamped exactly the way the live route stamps one, so the seam under test is
 * fed the whole `ready` arm rather than the two fields these assertions happen to read.
 */
function ready<T>({ value }: { value: T }): LiveState<T> {
  return { fixture: undefined, observedAtIso: OBSERVED, phase: "ready", stampedByRoute: true, value };
}

/** The queue rows one register's payload projects into, with the other five silent. */
function rows({ board, hands }: { board?: unknown; hands?: unknown } = {}): ReturnType<typeof rowsOf> {
  return rowsOf({
    reviewers: { phase: "loading" },
    standing: { phase: "loading" },
    acts: QUIET,
    board: board === undefined ? QUIET : ready({ value: readBoard(board)! }),
    drafts: QUIET,
    hands: hands === undefined ? QUIET : ready({ value: readHandSteps(hands)! }),
    landing: QUIET,
    placer: ACME_PLACER,
    posts: QUIET,
    reviews: QUIET,
    imports: QUIET,
  });
}

/** The checkout every fleet seat runs in — what the ISO ask carried as `repo:`. */
const FLEET_CHECKOUT = "/Users/x/dev/personal/slopweaver";

describe("a board row's pull requests and workspace survive the whole seam", () => {
  it("places the ISO ask in team off its acme-admin pull requests, whatever checkout it ran in", () => {
    const row = rows({
      board: boardPayload({ prUrls: ["https://github.com/acme/acme-admin/pull/17870"], repo: FLEET_CHECKOUT }),
    })[0];
    expect(row.placement).toEqual({
      by: [{ source: "repository", value: "acme/acme-admin", workspace: "team" }],
      kind: "placed",
      workspace: "team",
    });
    expect(shownInContext({ context: "work", placement: row.placement })).toBe(true);
    expect(shownInContext({ context: "slopweaver", placement: row.placement })).toBe(false);
  });

  it("carries a stated workspace: through the reader, and it places the row", () => {
    const row = rows({ board: boardPayload({ prUrls: [], repo: FLEET_CHECKOUT, workspace: "team" }) })[0];
    expect(row.placement).toEqual({
      by: [{ source: "stated", value: "team", workspace: "team" }],
      kind: "placed",
      workspace: "team",
    });
  });

  it("leaves a row whose fields name nothing unplaced, shown in self by the default rule — the checkout is never evidence", () => {
    const row = rows({ board: boardPayload({ prUrls: [], repo: FLEET_CHECKOUT }) })[0];
    expect(row.placement.kind).toBe("unplaced");
    expect(shownInContext({ context: "work", placement: row.placement })).toBe(false);
    expect(shownInContext({ context: "slopweaver", placement: row.placement })).toBe(true);
  });
});

describe("a hand step's stated context survives the whole seam", () => {
  it("leaves the live ISO step unplaced on its prose alone — words never place a row", () => {
    const row = rows({ hands: [ISO_STEP] })[0];
    expect(row.placement.kind).toBe("unplaced");
    expect(shownInContext({ context: "slopweaver", placement: row.placement })).toBe(true);
    expect(shownInContext({ context: "work", placement: row.placement })).toBe(false);
  });

  it("places it by the context it was posted with", () => {
    const row = rows({ hands: [{ ...ISO_STEP, context: "work" }] })[0];
    expect(row.placement).toEqual({
      by: [{ source: "stated", value: "team", workspace: "team" }],
      kind: "placed",
      workspace: "team",
    });
    expect(shownInContext({ context: "slopweaver", placement: row.placement })).toBe(false);
  });

  it("keeps `witness` out of the hint, so the settling command cannot place every step at once", () => {
    expect(rows({ hands: [ISO_STEP] })[0].hint.includes("slopweaver hand done")).toBe(false);
  });

  it("draws the step as unreadable, naming context, on a context that is neither id, rather than reading it as absence", () => {
    expect(readHandSteps([{ ...ISO_STEP, context: "acme" }])![0].unreadable).toBe("context");
    expect(readHandSteps([{ ...ISO_STEP, context: 1 }])![0].unreadable).toBe("context");
  });

  // Both addresses place the step, so one silently lost could hide the one contradicting its context.
  it("draws the step as unreadable, naming url or where, on one that will not read", () => {
    const slopweaver = "https://github.com/octo-self/slopweaver/pull/1";
    expect(readHandSteps([{ ...ISO_STEP, context: "work", url: [slopweaver] }])![0].unreadable).toBe("url");
    expect(
      readHandSteps([{ ...ISO_STEP, context: "work", url: "github.com/octo-self/slopweaver/pull/1" }])![0].unreadable,
    ).toBe("url");
    expect(readHandSteps([{ ...ISO_STEP, context: "work", where: [slopweaver] }])![0].unreadable).toBe("where");
    expect(
      readHandSteps([{ ...ISO_STEP, context: "work", url: "ftp://github.com/octo-self/slopweaver/pull/1" }])![0]
        .unreadable,
    ).toBe("url");
  });

  // `where` is prose or an address; a link on another scheme is prose, so it names nothing.
  it("reads a where on a non-web scheme as prose, which places nothing", () => {
    const row = rows({ hands: [{ ...ISO_STEP, where: "ftp://github.com/octo-self/slopweaver/pull/1" }] })[0];
    expect(row.placement.kind).toBe("unplaced");
  });

  it("carries a url that reads to placement, where it conflicts with the stated context", () => {
    const url = `https://github.com/${FIXTURE_SELF_REPOSITORY}/pull/1`;
    const row = rows({ hands: [{ ...ISO_STEP, context: "work", url }] })[0];
    expect(row.placement).toMatchObject({
      kind: "placed",
      overruled: [{ value: FIXTURE_SELF_REPOSITORY, workspace: "self" }],
      workspace: "team",
    });
  });
});

/** A declared tag exactly as `handover list --json` publishes one. */
function declared({ key, value }: { key: string; value: string }): unknown {
  return { key, source: "declared", value };
}

/** The one queue row a board payload projects into, run from the fleet checkout and naming no pull request. */
function boardRow({
  published,
  prUrls = [],
  workspace,
}: {
  published: Record<string, unknown>;
  prUrls?: readonly string[];
  workspace?: string;
}): ReturnType<typeof rowsOf>[number] {
  const payload = { prUrls, published, repo: FLEET_CHECKOUT, ...(workspace === undefined ? {} : { workspace }) };
  return rows({ board: boardPayload(payload) })[0];
}

describe("a board row's declared context= survives the whole seam as a stated workspace", () => {
  const trusted = { tagsIncomplete: false } as const;

  it("places a row by its declared context=, and ranks it as blocking a colleague only on a colleague's address", () => {
    const row = boardRow({ published: { ...trusted, tags: [declared({ key: "context", value: "slopweaver" })] } });
    expect(row.placement).toEqual({
      by: [{ source: "stated", value: "context=slopweaver", workspace: "self" }],
      kind: "placed",
      workspace: "self",
    });
    expect(shownInContext({ context: "work", placement: row.placement })).toBe(false);
    expect(row.tier).toBe("fleet-blocked");
    const work = boardRow({ published: { ...trusted, tags: [declared({ key: "context", value: "work" })] } });
    expect(work.placement).toEqual({
      by: [{ source: "stated", value: "context=work", workspace: "team" }],
      kind: "placed",
      workspace: "team",
    });
    // A stated workspace says whose work it is, never who waits (`askTeamFacing`): the colleague tier needs an address.
    expect(work.tier).toBe("fleet-blocked");
    const addressed = boardRow({
      prUrls: ["https://github.com/acme/acme-admin/pull/17870"],
      published: { ...trusted, tags: [declared({ key: "context", value: "work" })] },
    });
    expect(addressed.tier).toBe("team-blocked");
  });

  it("rules over a contrary pull request, placed and marked with what it overruled", () => {
    const row = boardRow({
      prUrls: ["https://github.com/acme/acme-admin/pull/17870"],
      published: { ...trusted, tags: [declared({ key: "context", value: "slopweaver" })] },
    });
    expect(row.placement).toEqual({
      by: [{ source: "stated", value: "context=slopweaver", workspace: "self" }],
      kind: "placed",
      overruled: [{ source: "repository", value: "acme/acme-admin", workspace: "team" }],
      workspace: "self",
    });
  });

  it("is a conflict when it disagrees with the row's workspace: line — two statements, neither settles it", () => {
    const row = boardRow({
      published: { ...trusted, tags: [declared({ key: "context", value: "work" })] },
      workspace: "self",
    });
    expect(row.placement.kind).toBe("conflict");
    expect(shownInContext({ context: "work", placement: row.placement })).toBe(false);
    expect(shownInContext({ context: "slopweaver", placement: row.placement })).toBe(true);
  });

  it("is a conflict when two declared context= tags disagree, never first-wins", () => {
    const tags = [declared({ key: "context", value: "work" }), declared({ key: "context", value: "slopweaver" })];
    const row = boardRow({ published: { ...trusted, tags } });
    expect(row.placement.kind).toBe("conflict");
    expect(shownInContext({ context: "slopweaver", placement: row.placement })).toBe(true);
    expect(shownInContext({ context: "work", placement: row.placement })).toBe(false);
  });

  it("leaves an UNTAGGED row unplaced and shown in self by the default rule, though its slug names ISO", () => {
    const row = boardRow({ published: { ...trusted, tags: [] } });
    expect(row.hint.includes("iso-gdpr")).toBe(true);
    expect(row.placement.kind).toBe("unplaced");
    expect(shownInContext({ context: "slopweaver", placement: row.placement })).toBe(true);
    expect(row.tier).toBe("fleet-blocked");
  });

  it("does not act on a declaration from a board that never said whether its journals read whole", () => {
    const row = boardRow({ published: { tags: [declared({ key: "context", value: "slopweaver" })] } });
    expect(row.placement.kind).toBe("unplaced");
  });

  it("leaves that row a finding though a pull request names the other workspace", () => {
    const row = boardRow({
      prUrls: ["https://github.com/acme/acme-admin/pull/1"],
      published: { tags: [declared({ key: "context", value: "slopweaver" })] },
    });
    expect(row.placement).toEqual({
      kind: "unplaced",
      why: "its tags or run journal were not read whole, so a declared context= may be hidden or unvouched (NOT MEASURED)",
    });
    expect(shownInContext({ context: "slopweaver", placement: row.placement })).toBe(true);
  });
});

describe("a board row whose pull-request links would not read is a finding", () => {
  it("leaves a row stating team unplaced when a bad member hid the Slopweaver link beside it", () => {
    const row = boardRow({
      published: { prUrls: ["https://github.com/octo-self/slopweaver/pull/1", 7] },
      workspace: "team",
    });
    expect(row.placement).toEqual({
      kind: "unplaced",
      why: "its pull-request links did not read as a list of links, so an address may be hidden (NOT MEASURED)",
    });
  });

  it("leaves a row unplaced when a link is a string but not a pull-request link as the verb publishes one", () => {
    const row = boardRow({ published: { prUrls: ["github.com/octo-self/slopweaver/pull/1"] }, workspace: "team" });
    expect(row.placement).toEqual({
      kind: "unplaced",
      why: "its pull-request links did not read as a list of links, so an address may be hidden (NOT MEASURED)",
    });
  });

  it("places a row whose links read whole, or that publishes none", () => {
    expect(
      boardRow({ published: { prUrls: ["https://github.com/acme/acme-admin/pull/2"] }, workspace: "team" }).placement
        .kind,
    ).toBe("placed");
    expect(boardRow({ published: {}, workspace: "team" }).placement.kind).toBe("placed");
    expect(boardRow({ published: { prUrls: [] }, workspace: "team" }).placement.kind).toBe("placed");
  });
});

describe("a board row whose Slack destination link would not read is a finding", () => {
  /** A drafted post to one channel, carrying `url` exactly as given. */
  const posting = ({ url }: { url: unknown }): Record<string, unknown> => ({
    action: {
      actor: "me",
      body: "the switch-over is ready",
      destinations: [{ channel: "C123", kind: "channel", label: "#team", tradeoff: "team sees it", url }],
      mentions: [],
      version: 1,
    },
  });
  const unplaced = {
    kind: "unplaced",
    warning: {
      lead: "Its action would not read",
      subject: "this row's action",
      why: "one of the action's destinations does not name where it would send",
    },
    why: "its action would not read, so a Slack destination may be hidden (NOT MEASURED)",
  };

  it("leaves a row stating team unplaced when the link is not a string, since it may name Slopweaver", () => {
    const row = boardRow({
      published: posting({ url: ["https://github.com/octo-self/slopweaver"] }),
      workspace: "team",
    });
    expect(row.placement).toStrictEqual(unplaced);
  });

  it("leaves it unplaced when the link is a string but not an address", () => {
    const row = boardRow({ published: posting({ url: "github.com/octo-self/slopweaver" }), workspace: "team" });
    expect(row.placement).toStrictEqual(unplaced);
  });

  it("places it when the link is absent, and when it reads", () => {
    expect(boardRow({ published: posting({ url: undefined }), workspace: "team" }).placement.kind).toBe("placed");
    const linked = posting({ url: "https://acme.slack.com/archives/C123" });
    expect(boardRow({ published: linked, workspace: "team" }).placement.kind).toBe("placed");
  });
});

describe("a board row whose workspace: line names no workspace is a finding", () => {
  it("leaves a misspelt line unplaced, though its pull request names Slopweaver", () => {
    const row = boardRow({
      prUrls: ["https://github.com/octo-self/slopweaver/pull/1"],
      published: { workspaceUnread: "everalb" },
    });
    expect(row.placement).toEqual({
      kind: "unplaced",
      why: 'its workspace: line would not read as one workspace ("everalb") (NOT MEASURED)',
    });
  });

  it("reads a published workspace naming no workspace as unread, though the verb did not say so", () => {
    const row = boardRow({
      prUrls: ["https://github.com/octo-self/slopweaver/pull/1"],
      published: {},
      workspace: "everalb",
    });
    expect(row.placement).toEqual({
      kind: "unplaced",
      why: 'its workspace: line would not read as one workspace ("everalb") (NOT MEASURED)',
    });
    expect(shownInContext({ context: "work", placement: row.placement })).toBe(false);
    expect(shownInContext({ context: "slopweaver", placement: row.placement })).toBe(true);
  });
});

describe("a board row whose context= tag the registry refused is a finding", () => {
  const trusted = { tags: [], tagsIncomplete: false } as const;
  const ACME_ADMIN = ["https://github.com/acme/acme-admin/pull/17870"];

  it("leaves a misspelt context= unplaced, though its pull request names Acme", () => {
    const row = boardRow({
      prUrls: ACME_ADMIN,
      published: { ...trusted, unrecognisedTags: [{ key: "context", value: "slopweavr" }] },
    });
    expect(row.placement).toEqual({
      kind: "unplaced",
      why: 'its context= tag would not read as one workspace ("slopweavr") (NOT MEASURED)',
    });
    expect(shownInContext({ context: "slopweaver", placement: row.placement })).toBe(true);
  });

  it("leaves it unplaced when the refused list will not read, since a member may be a context=", () => {
    expect(
      boardRow({ prUrls: ACME_ADMIN, published: { ...trusted, unrecognisedTags: "context=x" } }).placement.kind,
    ).toBe("unplaced");
    expect(boardRow({ prUrls: ACME_ADMIN, published: { ...trusted, unrecognisedTags: [7] } }).placement.kind).toBe(
      "unplaced",
    );
  });

  it("places it by its pull request when every refused tag is some other key", () => {
    const row = boardRow({
      prUrls: ACME_ADMIN,
      published: { ...trusted, unrecognisedTags: [{ key: "colour", value: "blue" }] },
    });
    expect(row.placement).toMatchObject({ kind: "placed", workspace: "team" });
  });
});

describe("a board row whose tags read in doubt is a finding, whatever else it carries", () => {
  const doubt =
    "its tags or run journal were not read whole, so a declared context= may be hidden or unvouched (NOT MEASURED)";

  it("leaves a row beside a tag the reader dropped unplaced, though it names an acme-admin pull request", () => {
    const row = boardRow({
      prUrls: ["https://github.com/acme/acme-admin/pull/17870"],
      published: {
        tags: [declared({ key: "context", value: "slopweaver" }), { key: "broken" }],
        tagsIncomplete: false,
      },
    });
    expect(row.placement).toEqual({ kind: "unplaced", why: doubt });
    expect(shownInContext({ context: "slopweaver", placement: row.placement })).toBe(true);
    expect(shownInContext({ context: "work", placement: row.placement })).toBe(false);
  });

  it("leaves a row whose journal read in part unplaced, though it states a workspace:", () => {
    const row = boardRow({
      published: { tags: [declared({ key: "context", value: "slopweaver" })], tagsIncomplete: true },
      workspace: "team",
    });
    expect(row.placement).toEqual({ kind: "unplaced", why: doubt });
    expect(row.tier).toBe("fleet-blocked");
  });

  it("leaves a row whose journal completeness would not read unplaced, never placed by its pull request", () => {
    const row = boardRow({
      prUrls: ["https://github.com/acme/acme-admin/pull/17870"],
      published: { tags: [], tagsIncomplete: "true" },
    });
    expect(row.placement).toEqual({ kind: "unplaced", why: doubt });
    expect(shownInContext({ context: "slopweaver", placement: row.placement })).toBe(true);
  });

  it("leaves a row whose pull-request link is not the verb's own spelling unplaced, an encoded one included", () => {
    const row = boardRow({ prUrls: ["https://github.com/octo-self/%73lopweaver/pull/1419"], published: {} });
    expect(row.placement).toEqual({
      kind: "unplaced",
      why: "its pull-request links did not read as a list of links, so an address may be hidden (NOT MEASURED)",
    });
  });

  it("leaves a row whose pull-request link names no repository unplaced, though it states a workspace", () => {
    const row = boardRow({
      prUrls: ["https://github.com/octo-self/slopweaver.git/pull/1"],
      published: {},
      workspace: "team",
    });
    expect(row.placement).toEqual({
      kind: "unplaced",
      why: "its pull-request links did not read as a list of links, so an address may be hidden (NOT MEASURED)",
    });
  });

  it("keeps placing a row by its pull requests on a board cut before tags were published", () => {
    const row = boardRow({ prUrls: ["https://github.com/acme/acme-admin/pull/17870"], published: {} });
    expect(row.placement).toEqual({
      by: [{ source: "repository", value: "acme/acme-admin", workspace: "team" }],
      kind: "placed",
      workspace: "team",
    });
  });
});
