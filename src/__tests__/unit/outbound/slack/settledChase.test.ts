import { describe, expect, it } from "vitest";

import { parsePullRequestUrl } from "../../../../goldDebt/pull.js";
import {
  chasedPullRequests,
  settledChaseRefusals,
  unnamedPullRequestLinks,
} from "../../../../outbound/slack/settledChase.js";
import { ChaseSubjectErrors } from "../../../../outbound/slack/settledChaseErrors.js";

const PR = "https://github.com/acme/acme-admin/pull/18404";
const OTHER = "https://github.com/acme/acme-admin/pull/18398";

/** A rendered rich-text payload carrying each url as a link element, as `slack draft record` renders one. */
function payloadLinking({ urls }: { urls: readonly string[] }): unknown {
  return {
    blocks: [
      {
        elements: [
          { elements: urls.map((url) => ({ text: "a pull request", type: "link", url })), type: "rich_text_section" },
        ],
        type: "rich_text",
      },
    ],
  };
}

describe("chasedPullRequests", () => {
  it("names each linked pull request once, in first-seen order, for a bump", () => {
    const refs = chasedPullRequests({
      act: "bump",
      payload: payloadLinking({ urls: [PR, OTHER, `${PR}`, "https://app.datadoghq.com/apm/traces"] }),
    });
    expect(refs.map((ref) => ref.debtId)).toEqual(["acme/acme-admin#18404", "acme/acme-admin#18398"]);
  });

  it("reads a subpage, a query and a fragment as the pull request they sit under", () => {
    const refs = chasedPullRequests({
      act: "bump",
      payload: payloadLinking({
        urls: [`${PR}/files`, `${OTHER}/commits/4b49fed4c3`, `${PR}#discussion_r1`, `${OTHER}?w=1`],
      }),
    });
    expect(refs.map((ref) => ref.url)).toEqual([PR, OTHER]);
  });

  it("reads an http:// or www. address as the canonical pull request", () => {
    const refs = chasedPullRequests({
      act: "bump",
      payload: payloadLinking({
        urls: ["http://github.com/acme/acme-admin/pull/18404", "https://www.github.com/acme/acme-admin/pull/18398"],
      }),
    });
    expect(refs.map((ref) => ref.url)).toEqual([PR, OTHER]);
  });

  it("reads a fully-qualified github.com. host and an explicit port as the canonical pull request", () => {
    const refs = chasedPullRequests({
      act: "bump",
      payload: payloadLinking({
        urls: ["https://github.com./acme/acme-admin/pull/18404", "https://GitHub.com:443/acme/acme-admin/pull/18398"],
      }),
    });
    expect(refs.map((ref) => ref.url)).toEqual([PR, OTHER]);
  });

  it("reads a bare URL in a plain-form message's text, which Slack links on its own", () => {
    const refs = chasedPullRequests({ act: "bump", payload: { text: `bumping this one: ${PR}` } });
    expect(refs.map((ref) => ref.url)).toEqual([PR]);
  });

  it("drops the sentence punctuation and emphasis closing a bare URL", () => {
    const refs = chasedPullRequests({ act: "bump", payload: { text: `see ${PR}, then *${OTHER}*.` } });
    expect(refs.map((ref) => ref.url)).toEqual([PR, OTHER]);
  });

  it("names a pull request once when it is both a link element and bare text", () => {
    const payload = { ...(payloadLinking({ urls: [PR] }) as object), text: `ok if i close <${PR}|#18404>` };
    expect(chasedPullRequests({ act: "bump", payload }).map((ref) => ref.url)).toEqual([PR]);
  });

  it("reads a leading-zero number and an upper-case segment as the pull request GitHub serves", () => {
    const refs = chasedPullRequests({
      act: "bump",
      payload: payloadLinking({
        urls: ["https://github.com/acme/acme-admin/pull/0018404", "https://github.com/acme/acme-admin/PULL/18398"],
      }),
    });
    expect(refs.map((ref) => ref.url)).toEqual([PR, OTHER]);
  });

  it("reads a link element spelled with one slash as the address a browser opens", () => {
    const refs = chasedPullRequests({
      act: "bump",
      payload: payloadLinking({ urls: ["https:/github.com/acme/acme-admin/pull/18404"] }),
    });
    expect(refs.map((ref) => ref.url)).toEqual([PR]);
  });

  it("reads a one-slash target inside <url|label> markup", () => {
    const payload = { text: "bump <https:/github.com/acme/acme-admin/pull/18404|PR>" };
    expect(chasedPullRequests({ act: "bump", payload }).map((ref) => ref.url)).toEqual([PR]);
  });

  it("reads a scheme-qualified address whose host is percent-encoded, as the parser does", () => {
    const payload = { text: "please review https://%67ithub.com/acme/acme-admin/pull/18404" };
    expect(chasedPullRequests({ act: "bump", payload }).map((ref) => ref.url)).toEqual([PR]);
  });

  it("reads a scheme-less address whose host is percent-encoded, as the parser does", () => {
    const payload = { text: "please review %67ithub.com/acme/acme-admin/pull/18404" };
    expect(chasedPullRequests({ act: "bump", payload }).map((ref) => ref.url)).toEqual([PR]);
  });

  it("reads a scheme-less address with a port, which the parser would take for a scheme", () => {
    const payload = { text: "please review github.com:443/acme/acme-admin/pull/18404" };
    expect(chasedPullRequests({ act: "bump", payload }).map((ref) => ref.url)).toEqual([PR]);
  });

  it("reads a scheme-less github.com address in prose, which Slack links on its own", () => {
    const payload = {
      text: "see (github.com/acme/acme-admin/pull/18404) and www.github.com/acme/acme-admin/pull/18398.",
    };
    expect(chasedPullRequests({ act: "bump", payload }).map((ref) => ref.url)).toEqual([PR, OTHER]);
  });

  it("reads an address glued to the prose before it, which Slack links from where the address starts", () => {
    const payload = { text: `PR=${PR} and (see:github.com/acme/acme-admin/pull/18398)` };
    expect(chasedPullRequests({ act: "bump", payload }).map((ref) => ref.url)).toEqual([PR, OTHER]);
  });

  it("reads an address glued straight onto a letter, wherever in the token it starts", () => {
    const payload = { text: `please seex${PR} and prgithub.com/acme/acme-admin/pull/18398` };
    expect(chasedPullRequests({ act: "bump", payload }).map((ref) => ref.url)).toEqual([PR, OTHER]);
  });

  it("refuses an unreadable address once however many spellings of it the prose yields", () => {
    const payload = { text: "PR=http://github.com/acme/acme-admin/pull/latest" };
    expect(unnamedPullRequestLinks({ act: "bump", payload })).toEqual([
      "http://github.com/acme/acme-admin/pull/latest",
    ]);
  });

  it("names nothing for prose naming github.com with no pull request, or a lookalike host", () => {
    const payload = { text: "ops@github.com and github.com.example.org/acme/acme-admin/pull/18404" };
    expect(chasedPullRequests({ act: "bump", payload })).toEqual([]);
    expect(unnamedPullRequestLinks({ act: "bump", payload })).toEqual([]);
  });

  it("reads percent-encoded segments as GitHub's router decodes them", () => {
    const refs = chasedPullRequests({
      act: "bump",
      payload: payloadLinking({
        urls: [
          "https://github.com/acme/acme-admin/%70ull/18404",
          "https://github.com/acme/acme-%61dmin/pull/%31%38%33%39%38",
        ],
      }),
    });
    expect(refs.map((ref) => ref.url)).toEqual([PR, OTHER]);
  });

  it("leaves a malformed escape as written rather than throwing", () => {
    const links = unnamedPullRequestLinks({
      act: "bump",
      payload: payloadLinking({ urls: ["https://github.com/acme/acme-admin/pull/%E0%A4%A"] }),
    });
    expect(links).toEqual(["https://github.com/acme/acme-admin/pull/%E0%A4%A"]);
  });

  it("names nothing for a pull-request path on another host", () => {
    const refs = chasedPullRequests({
      act: "bump",
      payload: payloadLinking({ urls: ["https://gitlab.com/acme/acme-admin/pull/18404"] }),
    });
    expect(refs).toEqual([]);
  });

  it("names nothing for a github.com link that is not a pull request", () => {
    const refs = chasedPullRequests({
      act: "bump",
      payload: payloadLinking({
        urls: ["https://github.com/acme/acme-admin/issues/18404", "https://github.com/acme/acme-admin"],
      }),
    });
    expect(refs).toEqual([]);
  });

  it("judges a review ask exactly as a bump", () => {
    const refs = chasedPullRequests({ act: "review-ask", payload: payloadLinking({ urls: [PR] }) });
    expect(refs.map((ref) => ref.url)).toEqual([PR]);
  });

  it("names nothing for a reply, which may report a merge", () => {
    expect(chasedPullRequests({ act: "reply", payload: payloadLinking({ urls: [PR] }) })).toEqual([]);
  });

  it("names nothing for a row with no declared act", () => {
    expect(chasedPullRequests({ act: undefined, payload: payloadLinking({ urls: [PR] }) })).toEqual([]);
  });

  it("names nothing for a bump linking no pull request", () => {
    expect(chasedPullRequests({ act: "bump", payload: payloadLinking({ urls: [] }) })).toEqual([]);
  });
});

describe("unnamedPullRequestLinks", () => {
  it("names each github.com pull-request link whose number cannot be read, once", () => {
    const bad = "https://github.com/acme/acme-admin/pull/latest";
    const zero = "https://github.com/acme/acme-admin/pull/0";
    const links = unnamedPullRequestLinks({
      act: "bump",
      payload: payloadLinking({ urls: [bad, PR, zero, bad, "https://github.com/acme/acme-admin/pull"] }),
    });
    expect(links).toEqual([bad, zero, "https://github.com/acme/acme-admin/pull"]);
  });

  it("names nothing for a readable pull request, a non-pull path or another host", () => {
    const links = unnamedPullRequestLinks({
      act: "bump",
      payload: payloadLinking({
        urls: [PR, "https://github.com/acme/acme-admin/pulls", "https://gitlab.com/o/r/pull/latest"],
      }),
    });
    expect(links).toEqual([]);
  });

  it("names nothing for a reply", () => {
    const payload = payloadLinking({ urls: ["https://github.com/acme/acme-admin/pull/latest"] });
    expect(unnamedPullRequestLinks({ act: "reply", payload })).toEqual([]);
  });
});

describe("settledChaseRefusals", () => {
  const ref = parsePullRequestUrl({ url: PR })!;

  it("refuses a bump on a closed pull request, naming the link and how it ended", () => {
    const lines = settledChaseRefusals({ act: "bump", reads: [{ ref, state: { kind: "settled", state: "CLOSED" } }] });
    expect(lines).toEqual([ChaseSubjectErrors.settled({ act: "bump", state: "CLOSED", url: PR }).message]);
    expect(lines[0]).toContain(`links ${PR}, which GitHub says is already closed`);
  });

  it("refuses a review ask on a merged pull request", () => {
    const lines = settledChaseRefusals({
      act: "review-ask",
      reads: [{ ref, state: { kind: "settled", state: "MERGED" } }],
    });
    expect(lines[0]).toContain("this review-ask links");
    expect(lines[0]).toContain("already merged");
  });

  it("refuses a link GitHub says is not there", () => {
    const lines = settledChaseRefusals({ act: "bump", reads: [{ ref, state: { kind: "absent" } }] });
    expect(lines).toEqual([ChaseSubjectErrors.absent({ act: "bump", url: PR }).message]);
  });

  it("refuses rather than passes when the state could not be read", () => {
    const lines = settledChaseRefusals({ act: "bump", reads: [{ ref, state: { kind: "notChecked" } }] });
    expect(lines).toEqual([ChaseSubjectErrors.unread({ act: "bump", url: PR }).message]);
  });

  it("passes when every linked pull request is open", () => {
    expect(settledChaseRefusals({ act: "bump", reads: [{ ref, state: { kind: "open" } }] })).toEqual([]);
  });

  it("refuses one line per settled link and none for the open one beside it", () => {
    const other = parsePullRequestUrl({ url: OTHER })!;
    const lines = settledChaseRefusals({
      act: "bump",
      reads: [
        { ref, state: { kind: "settled", state: "CLOSED" } },
        { ref: other, state: { kind: "open" } },
      ],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(PR);
  });
});
