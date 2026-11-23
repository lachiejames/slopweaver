/**
 * THE DOCUMENT SHELL — the doctype, the head and the HOUSE STYLESHEET every local page is wrapped in, so a
 * page the owner opens reads like a designed Claude artifact rather than a bare webpage.
 *
 * ## Why a local page needs this at all
 *
 * Pages here are authored as bare FRAGMENTS: a `<title>`, optionally a `<style>`, then the content. There is
 * no doctype, no `<html>`, no `<head>` and no `<body>`, because the Artifact tool supplied all four. A
 * fragment written straight to a file is not a document — a browser parses it in quirks mode and the page
 * renders wrong while looking like it was saved correctly — so this module puts the document back.
 *
 * ## Why the shell carries a design, not only a reset
 *
 * The first shell was claude.ai's own wrapper, byte for byte ({@link PLATFORM_SHELL_OPEN}; measured off the wire at 368 bytes): a charset and viewport meta plus a five-rule
 * reset — zero body margin, a 14px system font on an off-white ground. On claude.ai the LOOK came from the
 * model authoring a stylesheet for every page, so a page whose author wrote none got the reset alone.
 *
 * Such a page opened from the Queue ran its text at close to full screen width with no margin, like an
 * internal webpage, where a Claude artifact reads as a landing page built as an experience. The owner moved off
 * artifacts on the promise a local file could look exactly like one. MEASURED:
 * 70 of the 425 pages under `$SLOPWEAVER_HOME/pages` carried no stylesheet of their own
 * (repro: `grep -rc "<style" ~/.slopweaver/pages --include=index.html | grep -c ":1$"`).
 *
 * So the shell supplies the look whenever the fragment supplies only the words:
 *
 * - **Two looks, chosen by the page itself.** A fragment that brings its own `<style>` or stylesheet link was
 *   designed by its author, and gets exactly the platform reset it always had. A fragment that brings none
 *   gets the house design. The choice is a CSS `:has()` over the body ({@link AUTHORED_BODY}), not a parse
 *   at publish time, so one shell serves both and a reader re-wrapping an old page needs no classifier. The
 *   correction chrome `briefing corrections` stamps (`data-corr-style`) is not an author's design and does
 *   not count; a `<style>` inside a `<template>` is not rendered and does not count either.
 * - **A reading column, never wall to wall.** The body's own padding centres the content at the measure the owner
 *   ruled for the fleet briefing — 88% of the window, at most 140ch (a 50% column feels too skinny).
 * - **A hero, then sections.** A serif display title, the paragraph under it set as a lede, every `h2` a new
 *   section with a rule and an accent mark; tables, figures, quotes and folds as cards. The classes an author
 *   may reach for without writing CSS are listed in `skills/page/reference/house-style.md`.
 * - **Layered under everything.** The house design sits in `@layer house`, so the correction chrome and any
 *   inline `style` attribute beat it whatever their specificity.
 * - **Nothing off the machine.** System font stacks only — no web font request — because every page is a
 *   local file.
 * - **No motion.** A scroll-driven reveal would leave everything below the fold transparent in a full-page
 *   capture, and a capture is how a page is proved before the owner opens it.
 *
 * Pure — constants and string work. No I/O, no clock.
 */

/** The doctype and the two metas every shell has opened with, before its stylesheet. */
const DOCUMENT_HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">';

/** Where a shell's head ends and the page's own first byte begins, in every shell this module has written. */
const BODY_OPENS = "</style></head><body>";

/**
 * The shell claude.ai wrapped around every artifact, and the one every page published before the house shell
 * carries: the doctype, the two metas and the five-rule reset.
 *
 * Kept byte for byte because pages on disk open with it — {@link unwrapPageFragment} recognises it, and the
 * console re-wraps a page in it under the current shell. Written as ONE line with no whitespace between tags
 * because that is what was measured off the wire.
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

/** What the shell costs a page, in bytes. */
export const SHELL_BYTES = Buffer.byteLength(SHELL_OPEN) + Buffer.byteLength(SHELL_CLOSE);

/**
 * Wrap one authored fragment in the document shell, changing not one byte of the fragment itself.
 *
 * The fragment is passed through verbatim — not trimmed, not re-indented, not escaped. A publisher that
 * "tidied" it would be editing the page, and the whole reason the freeze exists is that a later correction
 * diffs against bytes nobody touched.
 *
 * @param fragment the page as its author wrote it, with no doctype, `<html>`, `<head>` or `<body>` of its own
 * @returns the complete document
 */
export function wrapPageFragment({ fragment }: { fragment: string }): string {
  return `${SHELL_OPEN}${fragment}${SHELL_CLOSE}`;
}

/**
 * The authored fragment inside a published page, and whether the shell around it is the current one.
 *
 * A page is recognised only when it opens with {@link PLATFORM_SHELL_OPEN} or {@link SHELL_OPEN} exactly and
 * ends with {@link SHELL_CLOSE}; anything else is not a page this module shelled, and is answered with
 * `undefined` rather than a guess.
 *
 * @param html a whole published page, as read off disk
 * @returns the fragment byte for byte and which shell held it, or `undefined` for a document of any other shape
 */
export function unwrapPageFragment({
  html,
}: {
  html: string;
}): { fragment: string; shell: "house" | "platform" } | undefined {
  if (!html.endsWith(SHELL_CLOSE)) {
    return undefined;
  }
  const end = html.length - SHELL_CLOSE.length;
  if (html.startsWith(SHELL_OPEN) && end >= SHELL_OPEN.length) {
    return { fragment: html.slice(SHELL_OPEN.length, end), shell: "house" };
  }
  if (html.startsWith(PLATFORM_SHELL_OPEN) && end >= PLATFORM_SHELL_OPEN.length) {
    return { fragment: html.slice(PLATFORM_SHELL_OPEN.length, end), shell: "platform" };
  }
  return undefined;
}
