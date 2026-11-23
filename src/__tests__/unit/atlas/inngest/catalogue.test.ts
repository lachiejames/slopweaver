import { describe, expect, it } from "vitest";

import {
  compileInngestCatalogue,
  INNGEST_REST_REFERENCE_ORIGIN,
  inngestOperationProviderId,
} from "../../../../atlas/inngest/restCatalogue.js";
import { unwrap } from "../../../../lib/result.js";

/** The document's real shape, reduced to the rows the compiler has to tell apart. */
const CATALOGUE = [
  "# Inngest API",
  "",
  "- [API Overview](/): Complete reference documentation for the Inngest REST API.",
  "- [Authentication](/authentication): How to authenticate with the Inngest REST API.",
  "- v1",
  "  - [v1 REST API](/v1)",
  "",
  "  - **Events**",
  "  - [List events](/v1/events/ListEvents): Fetches recent events from your environment.",
  "  - [Get an event](/v1/events/GetEvent): Retrieve a single event",
  "",
  "  - **Webhooks**",
  "  - [Get webhooks](/v1/webhooks/ListWebhooks): Get all webhook endpoints in the given environment.",
  "- v2",
  "",
  "  - **Webhooks**",
  "  - [List webhooks](/v2/webhooks/ListWebhooks): Lists all webhooks in the specified environment",
  "",
  "  - **Sandboxes**",
  "  - [List sandboxes](/v2/sandboxes/ListSandboxes)",
].join("\n");

describe("compiling the published REST catalogue", () => {
  it("reads every operation with the version and group its own headings put it under", () => {
    const catalogue = unwrap(compileInngestCatalogue({ text: CATALOGUE }));
    expect(catalogue.operations.length).toBe(5);
    const listEvents = catalogue.operations.find((row) => row.operationId === "ListEvents")!;
    expect(listEvents.version).toBe("v1");
    expect(listEvents.group).toBe("Events");
    expect(listEvents.title).toBe("List events");
    expect(listEvents.description).toBe("Fetches recent events from your environment.");
    expect(listEvents.referenceUrl).toBe(`${INNGEST_REST_REFERENCE_ORIGIN}/v1/events/ListEvents`);
  });

  // The only thing separating an operation from a page of prose is the three-segment reference address:
  // `- [v1 REST API](/v1)` sits inside the v1 section with no description, and so does an operation.
  it("keeps a version index and the overview as pages rather than operations", () => {
    const catalogue = unwrap(compileInngestCatalogue({ text: CATALOGUE }));
    expect(catalogue.pages.map((page) => page.title)).toEqual(["API Overview", "Authentication", "v1 REST API"]);
  });

  it("keeps an operation that carries no description at all", () => {
    const catalogue = unwrap(compileInngestCatalogue({ text: CATALOGUE }));
    expect(catalogue.operations.find((row) => row.operationId === "ListSandboxes")!.description).toBe(null);
  });

  // `ListWebhooks` exists in BOTH published versions against different addresses. Keying on the id alone
  // folds two operations into one row — the exact collision that overwrote three v1 probe results while this
  // atlas was being built.
  it("gives the same operation id in two versions two different provider keys", () => {
    const catalogue = unwrap(compileInngestCatalogue({ text: CATALOGUE }));
    const both = catalogue.operations.filter((row) => row.operationId === "ListWebhooks");
    expect(both.length).toBe(2);
    expect(both.map((row) => inngestOperationProviderId({ operation: row })).toSorted()).toEqual([
      "v1 ListWebhooks",
      "v2 ListWebhooks",
    ]);
  });

  it("refuses a document that declares an operation before any version heading", () => {
    const orphan = "# Inngest API\n\n  - [List events](/v1/events/ListEvents): x";
    const compiled = compileInngestCatalogue({ text: orphan });
    expect(compiled.isErr()).toBe(true);
    expect(compiled._unsafeUnwrapErr()[0]).toContain("before any version or group heading");
  });

  it("refuses a document it can read no operation out of at all", () => {
    const compiled = compileInngestCatalogue({ text: "# Inngest API\n\n- [Authentication](/authentication): x" });
    expect(compiled.isErr()).toBe(true);
    expect(compiled._unsafeUnwrapErr()[0]).toContain("declared no operation");
  });
});

describe("compileInngestCatalogue's empty refusal, line for line", () => {
  it("names the catalogue address and what an operation looks like", () => {
    const compiled = compileInngestCatalogue({ text: "# Inngest API\n\n- [Authentication](/authentication): x" });
    expect(compiled._unsafeUnwrapErr()).toEqual([
      "https://api-docs.inngest.com/llms.txt was read and declared no operation this compiler could recognise",
      "an operation is a link whose reference path is /v1/<group>/<OperationId> or /v2/<group>/<OperationId>",
    ]);
  });
});
