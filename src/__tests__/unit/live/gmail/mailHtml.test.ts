/**
 * Unit: a received mail's HTML becomes one inert document — nothing runs, nothing is fetched, nothing navigates — while
 * the layout the sender built from tables, text and inline style survives.
 *
 * Every body here is synthetic and hostile on purpose.
 */
import { describe, expect, it } from "vitest";

import { sanitizeInlineStyle, sanitizeStyleBlock } from "../../../../live/gmail/mailCss.js";
import { MAIL_DOCUMENT_CSP, sanitizeMailHtml } from "../../../../live/gmail/mailHtml.js";

/** The sanitised body's inner HTML, which is what every case below is about. */
function bodyOf({ html }: { html: string }): string {
  const { document } = sanitizeMailHtml({ html });
  return document.slice(document.indexOf("<body>") + "<body>".length, document.lastIndexOf("</body>"));
}

/** The document's head, where the policy and the kept style blocks sit. */
function headOf({ html }: { html: string }): string {
  const { document } = sanitizeMailHtml({ html });
  return document.slice(document.indexOf("<head>"), document.indexOf("</head>"));
}

describe("sanitizeMailHtml — what is kept", () => {
  it("keeps a table layout with its legacy attributes and safe inline style", () => {
    const html =
      '<table width="600" cellpadding="0" bgcolor="#fff"><tr><td align="center" style="color: #333; padding: 4px">' +
      "<h1>State store moving</h1><p>On <b>12 Oct</b></p></td></tr></table>";
    expect(bodyOf({ html })).toBe(
      '<table width="600" cellpadding="0" bgcolor="#fff"><tbody><tr><td align="center" style="color: #333; ' +
        'padding: 4px"><h1>State store moving</h1><p>On <b>12 Oct</b></p></td></tr></tbody></table>',
    );
  });

  it("writes the policy into the head and no meta, base or title from the mail", () => {
    const html =
      '<html><head><meta http-equiv="refresh" content="0;url=https://x.test"><base href="https://x.test/">' +
      "<title>t</title></head><body>hi</body></html>";
    const head = headOf({ html });
    expect(head).toContain(`<meta http-equiv="Content-Security-Policy" content="${MAIL_DOCUMENT_CSP}">`);
    expect([head.includes("refresh"), head.includes("<base"), head.includes("<title")]).toEqual([false, false, false]);
    expect(bodyOf({ html })).toBe("hi");
  });

  it("keeps a safe head style block and drops one that fetches", () => {
    const html =
      "<html><head><style>td{color:red}</style><style>td{background:url(https://x.test/a.png)}</style></head>" +
      "<body>x</body></html>";
    const head = headOf({ html });
    expect(head).toContain("<style>td{color:red}</style>");
    expect(head.includes("x.test")).toBe(false);
  });

  it("keeps a base64 raster data image and its size", () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="logo" width="10">';
    expect(bodyOf({ html })).toBe('<img src="data:image/png;base64,iVBORw0KGgo=" alt="logo" width="10">');
  });

  it("escapes text so a decoded entity never becomes markup", () => {
    expect(bodyOf({ html: "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp;amp;</p>" })).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp;amp;</p>",
    );
  });

  it("is total: malformed and empty input still yield a document", () => {
    expect(bodyOf({ html: "" })).toBe("");
    expect(bodyOf({ html: "<div><p>open" })).toBe("<div><p>open</p></div>");
  });
});

describe("sanitizeMailHtml — nothing runs", () => {
  it("drops script, frames, objects, forms and their contents", () => {
    const html =
      "<p>a</p><script>alert(1)</script><iframe src='https://x.test'>f</iframe><object data='x'>o</object>" +
      "<embed src='x'><form action='https://x.test'><input name='q'><button>go</button></form>" +
      "<noscript><img src='https://x.test/p.gif'></noscript><template><p>t</p></template><p>b</p>";
    expect(bodyOf({ html })).toBe("<p>a</p><p>b</p>");
  });

  it("drops every event handler, whatever its case", () => {
    expect(bodyOf({ html: '<div onclick="x()" ONMOUSEOVER="y()" class="k">t</div>' })).toBe('<div class="k">t</div>');
  });

  it("drops SVG and MathML with everything inside, style blocks included", () => {
    const html =
      "<svg><style>*{background:url(https://x.test)}</style><a href='javascript:x'><text>s</text></a></svg>" +
      "<math><mi>m</mi></math><p>ok</p>";
    expect(bodyOf({ html })).toBe("<p>ok</p>");
  });

  it("does not let a mutation shape re-emerge as an active node", () => {
    // The parser breaks `<img>` out of foreign content and fosters it out of the table, as a browser does: it arrives as
    // a real HTML image — with no source and no handler left on it.
    const html = "<table><svg><style><img src=x onerror=alert(1)></style></svg></table><p>end</p>";
    expect(bodyOf({ html })).toBe("<img><table></table><p>end</p>");
  });

  it("unwraps an unknown element and keeps its text", () => {
    expect(bodyOf({ html: "<custom-tag><b>kept</b></custom-tag>" })).toBe("<b>kept</b>");
  });
});

describe("sanitizeMailHtml — nothing navigates", () => {
  it("removes every href and keeps the target in the title", () => {
    expect(bodyOf({ html: '<a href="https://x.test/a?b=1&amp;c=2">read</a>' })).toBe(
      '<a title="https://x.test/a?b=1&amp;c=2">read</a>',
    );
  });

  it("appends the target to an existing title, and keeps a javascript: target only as inert text", () => {
    expect(bodyOf({ html: '<a title="Docs" href="javascript:alert(1)" target="_top" rel="opener">d</a>' })).toBe(
      '<a title="Docs (javascript:alert(1))">d</a>',
    );
  });

  it("escapes a quote in a title so it cannot open a new attribute", () => {
    expect(bodyOf({ html: '<span title="a&quot; onclick=&quot;x">s</span>' })).toBe(
      '<span title="a&quot; onclick=&quot;x">s</span>',
    );
  });
});

describe("sanitizeMailHtml — nothing is fetched", () => {
  it("draws a remote image without its source and counts it", () => {
    const result = sanitizeMailHtml({
      html: '<img src="https://x.test/a.png" alt="hero" width="600"><img src="//x.test/p.gif"><img src="HTTP://X.TEST/b">',
    });
    expect(result.remoteImagesBlocked).toBe(3);
    expect(bodyOf({ html: '<img src="https://x.test/a.png" alt="hero" width="600">' })).toBe(
      '<img alt="hero" width="600">',
    );
  });

  it("drops cid, blob, file, svg and non-base64 data sources without counting them, and every srcset", () => {
    const html =
      '<img src="cid:logo@x"><img src="blob:x"><img src="file:///etc/passwd">' +
      '<img src="data:image/svg+xml;base64,PHN2Zz4="><img src="data:image/png,%89PNG">' +
      '<img srcset="https://x.test/a.png 2x" sizes="10px" alt="s">';
    const result = sanitizeMailHtml({ html });
    expect(result.remoteImagesBlocked).toBe(0);
    expect(bodyOf({ html })).toBe('<img><img><img><img><img><img alt="s">');
  });

  it("drops a background attribute, a link element and picture sources", () => {
    const html =
      '<table background="https://x.test/bg.png"><tr><td>c</td></tr></table>' +
      '<link rel="stylesheet" href="https://x.test/s.css"><picture><source srcset="https://x.test/a"></picture>';
    expect(bodyOf({ html })).toBe("<table><tbody><tr><td>c</td></tr></tbody></table>");
  });

  it("drops a style declaration that fetches, in any spelling, and keeps the rest", () => {
    const html =
      '<div style="color: red; background: URL( https://x.test/a ); border: 1px solid; ' +
      'background-image: -webkit-image-set(&quot;a.png&quot; 1x)">t</div>';
    expect(bodyOf({ html })).toBe('<div style="color: red; border: 1px solid">t</div>');
  });

  it("decodes entities before judging a style, so an encoded url( is still caught", () => {
    expect(bodyOf({ html: '<p style="background: &#117;rl(https://x.test)">t</p>' })).toBe("<p>t</p>");
  });
});

describe("sanitizeMailHtml — whether anything shows", () => {
  it("is false for layout, whitespace, a blocked tracking image and text only inside dropped elements", () => {
    const blank = [
      "",
      "<div> </div><table><tr><td>&nbsp; </td></tr></table>",
      '<img src="https://tracker.example.test/p.gif" width="1" height="1">',
      // Inside a body element: at the very start of a document a `<noscript>` parses in the head, where its text is
      // re-parented into the body as real text — exactly as a browser with scripting off draws it.
      "<div><script>visible()</script><noscript>visible</noscript><svg><text>visible</text></svg></div>",
    ];
    // `&nbsp;` decodes to U+00A0, which `trim` treats as whitespace, so a spacer cell is still blank.
    expect(blank.map((html) => sanitizeMailHtml({ html }).hasVisibleContent)).toEqual([false, false, false, false]);
  });

  it("is true for one character of text, or an image kept with its data source", () => {
    const shown = ["<p>.</p>", '<img src="data:image/png;base64,iVBORw0KGgo=">'];
    expect(shown.map((html) => sanitizeMailHtml({ html }).hasVisibleContent)).toEqual([true, true]);
  });
});

describe("sanitizeInlineStyle", () => {
  it("drops a comment-split token, a CSS escape and old-engine code", () => {
    expect(sanitizeInlineStyle({ css: "background: u/**/rl(https://x.test); color: red" })).toBe("color: red");
    expect(sanitizeInlineStyle({ css: "background: \\75rl(x); color: blue" })).toBe("color: blue");
    expect(sanitizeInlineStyle({ css: "width: expression(alert(1)); behavior: url(x.htc); -moz-binding: x" })).toBe("");
  });

  it("drops fixed and sticky positioning, and nothing else about position", () => {
    expect(sanitizeInlineStyle({ css: "position: fixed; top: 0; position: relative; position:STICKY" })).toBe(
      "top: 0; position: relative",
    );
  });

  it("drops everything when a string, parenthesis or comment never closes", () => {
    expect(sanitizeInlineStyle({ css: "color: red; font-family: 'open" })).toBe("");
    expect(sanitizeInlineStyle({ css: "color: red; width: calc(1px" })).toBe("");
    expect(sanitizeInlineStyle({ css: "color: red /* open" })).toBe("");
  });

  it("drops a declaration with no property, no value or an angle bracket", () => {
    expect(sanitizeInlineStyle({ css: "color:; : red; font-size: 12px; content: '</style>'" })).toBe("font-size: 12px");
  });
});

describe("sanitizeStyleBlock", () => {
  it("keeps plain rules and @media", () => {
    expect(sanitizeStyleBlock({ css: "td{color:red}@media (max-width:600px){td{display:block}}" })).toBe(
      "td{color:red}@media (max-width:600px){td{display:block}}",
    );
  });

  it("drops the whole block for a fetch, another at-rule, an escape, fixed position or a closing tag", () => {
    const blocks = [
      "a{background:url(x)}",
      "@font-face{font-family:x}",
      "@import 'x.css';",
      "@namespace svg url(x);",
      "a{content:'\\41'}",
      "div{position:fixed}",
      "a{color:red}</style><script>x</script>",
      "a{color:red} /* open",
    ];
    expect(blocks.map((css) => sanitizeStyleBlock({ css }))).toEqual(blocks.map(() => undefined));
  });
});
