/**
 * The atlas page's own stylesheet, apart from the markup `./pageHtml.ts` renders: a page's look and its
 * content change for different reasons, and neither should have to be read to change the other.
 */

/**
 * The page's own stylesheet, and the one external request it makes.
 *
 * IBM Plex is the deliberate choice rather than a system stack: an atlas is a measuring instrument, and Plex
 * was drawn for exactly that register — Sans for the prose, Mono for the endpoints, provider ids and digests
 * that make up most of what is on the page. `fonts.googleapis.com` is the one stylesheet host an artifact
 * may reach, and every face has a real fallback, so a page opened offline or inside a stricter sandbox is
 * plainer and never broken.
 *
 * Everything else is inline. No script, no CDN, no chart library — the page is a table of what a sync
 * already stored, and a library would be one more thing between a reader and a defect.
 *
 * @returns the head content that styles the page
 */
export function atlasPageStyle(): string {
  return (
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&' +
    'family=IBM+Plex+Sans:wght@400;500;600&display=swap">' +
    "<style>" +
    themeTokens() +
    layoutRules()
  );
}

/**
 * The colour and type tokens, in all three theme states an artifact viewer can be in.
 *
 * Every token is declared on bare `:root` first; the two dark blocks redefine the same names and nothing
 * else, so a colour whose only definition sat behind a media query — the classic unreadable-artifact bug —
 * cannot exist here.
 *
 * @returns the token declarations
 */
function themeTokens(): string {
  return (
    ":root{--bg:#f7f8fa;--fg:#16181d;--muted:#646a7a;--line:#dfe2ea;--card:#fff;--bad:#a8202c;" +
    "--badbg:#fceff0;--ok:#1f6b52;--warn:#8a5a00;--accent:#4a45c9;" +
    "--sans:'IBM Plex Sans',ui-sans-serif,-apple-system,'Segoe UI',Roboto,sans-serif;" +
    "--mono:'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,monospace}" +
    ':root:not([data-theme="light"]){color-scheme:light}' +
    '@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111318;--fg:#e9ebf2;' +
    "--muted:#9098aa;--line:#2b2f3a;--card:#181b22;--bad:#ff8b93;--badbg:#3a1a20;--ok:#6fd3ac;" +
    "--warn:#e0a94a;--accent:#a8a2ff;color-scheme:dark}}" +
    '[data-theme="dark"]{--bg:#111318;--fg:#e9ebf2;--muted:#9098aa;--line:#2b2f3a;--card:#181b22;' +
    "--bad:#ff8b93;--badbg:#3a1a20;--ok:#6fd3ac;--warn:#e0a94a;--accent:#a8a2ff;color-scheme:dark}"
  );
}

/**
 * Everything that is not a token: the page's layout, its tables, its disclosures and its severity stripes.
 *
 * @returns the style rules, which read every colour through a token rather than a literal
 */
function layoutRules(): string {
  return (
    "body{background:var(--bg);color:var(--fg);font:15px/1.55 var(--sans);margin:0;padding:28px 20px 80px}" +
    "main{max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:14px}" +
    "h1{font-size:27px;margin:0 0 4px;letter-spacing:-.015em;font-weight:600;text-wrap:balance}" +
    "h2{font-size:15px;margin:0 0 8px;font-weight:600;letter-spacing:-.005em}" +
    "header{display:flex;flex-direction:column;gap:10px}" +
    ".lede{margin:0;color:var(--muted);max-width:68ch}" +
    ".scope{margin:0;font-size:13px;color:var(--muted);max-width:78ch}" +
    "code{font:12.5px/1.45 var(--mono);word-break:break-word}" +
    ".scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}" +
    "table{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}" +
    "th,td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top}" +
    "thead th{position:sticky;top:0;background:var(--bg);font-size:11px;text-transform:uppercase;" +
    "letter-spacing:.08em;font-weight:500;color:var(--muted)}" +
    "table.facts th{width:180px;color:var(--muted);font-weight:400}" +
    ".chips{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:8px;align-items:start;margin:4px 0 6px}" +
    ".chip{border:1px solid var(--line);border-left:3px solid var(--line);border-radius:6px;" +
    "padding:9px 12px;background:var(--card)}" +
    ".chip.bad{border-color:var(--line);border-left-color:var(--bad);background:var(--badbg)}" +
    ".chip.unknown{border-color:var(--line);border-left-color:var(--warn);background:var(--card)}" +
    ".chip.ok{border-left-color:var(--ok)}" +
    ".chip-count{display:block;font:600 23px/1.1 var(--mono);font-variant-numeric:tabular-nums}" +
    ".chip.bad .chip-count{color:var(--bad)}.chip.ok .chip-count{color:var(--ok)}" +
    ".chip.unknown .chip-count{color:var(--warn)}" +
    ".chip-label{display:block;font-size:12px;color:var(--muted);margin-top:2px}" +
    ".chip-detail{display:block;font-size:11px;color:var(--muted);margin-top:5px;word-break:break-word}" +
    ".panel{border:1px solid var(--line);border-radius:8px;padding:16px;background:var(--card)}" +
    ".panel.bad-panel{border-color:var(--bad);border-left:3px solid var(--bad);background:var(--badbg)}" +
    ".verdict{font-size:15px;font-weight:600;margin:0 0 8px;text-wrap:balance}" +
    ".muted{color:var(--muted);font-size:12.5px}" +
    "details{border:1px solid var(--line);border-radius:8px;background:var(--card);padding:0 14px}" +
    "details>summary{cursor:pointer;padding:11px 0;font-weight:500;font-size:14px}" +
    "details[open]>summary{border-bottom:1px solid var(--line);margin-bottom:10px}" +
    "details details{margin:0 0 8px}" +
    "tr.bad-row td{background:var(--badbg)}" +
    ":focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}" +
    ".shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;" +
    "padding-bottom:12px}" +
    ".shot{margin:0}.shot img{width:100%;border:1px solid var(--line);border-radius:6px;display:block}" +
    ".noshot{border:1px dashed var(--line);border-radius:6px;padding:20px 10px;font-size:12px;" +
    "color:var(--muted);word-break:break-word}" +
    ".noshot.broken{border-color:var(--bad);color:var(--bad);border-style:solid}" +
    "figcaption{font-size:11px;color:var(--muted);margin-top:6px;word-break:break-word;line-height:1.45}" +
    "a{color:var(--accent)}footer{font-size:12px;color:var(--muted);max-width:78ch}" +
    "</style>"
  );
}
