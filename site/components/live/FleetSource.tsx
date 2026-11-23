"use client";

/*
 * Where a Fleet row came from, joined to the board by exact slug — the block behind a row's fold, and the owner's words
 * beside its line. Shared by the Next view's forecast and its Next up list, which join the same way
 * (`../../lib/fleetViews.ts`'s `sourceOf`).
 */

import type { ReactElement } from "react";

import type { FleetSource } from "../../lib/fleetViews";
import { wordsBeside } from "../../lib/steerStanding";
import { ReadingIndicator } from "../console/ReadingIndicator";
import { SourceBlock } from "../console/SourceBlock";
import { StaleMark } from "../console/StaleMark";

/**
 * Where a row came from — the owner's words when the board holds them, and every other way the join ended, named.
 *
 * @returns the block, or the line saying why there is none
 */
export function SourceOf({ source }: { source: FleetSource }): ReactElement {
  if (source.kind === "reading") {
    return <ReadingIndicator label="Reading the board for your words" />;
  }
  if (source.kind === "not-measured") {
    return <StaleMark facts={[{ subject: "Your words on the board", why: source.why }]} />;
  }
  if (source.kind === "missing-row") {
    return <p className="sw-tile-note">no board row carries this id, so where it came from cannot be read</p>;
  }
  if (source.kind === "duplicate-row") {
    return (
      <p className="sw-tile-unmeasured">
        {String(source.matches)} board rows carry this id, so whose words are behind it cannot be told
      </p>
    );
  }
  return <SourceBlock source={source.source} />;
}

/**
 * The owner's words beside a row, when the board join read them.
 *
 * @returns the words, or `undefined` when the row holds none or the join did not read
 */
export function quoteOf({ source }: { source: FleetSource }): string | undefined {
  if (source.kind !== "read") {
    return undefined;
  }
  return wordsBeside({ source: source.source });
}
