/**
 * The open-pull-request leg: one react-now card per open pull request, split into the two groupings.
 *
 * The cards it builds go straight into `outbound/briefing/schema.ts`, so several of these assert through
 * that schema rather than on the card's fields — a card this leg builds that the form would refuse is the
 * only defect that matters, and asserting the fields alone would not catch one.
 */
import { describe, expect, it } from "vitest";
import { briefingErrorLines } from "../../../briefing/errors.js";
import { type OpenPrItem, openPrCard, openPrReactNow, plainRef, shortAct } from "../../../briefing/openPrCards.js";
import { NO_OWNER_BELIEFS } from "../../../briefing/ownerBeliefs.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { briefingFormSchema } from "../../../outbound/briefing/schema.js";
import type { BriefingCard, BriefingForm } from "../../../outbound/briefing/types.js";

/** The generated owner-intake sentence, which every form carries in the alignment fold. */
const INTAKE_SENTENCE = "Owner turns: 4 read across 1 supervisor session(s), all witnessed.";

/** One pull-request item, as the session-start run records one. */
function item({ over = {} }: { over?: Partial<OpenPrItem> } = {}): OpenPrItem {
  return {
    background: "A pull request you opened in acme/acme-admin. Its title is the line above.",
    doneWhen: "Ask a named reviewer in Slack to review acme/acme-admin#16359 — nobody has been asked yet",
    nativeId: "acme/acme-admin#16359",
    repo: "acme/acme-admin",
    source: "github",
    state: "send-ask",
    title: "Vanta is the sixth cassette config",
    whenIso: "2026-09-01T04:09:30.684Z",
    where: "https://github.com/acme/acme-admin/pull/16359",
    who: "your own pull request",
    ...over,
  };
}

/** A session-start document holding the given items, split across the ranking's two halves. */
function document({
  ranked = [],
  dropped = [],
}: {
  ranked?: readonly OpenPrItem[];
  dropped?: readonly OpenPrItem[];
} = {}): unknown {
  return {
    ranking: {
      dropped: dropped.map((one) => ({ item: one })),
      ranked: ranked.map((one) => ({ item: one })),
    },
  };
}

/** The plain text of a card's `what` cell. */
function whatText({ card }: { card: BriefingCard }): string {
  return card.what.map((run) => run.text).join("");
}

/**
 * Every message the schema objected to, or an empty list when it accepted the form.
 *
 * The branch lives here rather than inside the assertion, which `.claude/rules/testing.md` forbids: a test
 * whose assertion can take either path is one that passes for inputs it was written to refuse.
 */
function formIssues({ parsed }: { parsed: ReturnType<typeof briefingFormSchema.safeParse> }): readonly string[] {
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues.map((issue) => issue.message);
}

/** A whole form carrying one card, so the shipped schema judges what this leg built. */
function formWith({ card, teamFacing }: { card: BriefingCard; teamFacing: boolean }): unknown {
  const form: BriefingForm = {
    autonomy: { notShown: 0, rows: [] },
    handSteps: { notShown: 0, rows: [], unreadable: 0 },
    ownerBeliefs: NO_OWNER_BELIEFS,
    alignment: {
      headline: [{ kind: "text", text: "Both live sessions are on the board's top 5." }],
      intake: [{ kind: "text", text: INTAKE_SENTENCE }],
    },
    awaiting: [],
    header: {
      handoff: "handoff-9012",
      lede: [{ kind: "text", text: "One thing needs your word." }],
      model: "opus",
      pinnedAt: "23:57",
      readyIso: "2026-09-02T01:40:00.000Z",
      refreshedIso: "2026-09-02T01:12:00.000Z",
      sleeping: false,
      workspace: "ws:598",
    },
    history: [],
    reactNow: teamFacing
      ? { meFacing: [], openArtifacts: [], teamFacing: [card] }
      : { meFacing: [card], openArtifacts: [], teamFacing: [] },
    recent: [],
  };
  return form;
}

describe("plainRef", () => {
  it("spells the pull request in a shape the bare-reference scan does not treat as a reference", () => {
    expect(plainRef({ nativeId: "acme/acme-admin#16359" })).toBe("acme-admin 16359");
  });

  it("leaves an id it does not recognise exactly as it found it, rather than inventing a spelling", () => {
    expect(plainRef({ nativeId: "handover:a-run" })).toBe("handover:a-run");
  });
});

describe("shortAct", () => {
  it("carries the act whole when it has no taxonomy to leave behind", () => {
    expect(
      shortAct({
        doneWhen: "Bump alex in Slack about acme/acme-admin#16359, which they have not answered",
        nativeId: "acme/acme-admin#16359",
      }),
    ).toBe("Bump alex in Slack about acme-admin 16359, which they have not answered");
  });

  it("cuts at the em dash, which the operator's own literal voice rule bans above the fold", () => {
    expect(
      shortAct({
        doneWhen: "Ask a named reviewer in Slack to review acme/acme-admin#16341 — nobody has been asked yet",
        nativeId: "acme/acme-admin#16341",
      }),
    ).toBe("Ask a named reviewer in Slack to review acme-admin 16341");
  });

  it("cuts at the colon, which is where the codeowner arm starts listing rules", () => {
    expect(
      shortAct({
        doneWhen:
          "Get the codeowner approvals acme/acme-admin#16359 still owes before merging: 5 of 7 rules, owed by @a @b",
        nativeId: "acme/acme-admin#16359",
      }),
    ).toBe("Get the codeowner approvals acme-admin 16359 still owes before merging");
  });

  it("drops a trailing full stop, so appending the question mark cannot make two sentences", () => {
    expect(shortAct({ doneWhen: "Land it yourself.", nativeId: "x" })).toBe("Land it yourself");
  });
});

describe("openPrReactNow", () => {
  it("refuses a document that is not a session-start run, naming what it could not read", () => {
    expect(briefingErrorLines({ error: unwrapErr(openPrReactNow({ document: { ranking: {} } })) })[0]).toBe(
      "the document is not a `slopweaver session-start --json` run:",
    );
  });

  it("reads the DROPPED half too, which is where a pull request sitting with a colleague ends up", () => {
    const block = unwrap(
      openPrReactNow({
        document: document({
          dropped: [
            item({
              over: { nativeId: "acme/acme-admin#2", where: "https://github.com/acme/acme-admin/pull/2" },
            }),
          ],
          ranked: [item()],
        }),
      }),
    );

    expect(block.groupings.teamFacing.length).toBe(2);
  });

  it("reads a pull request once when the same one appears in both halves of the ranking", () => {
    const block = unwrap(openPrReactNow({ document: document({ dropped: [item()], ranked: [item()] }) }));

    expect(block.groupings.teamFacing.length).toBe(1);
  });

  it("ignores every row that is not a pull request, since another leg owns those", () => {
    const board = item({ over: { nativeId: "handover:a-run", source: "handover", state: undefined } });
    const block = unwrap(openPrReactNow({ document: document({ ranked: [board, item()] }) }));

    expect(block.groupings.teamFacing.length).toBe(1);
    expect(block.groupings.meFacing).toEqual([]);
  });

  it("puts a self-merging repository's pull request in the grouping where nobody else reviews it", () => {
    const block = unwrap(
      openPrReactNow({ document: document({ ranked: [item({ over: { state: "self-merges" } })] }) }),
    );

    expect(block.groupings.meFacing.length).toBe(1);
    expect(block.groupings.teamFacing).toEqual([]);
  });

  // A stacked pull request's card would ask the owner to approve a step that is not
  // a step yet. Its place is in the bottom pull request's fold, which the leg's background carries.
  it("gives a stacked pull request no card of its own, in either grouping", () => {
    const stacked = item({
      over: {
        doneWhen: "Land acme/acme-admin#16415 first — acme/acme-admin#16355 is PR 6 of 6 in its stack",
        nativeId: "acme/acme-admin#16355",
        state: "stacked",
      },
    });
    const block = unwrap(openPrReactNow({ document: document({ dropped: [stacked] }) }));

    expect(block.groupings.meFacing).toEqual([]);
    expect(block.groupings.teamFacing).toEqual([]);
  });

  it("carries the stack on the bottom pull request's card, in the fold, through the leg's own background", () => {
    const bottom = item({
      over: {
        background:
          "A pull request you opened in acme/acme-admin. Its title is the line above. It is the bottom of a " +
          "stack of 6 and carries the stack's only review ask; acme/acme-admin#16341, acme/acme-admin#16355 " +
          "wait behind it until it lands.",
        nativeId: "acme/acme-admin#16415",
        where: "https://github.com/acme/acme-admin/pull/16415",
      },
    });
    const block = unwrap(openPrReactNow({ document: document({ ranked: [bottom] }) }));

    expect(block.groupings.teamFacing.length).toBe(1);
    const fold = JSON.stringify(block.groupings.teamFacing[0]!.detail);
    expect(fold).toContain(
      "It is the bottom of a stack of 6 and carries the stack's only review ask; acme-admin 16341, acme-admin 16355 wait behind it until it lands.",
    );
  });

  it("reads the recommendation past the caveat the leg appends after it", () => {
    const stale = item({ over: { state: "self-merges, and CodeRabbit's green is for an earlier push" } });
    const block = unwrap(openPrReactNow({ document: document({ ranked: [stale] }) }));

    expect(block.groupings.meFacing.length).toBe(1);
    expect(whatText({ card: block.groupings.meFacing[0]! })).toContain("CodeRabbit's green is for an earlier push.");
  });
});

describe("openPrCard", () => {
  it("asks the act as a question, spelling the pull request so it is not a bare reference", () => {
    expect(openPrCard({ item: item(), teamFacing: true }).question).toBe(
      "Ask a named reviewer in Slack to review acme-admin 16359?",
    );
  });

  it("names the pull request with its own title in the subject line, linked", () => {
    const card = openPrCard({ item: item(), teamFacing: true });

    expect(card.subject).toEqual({
      text: "acme/acme-admin#16359 — Vanta is the sixth cassette config",
      url: "https://github.com/acme/acme-admin/pull/16359",
    });
  });

  it("states the recommendation in words rather than in the verb's own token", () => {
    expect(whatText({ card: openPrCard({ item: item(), teamFacing: true }) })).toBe(
      "Nobody has been asked to review it yet. It last moved on 2026-09-01T04:09:30.684Z.",
    );
  });

  it("says plainly that no state was recorded rather than rendering a blank claim", () => {
    const card = openPrCard({ item: item({ over: { state: undefined } }), teamFacing: true });

    expect(whatText({ card })).toBe("This run recorded no state for it. It last moved on 2026-09-01T04:09:30.684Z.");
  });

  it("keeps the whole act in the fold, where the taxonomy after the colon belongs", () => {
    const owed = item({
      over: {
        doneWhen: "Get the codeowner approvals acme/acme-admin#16359 still owes before merging: 5 of 7 rules",
      },
    });
    const card = openPrCard({ item: owed, teamFacing: true });
    const blocks = card.detail!.blocks;

    expect(blocks[1]).toEqual({
      items: [
        [
          {
            kind: "text",
            text: "Get the codeowner approvals acme-admin 16359 still owes before merging: 5 of 7 rules",
          },
        ],
        [{ kind: "text", text: "A pull request you opened in acme/acme-admin." }],
        [{ kind: "text", text: "Its title is the line above." }],
        [{ kind: "text", text: "Nobody else is sitting on it." }],
        [{ kind: "text", text: "It last moved 2026-09-01T04:09:30.684Z." }],
      ],
      kind: "list",
      ordered: false,
    });
  });

  it("carries the title beside the key on the fold's own link, which the composed-fold rule requires", () => {
    const card = openPrCard({ item: item(), teamFacing: true });

    expect(card.detail!.blocks[0]).toEqual({
      content: [
        {
          kind: "link",
          text: "acme/acme-admin#16359 — Vanta is the sixth cassette config",
          url: "https://github.com/acme/acme-admin/pull/16359",
        },
      ],
      kind: "para",
    });
  });

  it("never says a pull request is sitting with `your own pull request`, which is a provenance note", () => {
    const mine = openPrCard({ item: item(), teamFacing: true });
    const theirs = openPrCard({ item: item({ over: { who: "alex" } }), teamFacing: true });

    expect(mine.detail!.blocks.at(-1)).toEqual({
      items: [
        [
          {
            kind: "text",
            text: "Ask a named reviewer in Slack to review acme-admin 16359 — nobody has been asked yet",
          },
        ],
        [{ kind: "text", text: "A pull request you opened in acme/acme-admin." }],
        [{ kind: "text", text: "Its title is the line above." }],
        [{ kind: "text", text: "Nobody else is sitting on it." }],
        [{ kind: "text", text: "It last moved 2026-09-01T04:09:30.684Z." }],
      ],
      kind: "list",
      ordered: false,
    });
    expect(theirs.detail!.blocks.at(-1)).toEqual({
      items: [
        [
          {
            kind: "text",
            text: "Ask a named reviewer in Slack to review acme-admin 16359 — nobody has been asked yet",
          },
        ],
        [{ kind: "text", text: "A pull request you opened in acme/acme-admin." }],
        [{ kind: "text", text: "Its title is the line above." }],
        [{ kind: "text", text: "It sits with alex, and last moved 2026-09-01T04:09:30.684Z." }],
      ],
      kind: "list",
      ordered: false,
    });
  });

  it("keeps the fold inside the composed fold's shape on the widest background its generator can emit", () => {
    // `../sessionStart/githubLeg.ts`'s maximal `prBackground`: the bottom of a stack of six, which names one
    // reference per pull request queued behind it. Reproduce it with
    // `yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/sessionStart/githubLeg/item.test.ts`.
    const widest = item({
      over: {
        background:
          "A pull request you opened in acme/acme-admin. Its title is the line above. " +
          "It is the bottom of a stack of 6 and carries the stack's only review ask; " +
          "acme/acme-admin#16341, acme/acme-admin#16378, acme/acme-admin#16338, " +
          "acme/acme-admin#16339, acme/acme-admin#16355 wait behind it until it lands.",
      },
    });
    const card = openPrCard({ item: widest, teamFacing: true });

    expect(card.detail!.blocks.length).toBe(2);
    expect(briefingFormSchema.safeParse(formWith({ card, teamFacing: true })).success).toBe(true);
  });

  // Three inputs this leg reads are bounded by nothing upstream, and each one reaches a fold block: a
  // colleague's TITLE goes in the citation link, `conflictingAct` lists every conflicting path, and
  // `answeredAskAct` lists every codeowner rule still owed. All three were live counterexamples against the
  // the per-cell fold caps, which is why the fold became one citation plus one bullet per sentence.
  // Those caps came off and the shape stayed, so these now guard the BLOCK count and the
  // bare-key-link rule against the same three unbounded inputs.
  it.each([
    ["a title longer than the word cap", { title: Array.from({ length: 61 }, () => "x").join(" ") }],
    [
      "a conflict listing every path",
      {
        doneWhen:
          "Rebase acme/acme-admin#16359 onto staging, which it conflicts with in 9 files: " +
          Array.from({ length: 9 }, (_unused, index) => `packages/app/src/module-${String(index)}/index.ts`).join(", "),
      },
    ],
    [
      "an owed-codeowner list",
      {
        doneWhen:
          "Get the codeowner approvals acme/acme-admin#16359 still owes before merging: 5 of 7 rules, " +
          "owed by @one @two @three @four @five @six @seven @eight @nine @ten @eleven @twelve @thirteen",
      },
    ],
  ])("keeps the fold inside the composed fold's shape on %s", (_label, over) => {
    const card = openPrCard({ item: item({ over }), teamFacing: true });

    expect(briefingFormSchema.safeParse(formWith({ card, teamFacing: true })).success).toBe(true);
  });

  it("tells the owner a team-facing card carries on when they say nothing", () => {
    const card = openPrCard({ item: item(), teamFacing: true });

    expect(card.ifSilent).toEqual([
      { kind: "text", text: "The step goes ahead and this card comes back the next time this page is rebuilt." },
    ]);
    expect(card.options.length).toBe(4);
  });

  it("tells the owner a me-facing card is a report of work that carried on without them", () => {
    const card = openPrCard({ item: item({ over: { state: "self-merges" } }), teamFacing: false });

    expect(card.ifSilent).toEqual([
      { kind: "text", text: "The work carries on and this card comes back the next time this page is rebuilt." },
    ]);
    expect(card.options.length).toBe(3);
  });

  it("builds a team-facing card the shipped form accepts", () => {
    const card = openPrCard({ item: item(), teamFacing: true });

    expect(briefingFormSchema.safeParse(formWith({ card, teamFacing: true })).success).toBe(true);
  });

  it("builds a me-facing card the shipped form accepts", () => {
    const card = openPrCard({ item: item({ over: { state: "self-merges" } }), teamFacing: false });
    const parsed = briefingFormSchema.safeParse(formWith({ card, teamFacing: false }));

    expect(formIssues({ parsed })).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  it("builds a card the form accepts on the longest act arm, with a title and a stale caveat", () => {
    const worst = item({
      over: {
        doneWhen:
          "Bump alexandra in Slack about acme/acme-admin#16359, which they were asked to review and have not answered",
        state: "bump, and CodeRabbit's green is for an earlier push",
        title: "Move every cloud_cost read behind the allowlist and add the six-case integration suite",
      },
    });

    expect(
      briefingFormSchema.safeParse(formWith({ card: openPrCard({ item: worst, teamFacing: true }), teamFacing: true }))
        .success,
    ).toBe(true);
  });
});

describe("a CONFLICTING pull request", () => {
  const conflicting = item({
    over: {
      doneWhen: "Rebase acme/acme-admin#16324 onto staging, which it conflicts with in 1 file: package.json",
      nativeId: "acme/acme-admin#16324",
      state: "conflicting",
      where: "https://github.com/acme/acme-admin/pull/16324",
    },
  });

  it("goes to the team-facing grouping AHEAD of every review ask, whatever order the document had", () => {
    const block = unwrap(openPrReactNow({ document: document({ dropped: [conflicting], ranked: [item()] }) }));

    expect(block.groupings.meFacing).toEqual([]);
    expect(block.groupings.teamFacing.map((card) => card.subject!.url)).toEqual([
      "https://github.com/acme/acme-admin/pull/16324",
      "https://github.com/acme/acme-admin/pull/16359",
    ]);
  });

  it("asks the rebase as the question and keeps the file list for the fold", () => {
    const card = openPrCard({ item: conflicting, teamFacing: true });

    expect(card.question).toBe("Rebase acme-admin 16324 onto staging, which it conflicts with in 1 file?");
    expect(whatText({ card })).toBe(
      "It conflicts with its base branch, so it cannot merge as it stands. It last moved on 2026-09-01T04:09:30.684Z.",
    );
    expect(card.whyYou).toEqual([
      {
        kind: "text",
        text: "Nothing can land until it is rebased, and whether the rebased branch still ships what you wanted is yours to say.",
      },
    ]);
    expect(card.detail!.blocks[1]).toEqual({
      items: [
        [
          {
            kind: "text",
            text: "Rebase acme-admin 16324 onto staging, which it conflicts with in 1 file: package.json",
          },
        ],
        [{ kind: "text", text: "A pull request you opened in acme/acme-admin." }],
        [{ kind: "text", text: "Its title is the line above." }],
        [{ kind: "text", text: "Nobody else is sitting on it." }],
        [{ kind: "text", text: "It last moved 2026-09-01T04:09:30.684Z." }],
      ],
      kind: "list",
      ordered: false,
    });
  });

  it("builds a card the shipped form schema accepts", () => {
    const card = openPrCard({ item: conflicting, teamFacing: true });
    expect(briefingFormSchema.safeParse(formWith({ card, teamFacing: true })).success).toBe(true);
  });
});

describe("openPrReactNow holds back what the run says is already settled or not the owner's move", () => {
  const ruled = {
    item: item({ over: { nativeId: "acme/acme-admin#16358" } }),
    standing: { atIso: "2026-09-02T12:10:00.000Z", kind: "ruled", outcome: "rejected" },
  };
  const inFlight = {
    item: item({ over: { nativeId: "acme/acme-admin#16366" } }),
    reason: "in flight, session pr-16366 — it opened on this branch",
    standing: { joinedBy: "branch", kind: "in-flight", slug: "pr-16366" },
  };
  const untouched = {
    item: item({ over: { nativeId: "acme/acme-admin#16384" } }),
    standing: { kind: "untouched" },
  };
  const projection = unwrap(
    openPrReactNow({ document: { ranking: { dropped: [inFlight], ranked: [ruled, untouched] } } }),
  );

  it("cards only the untouched pull request", () => {
    expect(projection.groupings.teamFacing.map((card) => card.subject!.text)).toEqual([
      "acme/acme-admin#16384 — Vanta is the sixth cassette config",
    ]);
    expect(projection.groupings.meFacing).toEqual([]);
  });

  it("names every pull request it held back, in the standing's own words rather than a rule-zero reason", () => {
    expect(projection.heldBack).toEqual([
      { nativeId: "acme/acme-admin#16358", why: "ruled 2026-09-02 (rejected)" },
      { nativeId: "acme/acme-admin#16366", why: "in flight, session pr-16366 — it opened on this branch" },
    ]);
  });

  it("reports nothing held back when every pull request is untouched", () => {
    expect(unwrap(openPrReactNow({ document: document({ ranked: [item()] }) })).heldBack).toEqual([]);
  });
});

describe("openPrReactNow and a standing it cannot read", () => {
  it("cards a pull request whose standing is a kind this build does not know, rather than hiding it", () => {
    const later = { item: item(), reason: "sitting with a colleague", standing: { kind: "parked", until: "later" } };
    const result = unwrap(openPrReactNow({ document: { ranking: { dropped: [later], ranked: [] } } }));
    expect(result.groupings.teamFacing.length).toBe(1);
    expect(result.heldBack).toEqual([]);
  });
});
