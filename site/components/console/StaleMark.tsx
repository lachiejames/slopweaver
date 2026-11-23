"use client";

import type { ReactElement } from "react";

import { partitionNotConnected } from "../../lib/integrations";
import type { StalenessFact } from "../../lib/stalenessLabel";
import { cn } from "../../lib/utils";
import { ConnectIntegration } from "./ConnectIntegration";
import { WarningMark } from "./WarningMark";

export { InsideControl } from "./WarningMark";

/**
 * The one mark every console page draws where a read failed: the warning glyph (`./WarningMark.tsx`) — unless the
 * read failed only because its integration is not connected, which is a normal state of an install and draws the
 * connect affordance in the glyph's place instead. The owner's rule (`../../lib/integrations.ts`) is that this reads as
 * "Slack not connected, connect Slack" rather than an error, for every integration and every page at once. Any other fact
 * handed in beside a not-connected one keeps the glyph for itself.
 *
 * @param facts every subject that could not be read, with its reason and the age of what is still drawn
 * @param block draw it centred in a box of its own, where the data would be, when nothing earlier is drawn
 * @param className spacing the page gives it
 * @returns the mark
 */
export function StaleMark({
  facts,
  block = false,
  className,
}: {
  facts: readonly StalenessFact[];
  block?: boolean;
  className?: string;
}): ReactElement {
  const { notConnected, rest } = partitionNotConnected({ facts });
  if (notConnected.length === 0) {
    return <WarningMark facts={facts} block={block} {...(className === undefined ? {} : { className })} />;
  }
  const connects = notConnected.map((group) => (
    <ConnectIntegration
      key={group.integration.id}
      integration={group.integration}
      subjects={group.facts.map((fact) => fact.subject)}
      block={block}
    />
  ));
  const others = rest.length > 0 && <WarningMark facts={rest} block={block} />;
  if (block) {
    return (
      <div className={cn("grid w-full gap-1", className)}>
        {connects}
        {others}
      </div>
    );
  }
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-2", className)}>
      {connects}
      {others}
    </span>
  );
}
