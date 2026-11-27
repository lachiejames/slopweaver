import { describe, expect, it } from "vitest";

import type { GithubCheck } from "../../../live/github/checksDedupe.js";
import type { RequiredContextGate } from "../../../live/github/requiredContexts.js";
import type { PrReviewThread } from "../../../live/github/reviewState.js";
import {
  dispositionOf,
  excerptOf,
  failingChecks,
  oursResolvable,
  threadDetails,
  waitingOn,
} from "../../../review/prStateDetail.js";

const AUTHOR = "octocat";

const thread = (over: Partial<PrReviewThread> = {}): PrReviewThread => ({
  commentCount: 1,
  id: "PRRT_kwDOfake1",
  isOutdated: false,
  isResolved: false,
  lastCommentAtIso: "2026-09-03T07:11:23Z",
  lastCommentBody: "",
  lastCommentLogin: "arlom-acme",
  line: 209,
  openedAtIso: "2026-09-03T07:11:23Z",
  openedByLogin: "arlom-acme",
  openerBody: "",
  path: "apps/customerApp/webV2/src/components/CheckoutV2/CheckoutPaymentProcessPage.tsx",
  ...over,
});

const check = (over: Partial<GithubCheck> = {}): GithubCheck => ({
  kind: "check-run",
  name: "build",
  state: "failed",
  url: "https://github.com/acme/acme-admin/actions/runs/1",
  ...over,
});

const READ_GATE: RequiredContextGate = {
  branch: "staging",
  inFlight: [],
  kind: "read",
  mergeable: undefined,
  missing: [],
  required: ["build", "integration"],
  unproven: [],
};

describe("excerptOf", () => {
  it("takes the first non-empty line and keeps the severity marker exactly as written", () => {
    const body = "\n\n**Blocking.** This renders `CheckoutError`, whose body copy is fixed\n\nmore detail below";
    expect(excerptOf({ body })).toBe("**Blocking.** This renders `CheckoutError`, whose body copy is fixed");
  });

  it("joins CodeRabbit's marker-only severity row to the finding title beneath it", () => {
    const body =
      "_📐 Maintainability & Code Quality_ | _🟡 Minor_ | _⚡ Quick win_\n\n**Use a plain sentence-case heading.** Replace it";
    expect(excerptOf({ body })).toBe(
      "_📐 Maintainability & Code Quality_ | _🟡 Minor_ | _⚡ Quick win_ **Use a plain sentence-case heading.** Replace it",
    );
  });

  it("keeps a first line that merely contains emphasis on its own", () => {
    expect(excerptOf({ body: "_Nit_: rename this\n\nsecond line" })).toBe("_Nit_: rename this");
  });

  it("collapses internal whitespace onto one line", () => {
    expect(excerptOf({ body: "the   old\tmessage was wrong" })).toBe("the old message was wrong");
  });

  it("truncates a long first line with an ellipsis at 160 characters", () => {
    const excerpt = excerptOf({ body: "x".repeat(400) });
    expect(excerpt.length).toBe(160);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("answers the empty string when bodies were not read", () => {
    expect(excerptOf({ body: "" })).toBe("");
  });
});

describe("dispositionOf", () => {
  it("answers resolved for a resolved thread whoever wrote it", () => {
    expect(dispositionOf({ prAuthorLogin: AUTHOR, thread: thread({ isResolved: true }) })).toBe("resolved");
  });

  // The false-positive class: six of the owner's 28 open pull requests carry open threads whose only
  // author is the owner — the --self-review walkthrough. Reading those as a reviewer waiting is the whole defect.
  it("answers ours-open for a thread the pull request's own author opened", () => {
    expect(
      dispositionOf({ prAuthorLogin: AUTHOR, thread: thread({ openedByLogin: AUTHOR, lastCommentLogin: AUTHOR }) }),
    ).toBe("ours-open");
  });

  it("answers awaiting-us for a reviewer's thread nobody has replied to", () => {
    expect(dispositionOf({ prAuthorLogin: AUTHOR, thread: thread() })).toBe("awaiting-us");
  });

  it("answers answered-open when we replied last and left it open", () => {
    const answered = thread({ commentCount: 2, lastCommentLogin: AUTHOR });
    expect(dispositionOf({ prAuthorLogin: AUTHOR, thread: answered })).toBe("answered-open");
  });

  it("answers reviewer-replied when the reviewer has spoken again after us", () => {
    const back = thread({ commentCount: 3, lastCommentLogin: "arlom-acme" });
    expect(dispositionOf({ prAuthorLogin: AUTHOR, thread: back })).toBe("reviewer-replied");
  });

  // MEASURED over 23 `ours-open` threads on the owner's open `acme/acme-admin` pull requests: 21
  // carried one comment, and 2 carried a colleague's reply. One of those two is a case where
  // `sadiewells-acme` had spoken LAST on a thread the owner opened, and reading it by its OPENER made that
  // colleague invisible to `waitingOn`, to `threads-clear` and to every judgement signal at once.
  it("answers reviewer-replied when a colleague replied to a thread the AUTHOR opened", () => {
    const replied = thread({ commentCount: 2, lastCommentLogin: "sadiewells-acme", openedByLogin: AUTHOR });
    expect(dispositionOf({ prAuthorLogin: AUTHOR, thread: replied })).toBe("reviewer-replied");
  });
});

describe("threadDetails", () => {
  it("carries the opener excerpt, the reply excerpt and the disposition, newest-spoken first", () => {
    const details = threadDetails({
      prAuthorLogin: AUTHOR,
      threads: [
        thread({
          lastCommentAtIso: "2026-09-03T07:00:00Z",
          lastCommentBody: "**Blocking.** the copy is wrong",
          openerBody: "**Blocking.** the copy is wrong",
        }),
        thread({
          commentCount: 2,
          lastCommentAtIso: "2026-09-04T09:00:00Z",
          lastCommentBody: "Disagree — the RUM query keys on the old string",
          lastCommentLogin: AUTHOR,
          line: 208,
          openerBody: "The old message was the production evidence",
        }),
      ],
    });
    expect(details.length).toBe(2);
    expect(details[0]!.line).toBe(208);
    expect(details[0]!.disposition).toBe("answered-open");
    expect(details[0]!.openerLine).toBe("The old message was the production evidence");
    expect(details[0]!.lastCommentLine).toBe("Disagree — the RUM query keys on the old string");
    expect(details[1]!.disposition).toBe("awaiting-us");
  });
});

describe("waitingOn", () => {
  it("counts open reviewer threads per login, most first, and never counts our own notes", () => {
    const details = threadDetails({
      prAuthorLogin: AUTHOR,
      threads: [
        thread({ lastCommentAtIso: "2026-09-03T01:00:00Z" }),
        thread({ lastCommentAtIso: "2026-09-03T02:00:00Z" }),
        thread({
          lastCommentAtIso: "2026-09-03T03:00:00Z",
          openedByLogin: "jonahy-acme",
          lastCommentLogin: "jonahy-acme",
        }),
        thread({ lastCommentAtIso: "2026-09-03T04:00:00Z", openedByLogin: AUTHOR, lastCommentLogin: AUTHOR }),
        thread({ isResolved: true, lastCommentAtIso: "2026-09-03T05:00:00Z" }),
      ],
    });
    expect(waitingOn({ details, prAuthorLogin: AUTHOR })).toEqual([
      { login: "arlom-acme", open: 2 },
      { login: "jonahy-acme", open: 1 },
    ]);
  });

  it("answers empty when every open thread is our own walkthrough", () => {
    const details = threadDetails({
      prAuthorLogin: AUTHOR,
      threads: [thread({ openedByLogin: AUTHOR, lastCommentLogin: AUTHOR })],
    });
    expect(waitingOn({ details, prAuthorLogin: AUTHOR })).toEqual([]);
  });

  it("counts the colleague who replied LAST on a thread the author opened", () => {
    const details = threadDetails({
      prAuthorLogin: AUTHOR,
      threads: [
        thread({ commentCount: 2, lastCommentLogin: "sadiewells-acme", openedByLogin: AUTHOR }),
        thread({ lastCommentAtIso: "2026-09-03T02:00:00Z", openedByLogin: AUTHOR, lastCommentLogin: AUTHOR }),
      ],
    });
    expect(waitingOn({ details, prAuthorLogin: AUTHOR })).toEqual([{ login: "sadiewells-acme", open: 1 }]);
  });
});

describe("oursResolvable", () => {
  it("selects only our own single-comment walkthrough threads, by the id a resolve addresses", () => {
    const details = threadDetails({
      prAuthorLogin: AUTHOR,
      threads: [
        thread({ id: "PRRT_ours1", lastCommentLogin: AUTHOR, openedByLogin: AUTHOR }),
        thread({ id: "PRRT_ours2", lastCommentLogin: AUTHOR, openedByLogin: AUTHOR }),
        thread({ id: "PRRT_replied", commentCount: 2, lastCommentLogin: "arlom-acme", openedByLogin: AUTHOR }),
        thread({ id: "PRRT_theirs" }),
        thread({ id: "PRRT_done", isResolved: true, lastCommentLogin: AUTHOR, openedByLogin: AUTHOR }),
      ],
    });
    expect(oursResolvable({ details }).map((detail) => detail.id)).toEqual(["PRRT_ours1", "PRRT_ours2"]);
  });

  it("answers empty when no thread is ours to resolve", () => {
    const details = threadDetails({ prAuthorLogin: AUTHOR, threads: [thread()] });
    expect(oursResolvable({ details })).toEqual([]);
  });
});

describe("failingChecks", () => {
  it("keeps only the non-passing checks and marks each required or advisory, required first", () => {
    const failing = failingChecks({
      checks: [
        check({ name: "Advisory local browser E2E" }),
        check({ name: "CodeQL", state: "passed" }),
        check({ name: "build" }),
      ],
      gate: READ_GATE,
    });
    expect(failing.map((one) => one.name)).toEqual(["build", "Advisory local browser E2E"]);
    expect(failing[0]!.required).toBe(true);
    expect(failing[1]!.required).toBe(false);
  });

  // `required unknown` and `advisory` must never print the same: only the second says a red is safe to send on.
  it("leaves required undefined for every check when the base protection could not be read", () => {
    const failing = failingChecks({
      checks: [check({ name: "build" })],
      gate: { kind: "unreadable", reason: "the token cannot read branch protection" },
    });
    expect(failing[0]!.required).toBe(undefined);
  });

  it("answers empty when every check passed", () => {
    expect(failingChecks({ checks: [check({ state: "passed" })], gate: READ_GATE })).toEqual([]);
  });

  it("counts a running check as not passing, so a pending required gate is visible", () => {
    const failing = failingChecks({ checks: [check({ name: "integration", state: "running" })], gate: READ_GATE });
    expect(failing[0]!.state).toBe("running");
    expect(failing[0]!.required).toBe(true);
  });

  it("carries each failing check's kind and the Actions run GitHub ties it to, so only that run is read as its job", () => {
    const failing = failingChecks({
      checks: [check({ name: "build", runId: "7" }), check({ kind: "status", name: "external-ci" })],
      gate: READ_GATE,
    });
    expect(failing.map((one) => [one.name, one.kind, one.runId])).toEqual([
      ["build", "check-run", "7"],
      ["external-ci", "status", undefined],
    ]);
  });
});
