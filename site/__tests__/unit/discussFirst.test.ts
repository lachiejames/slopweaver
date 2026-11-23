/*
 * The discuss-first nudge, page side: which fix asks it covers, when it is put and when the owner's ask is carried
 * past it, and the one sentence the voice says. An ask the owner has made outranks the nudge, which is put once and
 * never again for the same repository.
 */
import { describe, expect, it } from "vitest";

import {
  DISCUSS_FIRST_QUESTION,
  discussFirstDecision,
  discussFirstSpeech,
  discussFirstWireOf,
  teamFixAskOf,
} from "../../lib/discussFirst";
import { ACME_PLACER, FIXTURE_SELF_REPOSITORY, GLOBEX_PLACER } from "../organisationFixture";

const THREAD = "https://acme.slack.com/archives/C0SYN000001/p1791351441819519";

const BAD_REPO =
  "fix_repo must be one of the organisation's repositories as owner/name. With none you can name, relay again " +
  "without fix_repo";

describe.each([
  { name: "acme", other: "globex", placer: ACME_PLACER },
  { name: "globex", other: "acme", placer: GLOBEX_PLACER },
])("teamFixAskOf, for $name", ({ name, other, placer }) => {
  it("names the organisation's repository as lower-case owner/name, with the thread when the voice had one", () => {
    expect([
      teamFixAskOf({ args: { fix_repo: ` ${name.toUpperCase()}/${name}-admin ` }, placer }),
      teamFixAskOf({ args: { fix_repo: `https://github.com/${name}/${name}-app`, fix_thread: THREAD }, placer }),
    ]).toEqual([
      { ask: { repository: `${name}/${name}-admin`, thread: undefined } },
      { ask: { repository: `${name}/${name}-app`, thread: THREAD } },
    ]);
  });

  it("asks nothing of a relay that names no fix, nor of a fix to Slopweaver's own repository", () => {
    expect([
      teamFixAskOf({ args: {}, placer }),
      teamFixAskOf({ args: { fix_repo: FIXTURE_SELF_REPOSITORY }, placer }),
    ]).toEqual([{ ask: undefined }, { ask: undefined }]);
  });

  it("refuses a thread with no repository, another organisation's repository, and a composed thread", () => {
    const why = (args: Record<string, unknown>): unknown => (teamFixAskOf({ args, placer }) as { why: string }).why;
    const badThread =
      "fix_thread must be a Slack message link read off the owner's screen or a tool, never composed. Otherwise drop it";
    expect([
      why({ fix_thread: THREAD }),
      why({ fix_repo: `${other}/${other}-admin` }),
      why({ fix_repo: "torvalds/linux" }),
      why({ fix_repo: 7 }),
      why({ fix_repo: `${name}/${name}-admin.git.git` }),
      why({ fix_repo: `${name}/${name}-admin`, fix_thread: "https://example.com/t" }),
      why({ fix_repo: `${name}/${name}-admin`, fix_thread: `${THREAD}?x=${"y".repeat(200)}` }),
      why({ fix_repo: `${name}/${name}-admin`, fix_thread: `${THREAD}?not a query` }),
    ]).toEqual([
      "fix_thread goes only with fix_repo. Drop it, or name the repository the fix is raised on",
      BAD_REPO,
      BAD_REPO,
      BAD_REPO,
      BAD_REPO,
      badThread,
      badThread,
      badThread,
    ]);
  });
});

describe("discussFirstDecision and its wire", () => {
  const ask = { repository: "acme/acme-admin", thread: THREAD };

  it("puts the question on the first ask for a repository, and carries the next one past it", () => {
    const put = discussFirstDecision({ ask, prior: undefined });
    const override = discussFirstDecision({ ask, prior: { turnId: "turn-1" } });
    expect([put, override, discussFirstDecision({ ask: undefined, prior: { turnId: "turn-1" } })]).toEqual([
      { kind: "put", repository: "acme/acme-admin", thread: THREAD },
      { kind: "override", priorTurnId: "turn-1", repository: "acme/acme-admin", thread: THREAD },
      { kind: "none" },
    ]);
    expect([discussFirstWireOf({ decision: put }), discussFirstWireOf({ decision: override })]).toEqual([
      { repository: "acme/acme-admin", status: "put", thread: THREAD },
      { priorTurnId: "turn-1", repository: "acme/acme-admin", status: "override", thread: THREAD },
    ]);
  });

  it("carries no wire field for no fix, and no thread key when there was no thread", () => {
    expect([
      discussFirstWireOf({ decision: { kind: "none" } }),
      discussFirstWireOf({ decision: { kind: "put", repository: "acme/acme-admin", thread: undefined } }),
    ]).toStrictEqual([undefined, { repository: "acme/acme-admin", status: "put" }]);
  });
});

describe("discussFirstSpeech", () => {
  it("says the owner's question lightly, and where the conversation would start only when there was a thread", () => {
    expect(DISCUSS_FIRST_QUESTION).toBe(
      "Did you actually discuss this with the team first? If you did, I'm not aware of it.",
    );
    expect([discussFirstSpeech({ thread: false }), discussFirstSpeech({ thread: true })]).toEqual([
      "Quick check. Did you actually discuss this with the team first? If you did, I'm not aware of it.",
      "Quick check. Did you actually discuss this with the team first? If you did, I'm not aware of it. That thread is the place to start it.",
    ]);
  });
});
