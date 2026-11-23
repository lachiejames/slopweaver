/**
 * Render one briefing as the PAGE FRAGMENT `page publish` freezes: each proposed write as a card that reads like
 * Linear's own issue view — key, title, state pill, the comment as it would sit in the activity feed — ranked
 * obvious first, with every coverage gap above the first card. Pure.
 *
 * A look close to Linear's native UI is nice, but content matters more. So the comment is shown as the exact markdown its verb sends, never paraphrased, and the look is one
 * small stylesheet. A fragment carrying its own `<style>` takes no house design (`skills/page/SKILL.md`), and it
 * carries no script, so the question and lean it marks stay readable by a card.
 */
import { escapeHtml } from "../../atlas/kit/pageTable.js";
import { linkifyText } from "../briefing/linkify.js";

import { orderedProposals } from "./briefingPlan.js";
import type {
  LinearBriefingCoverage,
  LinearBriefingForm,
  LinearBriefingIssueMove,
  LinearBriefingProposal,
  LinearBriefingTarget,
  LinearBriefingWrite,
} from "./briefingTypes.js";
import { commentDestination, type LinearCommentForm } from "./commentTypes.js";
import { renderCommentBody, renderDocumentCommentBody, renderProjectUpdateBody } from "./render.js";

const STYLE = `<style>
.lb{font:15px/1.55 Inter,-apple-system,"Segoe UI",sans-serif;color:#1f2023;background:#f7f8f9;margin:0;padding:32px 16px}
.lb main{max-width:min(88%,140ch);margin:0 auto}
.lb h1{font-size:26px;margin:0 0 6px}.lb h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#6b6f76;margin:28px 0 10px}
.lb .lede{font-size:17px;margin:0 0 10px}.lb .meta{color:#6b6f76;font-size:13px;margin:4px 0}
.lb .ask{background:#eef0fd;border-left:3px solid #5e6ad2;padding:10px 14px;border-radius:6px;margin:14px 0}
.lb .ask p{margin:2px 0}.lb ul.cov{list-style:none;padding:0;margin:0}.lb ul.cov li{font-size:13px;margin:3px 0}
.lb .gap{color:#b4232c;font-weight:600}.lb .ok{color:#2f7a3d}
.lb article{background:#fff;border:1px solid #e3e4e8;border-radius:10px;padding:14px 18px;margin:0 0 12px}
.lb .head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:12px;color:#6b6f76}
.lb .badge{border-radius:999px;padding:1px 9px;border:1px solid #d8dae0;background:#f4f5f8;color:#3c3f45}
.lb .high{background:#e6f4ea;border-color:#b9dfc4;color:#1e6b33}.lb .low{background:#fff4e0;border-color:#f1d29b;color:#8a5a00}
.lb h3{font-size:16px;margin:8px 0 4px;font-weight:600}.lb h3 a{color:#1f2023;text-decoration:none}
.lb .key{color:#6b6f76;font-weight:500;margin-right:6px}
.lb .pill{display:inline-block;font-size:12px;font-weight:500;border-radius:999px;padding:0 8px;background:#f0f1f4;border:1px solid #dcdee3;color:#3c3f45}
.lb .pill.to{background:#eef0fd;border-color:#c9cdf5;color:#3d48b0}
.lb .why{margin:6px 0}.lb .feed{border-left:2px solid #e3e4e8;margin:10px 0 6px;padding:2px 0 2px 14px}
.lb .who{font-size:12px;color:#6b6f76;margin:0}.lb .said{margin:2px 0 4px}
.lb details summary{cursor:pointer;font-size:12px;color:#5e6ad2}
.lb pre{white-space:pre-wrap;background:#f7f8f9;border:1px solid #eceef1;border-radius:6px;padding:10px;font-size:12.5px}
.lb ul.ev{margin:6px 0 0;padding-left:18px;font-size:13px}
</style>`;

/** A human date and time in the owner's zone; the page lint refuses a machine timestamp, and the owner reads this one. */
function humanInstant({ iso, zone }: { iso: string; zone: string }): string {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: zone,
    weekday: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/** A target as Linear titles it: the key, the title, both one link. */
function targetHeading({ target }: { target: LinearBriefingTarget }): string {
  const key =
    target.identifier === undefined ? "" : `<span class="key">${escapeHtml({ value: target.identifier })}</span>`;
  return `<a href="${escapeHtml({ value: target.url })}">${key}${escapeHtml({ value: target.title })}</a>`;
}

/** A state pill, or nothing when the state was not read. */
function pill({ state, to }: { state: string | undefined; to: boolean }): string {
  if (state === undefined) {
    return "";
  }
  return ` <span class="pill${to ? " to" : ""}">${escapeHtml({ value: state })}</span>`;
}

/**
 * An inline markdown link with an address a reader can open: the only markdown Linear renders inside one line.
 * The address admits one level of balanced parentheses, as markdown does; stopping at the first `)` left the
 * rest of a Wikipedia-style address on the page as visible text . It refuses a
 * quote or angle bracket, as `linkifyText`'s bare-URL pattern does: escaped, one still decodes into the href.
 * A label holds no `[`, so a stray bracket before a link stays text where it was rather than opening the label,
 * and a backslash-escaped `\[` opens nothing. This is a preview, not a CommonMark renderer: what it does not
 * read as a link it shows verbatim, every character once and in order.
 */
const MARKDOWN_LINK = /(?<!\\)\[([^[\]\n]+)\]\((https?:\/\/(?:[^\s()<>"']|\([^\s()<>"']*\))+)\)/g;

/**
 * A summary line drawn the way Linear's feed shows it: each `[label](url)` becomes a link reading `label`, a bare
 * URL becomes a link, everything else escaped. Escaped verbatim, a composer's markdown link showed as raw
 * brackets and an address to copy, and `page publish` refused the page for it. The `<pre>` beneath still shows the exact markdown sent.
 */
function feedLine({ markdown }: { markdown: string }): string {
  let out = "";
  let cursor = 0;
  for (const match of markdown.matchAll(MARKDOWN_LINK)) {
    out += linkifyText({ text: markdown.slice(cursor, match.index) });
    out += `<a href="${escapeHtml({ value: match[2]! })}">${escapeHtml({ value: match[1]! })}</a>`;
    cursor = match.index + match[0].length;
  }
  return out + linkifyText({ text: markdown.slice(cursor) });
}

/** A comment as it would sit in the activity feed: the visible line, then the exact markdown sent. */
function commentFeed({ comment }: { comment: LinearCommentForm }): string {
  const body =
    commentDestination({ fields: comment.fields }).kind === "issue"
      ? renderCommentBody({ artifact: comment.artifact })
      : renderDocumentCommentBody({ artifact: comment.artifact });
  return (
    `<div class="feed"><p class="who">Your comment</p><p class="said">${feedLine({ markdown: comment.artifact.summary })}</p>` +
    `<details><summary>Exactly what Linear receives</summary><pre>${escapeHtml({ value: body })}</pre></details></div>`
  );
}

/** A move's line: where the issue goes. */
function moveLine({ move, backlog }: { move: LinearBriefingIssueMove; backlog: boolean }): string {
  const rest = backlog ? ", out of the cycle and unassigned" : "";
  return `<p class="said">Moves to${pill({ state: move.toState, to: true })}${rest}</p>`;
}

/** What one write does, drawn the way Linear would show its result. */
function writeBody({ write }: { write: LinearBriefingWrite }): string {
  switch (write.kind) {
    case "comment":
      return commentFeed({ comment: write.comment });
    case "state-change":
      return moveLine({ backlog: false, move: write });
    case "stale-to-backlog":
      return moveLine({ backlog: true, move: write });
    case "project-update": {
      const body = renderProjectUpdateBody({ artifact: write.update.artifact });
      return (
        `<div class="feed"><p class="who">Project update${pill({ state: write.update.fields.health, to: true })}</p>` +
        `<p class="said">${feedLine({ markdown: write.update.artifact.summary })}</p>` +
        `<details><summary>Exactly what Linear receives</summary><pre>${escapeHtml({ value: body })}</pre></details></div>`
      );
    }
    case "superseded": {
      const edge =
        write.relation === undefined
          ? ""
          : `<p class="said">Links it as <code>${escapeHtml({ value: write.relation.fields.type })}</code></p>`;
      const close = write.close === undefined ? "" : moveLine({ backlog: false, move: write.close });
      return `<p class="said">Superseded by ${targetHeading({ target: write.by })}</p>${commentFeed({ comment: write.comment })}${edge}${close}`;
    }
    default: {
      const unreachable: never = write;
      return unreachable;
    }
  }
}

/** The label a kind wears on its card. */
const KIND_LABEL: Readonly<Record<LinearBriefingWrite["kind"], string>> = {
  comment: "Comment",
  "project-update": "Project update",
  "stale-to-backlog": "Back to backlog",
  "state-change": "State change",
  superseded: "Superseded",
};

/** One proposal's card. */
function proposalCard({ proposal }: { proposal: LinearBriefingProposal }): string {
  const rank = proposal.confidence === "high" ? "Obvious" : "Less obvious";
  const evidence = proposal.evidence
    .map((link) => `<li><a href="${escapeHtml({ value: link.url })}">${escapeHtml({ value: link.label })}</a></li>`)
    .join("");
  return [
    "<article>",
    `<div class="head"><span class="badge ${proposal.confidence}">${rank}</span>`,
    `<span class="badge">${KIND_LABEL[proposal.write.kind]}</span><code>${escapeHtml({ value: proposal.id })}</code></div>`,
    `<h3>${targetHeading({ target: proposal.target })}${pill({ state: proposal.target.state, to: false })}</h3>`,
    `<p class="why">${escapeHtml({ value: proposal.why })}</p>`,
    writeBody({ write: proposal.write }),
    `<ul class="ev">${evidence}</ul>`,
    "</article>",
  ].join("\n");
}

/** The coverage list, every gap first: an unread source is the first thing to doubt. */
function coverageList({ coverage }: { coverage: readonly LinearBriefingCoverage[] }): string {
  const ordered = [...coverage.filter((entry) => !entry.read), ...coverage.filter((entry) => entry.read)];
  const rows = ordered.map((entry) => {
    const mark = entry.read ? '<span class="ok">read</span>' : '<span class="gap">NOT READ</span>';
    return `<li>${mark} · <strong>${escapeHtml({ value: entry.source })}</strong> · ${escapeHtml({ value: entry.note })}</li>`;
  });
  return `<ul class="cov">${rows.join("")}</ul>`;
}

/** One ranked group, or nothing when it is empty. */
function group({ title, proposals }: { title: string; proposals: readonly LinearBriefingProposal[] }): string {
  if (proposals.length === 0) {
    return "";
  }
  return `<section><h2>${title}</h2>\n${proposals.map((proposal) => proposalCard({ proposal })).join("\n")}\n</section>`;
}

/** "1 write" or "3 writes". */
function writes({ count }: { count: number }): string {
  return count === 1 ? "1 write" : `${String(count)} writes`;
}

/**
 * Render the briefing page fragment.
 *
 * @param form the validated briefing
 * @returns the fragment `page publish` wraps and freezes: a title, a stylesheet and the content
 */
export function renderLinearBriefingPage({ form }: { form: LinearBriefingForm }): string {
  const ordered = orderedProposals({ proposals: form.proposals });
  const high = ordered.filter((proposal) => proposal.confidence === "high");
  const low = ordered.filter((proposal) => proposal.confidence === "low");
  const gaps = form.coverage.filter((entry) => !entry.read).length;
  const since =
    form.evidenceSinceIso === null
      ? "the whole corpus, because no briefing has been applied in full yet"
      : `everything since ${humanInstant({ iso: form.evidenceSinceIso, zone: form.zone })}, when Linear last matched`;
  const lede =
    ordered.length === 0
      ? "Nothing to write. Linear already matches everything read."
      : `${writes({ count: ordered.length })} would make Linear match reality: ${String(high.length)} obvious, ${String(low.length)} less obvious.`;
  const gapLine =
    gaps === 0
      ? ""
      : `<p class="meta gap">${String(gaps)} source(s) not read, so this briefing may be missing writes.</p>`;
  return [
    `<title>Linear briefing, ${escapeHtml({ value: humanInstant({ iso: form.asOfIso, zone: form.zone }) })}</title>`,
    STYLE,
    '<div class="lb"><main>',
    "<h1>Linear briefing</h1>",
    `<p class="lede">${lede}</p>`,
    '<div class="ask">',
    `<p data-card="question">Should I make ${writes({ count: ordered.length })} in Linear, all of them, the obvious ones, or the ones you name?</p>`,
    `<p data-card="lean">${escapeHtml({ value: form.lean })}</p>`,
    "</div>",
    `<p class="meta">Composed ${escapeHtml({ value: humanInstant({ iso: form.asOfIso, zone: form.zone }) })}. Evidence read: ${escapeHtml({ value: since })}.</p>`,
    gapLine,
    `<section><h2>What was read</h2>${coverageList({ coverage: form.coverage })}</section>`,
    group({ proposals: high, title: "Obvious" }),
    group({ proposals: low, title: "Less obvious" }),
    "</main></div>",
    "",
  ].join("\n");
}
