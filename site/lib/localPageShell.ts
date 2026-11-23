/**
 * The console's copy of the local page shell, so a page published before the house design opens from the Queue
 * in it — the 70 bare pages on disk, among them one the owner likened to an internal uni webpage from the 80s.
 *
 * Why the shell carries a design, and how it leaves an authored page's look alone, is `src/pages/shell.ts`'s
 * header. The constants below are that module's, RESTATED because `src/` and `site/` may not import each other;
 * `site/__tests__/unit/localPageShell.test.ts` asserts both copies are equal, byte for byte, so they cannot drift.
 * Re-wrapping at serve time rather than republishing keeps every frozen page's bytes and hash as they were.
 *
 * Pure: strings in, strings out.
 */

/** The doctype and the two metas every shell has opened with, before its stylesheet. */
const DOCUMENT_HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">';

/** Where a shell's head ends and the page's own first byte begins, in every shell this module has written. */
const BODY_OPENS = "</style></head><body>";

/**
 * The shell claude.ai wrapped around every artifact, and the one every page published before the house design
 * carries: the doctype, the two metas and the five-rule reset.
 *
 * {@link houseStyledPage} recognises it and re-wraps the fragment inside it in the current shell.
 */
export const PLATFORM_SHELL_OPEN =
  `${DOCUMENT_HEAD}<style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,` +
  "BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}" +
  `[hidden]:not([hidden=until-found i]){display:none!important}${BODY_OPENS}`;

/**
 * Matches a body whose fragment brought its own design: an inline `<style>` that is not correction chrome, or
 * a linked stylesheet. Inside `:where()` wherever it is used, so it adds no specificity.
 */
const AUTHORED_BODY = ':has(style:not([data-corr-style]), link[rel~="stylesheet"])';

/**
 * The platform reset, applied only to an authored page — at the specificity it always had, so an authored
 * page renders exactly as it did under {@link PLATFORM_SHELL_OPEN}.
 */
const AUTHORED_RESET =
  ":root{color-scheme:light}" +
  `body:where(${AUTHORED_BODY}){margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;` +
  "background:#faf9f5;color:#141413}img{max-width:100%}" +
  "[hidden]:not([hidden=until-found i]){display:none!important}";

/**
 * The house design: every rule nested under a body that brought NO design of its own, inside one cascade
 * layer.
 */
const HOUSE_STYLESHEET = `@layer house {
:root {
  --sw-ground: #faf9f5; --sw-panel: #ffffff; --sw-soft: #f3f0e8; --sw-rule: #e6e1d6;
  --sw-ink: #1f1e1b; --sw-ink-2: #46443e; --sw-muted: #6b6962;
  --sw-accent: #d97757; --sw-accent-ink: #a64d2c; --sw-link: #2a5db0;
  --sw-ok: #2e7d4f; --sw-ok-soft: #e7f2ea; --sw-warn: #9a5b0c; --sw-warn-soft: #f8eedb; --sw-bad: #b3261e; --sw-bad-soft: #fae6e3;
  --sw-serif: "Iowan Old Style", Charter, "Palatino Linotype", Palatino, Georgia, serif;
  --sw-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --sw-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --sw-radius: 12px;
  --sw-lift: 0 1px 2px rgb(31 30 27 / 5%), 0 10px 30px -14px rgb(31 30 27 / 22%);
}
:where(body:not(${AUTHORED_BODY})) {
margin: 0;
padding: clamp(2.5rem, 6vw, 5rem) max(6%, 1.25rem, calc((100% - 140ch) / 2)) 7rem;
background: radial-gradient(1100px 380px at 50% -140px, #f2e6d8, rgb(242 230 216 / 0%) 72%) no-repeat, var(--sw-ground);
color: var(--sw-ink);
font: 17px/1.65 var(--sw-sans);
-webkit-font-smoothing: antialiased;
overflow-wrap: break-word;
& img, & video, & svg { max-width: 100%; height: auto; }
& h1, & h2, & h3, & h4 { color: var(--sw-ink); text-wrap: balance; scroll-margin-top: 1.5rem; }
& h1 { font: 600 clamp(2.1rem, 1.3rem + 2.6vw, 3.2rem)/1.08 var(--sw-serif); letter-spacing: -0.018em; margin: 0 0 1.1rem; }
& h1 + p, & .lede { font-size: 1.24rem; line-height: 1.55; color: var(--sw-ink-2); margin: 0 0 1.5rem; max-width: 46em; }
& h2 { position: relative; font: 600 1.65rem/1.2 var(--sw-serif); letter-spacing: -0.01em; margin: 3.5rem 0 1rem; padding-top: 1.6rem; border-top: 1px solid var(--sw-rule); }
& h2::before { content: ""; position: absolute; top: -2px; left: 0; width: 2.75rem; height: 3px; border-radius: 3px; background: var(--sw-accent); }
& h3 { font: 650 1.12rem/1.35 var(--sw-sans); margin: 2.2rem 0 .5rem; }
& h4 { font: 650 .78rem/1.3 var(--sw-sans); letter-spacing: .08em; text-transform: uppercase; color: var(--sw-muted); margin: 1.8rem 0 .4rem; }
& p { margin: .9rem 0; }
& ul, & ol { margin: .9rem 0; padding-left: 1.35rem; }
& li + li { margin-top: .45rem; }
& li::marker { color: var(--sw-accent); }
& strong, & b { font-weight: 650; }
& a { color: var(--sw-link); text-decoration-thickness: 1px; text-underline-offset: 3px; text-decoration-color: rgb(42 93 176 / 40%); }
& a:hover { text-decoration-color: currentColor; }
& hr { border: 0; height: 1px; background: var(--sw-rule); margin: 3rem 0; }
& mark { background: #fbe9a8; padding: 0 .15em; border-radius: 3px; }
& code, & kbd, & samp { font-family: var(--sw-mono); font-size: .84em; }
& code { background: var(--sw-soft); border: 1px solid var(--sw-rule); border-radius: 6px; padding: .08em .38em; overflow-wrap: anywhere; }
& kbd { border: 1px solid var(--sw-rule); border-bottom-width: 2px; border-radius: 5px; padding: 0 .35em; background: var(--sw-panel); }
& pre { background: var(--sw-soft); border: 1px solid var(--sw-rule); border-radius: var(--sw-radius); padding: 1rem 1.15rem; font: .84rem/1.6 var(--sw-mono); white-space: pre-wrap; overflow-wrap: anywhere; margin: 1.25rem 0; }
& pre code { background: none; border: 0; padding: 0; font-size: inherit; }
& table { width: 100%; margin: 1.6rem 0; border-collapse: separate; border-spacing: 0; background: var(--sw-panel); border: 1px solid var(--sw-rule); border-radius: var(--sw-radius); box-shadow: var(--sw-lift); font-size: .95rem; font-variant-numeric: tabular-nums; }
& th, & td { padding: .7rem 1rem; text-align: left; vertical-align: top; }
& thead th { background: var(--sw-soft); color: var(--sw-muted); font: 650 .74rem/1.3 var(--sw-sans); letter-spacing: .06em; text-transform: uppercase; border-bottom: 1px solid var(--sw-rule); }
& thead th:first-child { border-top-left-radius: var(--sw-radius); }
& thead th:last-child { border-top-right-radius: var(--sw-radius); }
& tbody tr + tr > * { border-top: 1px solid var(--sw-rule); }
@media (max-width: 40rem) { & table { display: block; overflow-x: auto; } & :is(th, td) { min-width: 9ch; } & :is(th, td) code { white-space: nowrap; overflow-wrap: normal; } }
& figure { margin: 2.2rem 0; }
& figure img, & figure video, & figure svg { display: block; border: 1px solid var(--sw-rule); border-radius: var(--sw-radius); background: var(--sw-panel); box-shadow: var(--sw-lift); }
& figcaption { margin-top: .75rem; font-size: .9rem; line-height: 1.5; color: var(--sw-muted); }
& blockquote { margin: 1.6rem 0; padding: 1.1rem 1.4rem; background: var(--sw-panel); border: 1px solid var(--sw-rule); border-left: 4px solid var(--sw-accent); border-radius: var(--sw-radius); font: 1.12rem/1.55 var(--sw-serif); }
& blockquote > :first-child { margin-top: 0; }
& blockquote > :last-child { margin-bottom: 0; }
& blockquote cite, & blockquote footer { display: block; margin-top: .6rem; font: .85rem/1.4 var(--sw-sans); font-style: normal; color: var(--sw-muted); }
& details { margin: 1.25rem 0; background: var(--sw-panel); border: 1px solid var(--sw-rule); border-radius: var(--sw-radius); }
& summary { cursor: pointer; padding: .85rem 1.15rem; font-weight: 600; }
& summary::marker { color: var(--sw-accent); }
& details > :not(summary) { margin-inline: 1.15rem; }
& details[open] > :last-child { margin-bottom: 1rem; }
& .eyebrow, & .kicker { font: 650 .76rem/1.3 var(--sw-sans); letter-spacing: .14em; text-transform: uppercase; color: var(--sw-accent-ink); margin: 0 0 .9rem; }
& .meta, & .muted, & .small, & small { color: var(--sw-muted); }
& .meta { font-size: .92rem; }
& .small, & small { font-size: .88rem; }
& .callout { margin: 1.6rem 0; padding: 1rem 1.25rem; background: var(--sw-panel); border: 1px solid var(--sw-rule); border-left: 4px solid var(--sw-accent); border-radius: var(--sw-radius); }
& .callout.ok { background: var(--sw-ok-soft); border-left-color: var(--sw-ok); }
& .callout.warn { background: var(--sw-warn-soft); border-left-color: var(--sw-warn); }
& .callout.bad { background: var(--sw-bad-soft); border-left-color: var(--sw-bad); }
& .callout > :first-child, & .card > :first-child, & .stat > :first-child { margin-top: 0; }
& .callout > :last-child, & .card > :last-child, & .stat > :last-child { margin-bottom: 0; }
& .cards, & .stats { display: grid; gap: 1rem; margin: 1.6rem 0; }
& .cards { grid-template-columns: repeat(auto-fit, minmax(min(16rem, 100%), 1fr)); }
& .stats { grid-template-columns: repeat(auto-fit, minmax(min(11rem, 100%), 1fr)); }
& .card, & .stat { background: var(--sw-panel); border: 1px solid var(--sw-rule); border-radius: var(--sw-radius); padding: 1.1rem 1.25rem; box-shadow: var(--sw-lift); }
& .stat .k { display: block; font: 650 .74rem/1.3 var(--sw-sans); letter-spacing: .08em; text-transform: uppercase; color: var(--sw-muted); margin-bottom: .35rem; }
& .stat .v { display: block; font: 600 2.1rem/1.1 var(--sw-serif); font-variant-numeric: tabular-nums; }
& .stat .d { display: block; font-size: .9rem; color: var(--sw-ink-2); margin-top: .35rem; }
& .tag, & .pill { display: inline-block; font-size: .78rem; line-height: 1.5; padding: 0 .6rem; border-radius: 999px; background: var(--sw-soft); border: 1px solid var(--sw-rule); color: var(--sw-ink-2); }
}
}`;

/** Everything before the page's own first byte: the doctype, the two metas, the reset and the house design. */
export const SHELL_OPEN = `${DOCUMENT_HEAD}<style>${AUTHORED_RESET}\n${HOUSE_STYLESHEET}${BODY_OPENS}`;

/** Everything after the page's own last byte. */
export const SHELL_CLOSE = "</body></html>";

/**
 * The correction chrome `briefing corrections` once stamped BEFORE a whole page's doctype — which also threw the
 * page into quirks mode. Only ever leading, and only ever one.
 */
const LEADING_CORRECTION_STYLE = /^<style data-corr-style="1">[\s\S]*?<\/style>\n?/u;

/**
 * The page the console serves for a published `index.html`: the same fragment, in the CURRENT shell.
 *
 * A page published before the house design opens with {@link PLATFORM_SHELL_OPEN}; re-wrapped, it reads in the
 * house design when its author wrote no stylesheet, and renders exactly as it always did when its author did —
 * the current shell decides that in CSS, so nothing here classifies the fragment. Correction chrome stamped ahead
 * of the doctype is moved inside the body, where it was always meant to sit. A page already in the current shell,
 * or a document of any shape this module does not recognise, is returned byte for byte.
 *
 * The frozen file on disk is never touched: this is a presentation of it, and a card mark or a correction compare
 * still reads the bytes that were published.
 *
 * @param html the published page, as read off disk
 * @returns the document to serve
 */
export function houseStyledPage({ html }: { html: string }): string {
  const stamped = LEADING_CORRECTION_STYLE.exec(html);
  const chrome = stamped === null ? "" : stamped[0];
  const shelled = html.slice(chrome.length);
  if (!shelled.endsWith(SHELL_CLOSE)) {
    return html;
  }
  const end = shelled.length - SHELL_CLOSE.length;
  if (shelled.startsWith(SHELL_OPEN) && end >= SHELL_OPEN.length) {
    return stamped === null ? html : `${SHELL_OPEN}${chrome}${shelled.slice(SHELL_OPEN.length)}`;
  }
  if (shelled.startsWith(PLATFORM_SHELL_OPEN) && end >= PLATFORM_SHELL_OPEN.length) {
    return `${SHELL_OPEN}${chrome}${shelled.slice(PLATFORM_SHELL_OPEN.length)}`;
  }
  return html;
}
