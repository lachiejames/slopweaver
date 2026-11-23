/**
 * Reducing a Google Doc to the text a meeting transcript record stores.
 *
 * The document shapes here are synthetic `Schema$Document` literals, which is the point: the tab walk and
 * the table descent are the two places this can silently lose a transcript, and both are exercised without
 * a Google account.
 */
import type { docs_v1 } from "@googleapis/docs";
import { describe, expect, it } from "vitest";

import { docIdFromUrl, reduceDocument } from "../../../../live/gmail/docs.js";

/** One paragraph, as the API shapes it. */
const para = ({ text }: { text: string }): docs_v1.Schema$StructuralElement => ({
  paragraph: { elements: [{ textRun: { content: `${text}\n` } }] },
});

describe("docIdFromUrl", () => {
  it("takes the id out of the edit URL Meet puts in a notes email, tab fragment and all", () => {
    expect(
      docIdFromUrl({ url: "https://docs.google.com/document/d/1zGPa-Dn9_XR5/edit?usp=meet_tnfm_email&tab=t.p87" }),
    ).toBe("1zGPa-Dn9_XR5");
  });

  it("is undefined for a Google URL that is not a document", () => {
    expect(docIdFromUrl({ url: "https://drive.google.com/file/d/abc/view" })).toBe(undefined);
    expect(docIdFromUrl({ url: "https://meet.google.com/abc-defg-hij" })).toBe(undefined);
  });

  it("is undefined for a lookalike host, which is what keeps a credential off an arbitrary URL", () => {
    expect(docIdFromUrl({ url: "https://docs.google.com.example.test/document/d/abc/edit" })).toBe(undefined);
    expect(docIdFromUrl({ url: "http://docs.google.com/document/d/abc/edit" })).toBe(undefined);
  });
});

describe("reduceDocument", () => {
  it("keeps EVERY tab, which is the difference between a summary and a transcript", () => {
    const document: docs_v1.Schema$Document = {
      tabs: [
        {
          documentTab: { body: { content: [para({ text: "Attendees: Ana Diaz" })] } },
          tabProperties: { title: "Summary" },
        },
        {
          documentTab: { body: { content: [para({ text: "Ana: hello" }), para({ text: "Bo: hi" })] } },
          tabProperties: { title: "Transcript" },
        },
      ],
      title: "Widget Working Group",
    };

    const reduced = reduceDocument({ document, documentId: "d1" });

    expect(reduced.title).toBe("Widget Working Group");
    expect(reduced.tabs.map((tab) => tab.title)).toEqual(["Summary", "Transcript"]);
    expect(reduced.tabs[1]!.text).toBe("Ana: hello\nBo: hi");
  });

  it("descends into nested tabs, so a hand-built document loses no section", () => {
    const document: docs_v1.Schema$Document = {
      tabs: [
        {
          childTabs: [
            { documentTab: { body: { content: [para({ text: "nested" })] } }, tabProperties: { title: "Child" } },
          ],
          documentTab: { body: { content: [para({ text: "parent" })] } },
          tabProperties: { title: "Parent" },
        },
      ],
    };

    expect(reduceDocument({ document, documentId: "d1" }).tabs.map((tab) => tab.title)).toEqual(["Parent", "Child"]);
  });

  it("reads text out of table cells, which is where Meet puts an action-item grid", () => {
    const document: docs_v1.Schema$Document = {
      tabs: [
        {
          documentTab: {
            body: {
              content: [
                {
                  table: {
                    tableRows: [
                      {
                        tableCells: [{ content: [para({ text: "Owner" })] }, { content: [para({ text: "Ana Diaz" })] }],
                      },
                    ],
                  },
                },
              ],
            },
          },
          tabProperties: { title: "Actions" },
        },
      ],
    };

    expect(reduceDocument({ document, documentId: "d1" }).tabs[0]!.text).toBe("Owner\nAna Diaz");
  });

  it("treats a document with no tabs as one untitled tab rather than as empty", () => {
    const document: docs_v1.Schema$Document = { body: { content: [para({ text: "body text" })] }, title: "Old Shape" };
    const reduced = reduceDocument({ document, documentId: "d1" });

    expect(reduced.tabs.length).toBe(1);
    expect(reduced.tabs[0]!.title).toBe(undefined);
    expect(reduced.tabs[0]!.text).toBe("body text");
  });

  it("carries the id it was fetched by, so a caller never re-derives it from a URL", () => {
    expect(reduceDocument({ document: {}, documentId: "d7" }).documentId).toBe("d7");
  });

  it("reads every structural list the API omitted as holding no text, at each level of the walk", () => {
    const document: docs_v1.Schema$Document = {
      tabs: [
        { documentTab: { body: { content: [{ paragraph: {} }, para({ text: "kept" })] } } },
        { documentTab: { body: { content: [{ table: {} }, { table: { tableRows: [{}] } }] } } },
        { documentTab: { body: { content: [{ table: { tableRows: [{ tableCells: [{}] }] } }] } } },
        { documentTab: { body: {} } },
        { documentTab: {} },
        {},
      ],
    };

    expect(reduceDocument({ document, documentId: "d1" }).tabs).toStrictEqual([
      { text: "kept", title: undefined },
      { text: "", title: undefined },
      { text: "", title: undefined },
      { text: "", title: undefined },
      { text: "", title: undefined },
      { text: "", title: undefined },
    ]);
  });

  it("reads a tab with no properties and a property block with no title, or a null one, as untitled", () => {
    const document: docs_v1.Schema$Document = {
      tabs: [{}, { tabProperties: {} }, { tabProperties: { title: null } }, { tabProperties: { title: "Named" } }],
    };

    expect(reduceDocument({ document, documentId: "d1" }).tabs.map((tab) => tab.title)).toStrictEqual([
      undefined,
      undefined,
      undefined,
      "Named",
    ]);
  });

  it("reads an omitted or null document title as untitled, and an untabbed document with no body as empty", () => {
    expect(reduceDocument({ document: {}, documentId: "d1" })).toStrictEqual({
      documentId: "d1",
      tabs: [{ text: "", title: undefined }],
      title: undefined,
    });
    expect(reduceDocument({ document: { body: {}, title: null }, documentId: "d1" }).title).toBe(undefined);
  });
});
