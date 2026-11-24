"use client";

import type { Result } from "neverthrow";
import type { ReactElement } from "react";

import type { StoreBrowserState } from "../../lib/storeBrowserState";
import { decodeStoreReadResponse, type StoreRowsDocument } from "../../lib/storeDocuments";
import type { StoreReadResponse } from "../../lib/storeReadVerbs";
import { SpinnerBlock } from "../ui/spinner";
import { BUTTON } from "./controls";
import { StoreRowsGrid } from "./StoreRowsGrid";

/** A read the page draws: under way, its decoded document, or the reason there is none. */
export type Reading<T> =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly document: T }
  | { readonly phase: "failed"; readonly why: string };

/**
 * Ask the Store route for one read. A thrown fetch, an unparseable body and a refusal all come back as a refusal with
 * its reason, so the page always has a sentence to draw.
 *
 * @param slug which read
 * @param body exactly the fields that read takes
 * @param signal aborts the fetch when the page has moved on; the answer is dropped by key either way
 * @returns the route's answer
 */
export async function readStore({
  slug,
  body,
  signal,
}: {
  slug: "tables" | "rows" | "row";
  body: Readonly<Record<string, unknown>>;
  signal: AbortSignal;
}): Promise<StoreReadResponse> {
  try {
    const response = await fetch(`/api/store/${slug}`, {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: { "content-type": "application/json" },
      method: "POST",
      signal,
    });
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      parsed = undefined;
    }
    return decodeStoreReadResponse({ body: parsed, status: response.status });
  } catch (cause: unknown) {
    return { code: null, outcome: "refused", why: cause instanceof Error ? cause.message : String(cause) };
  }
}

/**
 * A route answer as a reading of one document: decoded strictly, or failed with the verb's reason or the decoder's.
 *
 * @param response the route's answer
 * @param decode the document's decoder
 * @returns the reading
 */
export function readingOf<T>({
  response,
  decode,
}: {
  response: StoreReadResponse;
  decode: (args: { value: unknown }) => Result<T, string>;
}): Reading<T> {
  if (response.outcome === "refused") {
    return { phase: "failed", why: response.why };
  }
  const decoded = decode({ value: response.document });
  if (decoded.isErr()) {
    return { phase: "failed", why: decoded.error };
  }
  return { document: decoded.value, phase: "ready" };
}

/**
 * A read that did not answer, said in the place its answer would have been — never an empty table.
 *
 * @param verb the verb line that failed
 * @param why its reason
 * @returns the notice
 */
export function StoreFailure({ verb, why }: { verb: string; why: string }): ReactElement {
  return (
    <div
      role="alert"
      className="rounded-[8px] border border-solid border-warning/40 bg-warning/10 px-3 py-2 text-[0.8rem]"
    >
      <p className="m-0 font-semibold text-warning">{verb} did not answer</p>
      <p className="m-0 mt-1 break-words whitespace-pre-wrap text-foreground">{why}</p>
    </div>
  );
}

/**
 * The data view under the filter: the grid, or the read's reason where the grid would be, then Previous / Page N /
 * Next, enabled only as far as the verb says there are pages.
 *
 * @param reading the rows read for the current state
 * @param state where the page stands, for the sort and the page number asked for
 * @returns the view
 */
export function StoreRowsView({
  reading,
  state,
  onSort,
  onOpen,
  onPage,
}: {
  reading: Reading<StoreRowsDocument>;
  state: StoreBrowserState;
  onSort: (column: string) => void;
  onOpen: (locator: string) => void;
  onPage: (page: number) => void;
}): ReactElement {
  if (reading.phase === "failed") {
    return <StoreFailure verb="slopweaver store rows" why={reading.why} />;
  }
  let document: StoreRowsDocument | undefined;
  if (reading.phase === "ready") {
    document = reading.document;
  }
  return (
    <>
      <div className="max-h-[calc(100vh-15rem)] overflow-auto rounded-[8px] border border-solid border-border">
        {document === undefined ? (
          <SpinnerBlock label="this page of rows" className="py-6" />
        ) : (
          <StoreRowsGrid
            document={document}
            sort={state.sort}
            openRow={state.openRow}
            onSort={onSort}
            onOpen={onOpen}
          />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[0.78rem]">
        <button
          type="button"
          className={BUTTON}
          disabled={document === undefined || !document.hasPrevious}
          onClick={() => {
            onPage(state.page - 1);
          }}
        >
          Previous
        </button>
        <span className="tabular-nums">Page {String(state.page)}</span>
        <button
          type="button"
          className={BUTTON}
          disabled={document === undefined || !document.hasNext}
          onClick={() => {
            onPage(state.page + 1);
          }}
        >
          Next
        </button>
        {document !== undefined && (
          <span className="ml-auto text-muted-foreground">
            {String(document.rows.length)} rows on this page, {String(document.pageSize)} to a page · read{" "}
            {document.observedAtIso}
          </span>
        )}
      </div>
    </>
  );
}
