"use client";

/**
 * One integration, opened inside Settings: its name and status, the numbered Configure steps with the paste field
 * under the step that makes the key, and the facts column beside them — the shape of Datadog's integration tile,
 * (`../../lib/integrationGuides.ts` carries the guides). The address carries it,
 * `#settings/integrations/<id>`, so a reload or a link reopens it; the back link returns to the catalog.
 *
 * The paste fields are the console's one credential write (`./SecretFields.tsx`) and the consent verb is the one
 * `./ConnectIntegration.tsx` already draws, so connecting here is exactly connecting from a failed read's Connect.
 */
import { Fragment, type ReactElement } from "react";
import type { GuideStep } from "../../lib/guideShape";
import type { IntegrationStatus } from "../../lib/integrationCatalog";
import { guideOf } from "../../lib/integrationGuides";
import type { Integration } from "../../lib/integrations";
import { ConsentVerb } from "./ConnectIntegration";
import { StatusPill } from "./IntegrationStatusPill";
import { SecretFields } from "./SecretFields";

/** A heading in the facts column. */
const FACT_HEAD = "m-0 text-[0.7rem] font-medium tracking-[0.06em] text-muted-foreground uppercase";

/**
 * A line with each backticked run drawn as code, the way the guides name a verb or a profile key.
 *
 * @returns the line
 */
function WithCode({ text }: { text: string }): ReactElement {
  const parts = text.split("`");
  return (
    <>
      {parts.map((part, index) => {
        // Split on backticks, so every odd part sat between two of them.
        const key = `${String(index)}:${part}`;
        if (index % 2 === 1) {
          return <code key={key}>{part}</code>;
        }
        return <Fragment key={key}>{part}</Fragment>;
      })}
    </>
  );
}

/**
 * One numbered step: its title and how, the provider page it happens on, then its paste fields or consent verb.
 *
 * @param number the step's place, counted from 1
 * @param label the integration's name, for the consent verb's line
 * @returns the step
 */
function Step({ step, number, label }: { step: GuideStep; number: number; label: string }): ReactElement {
  return (
    <li className="grid grid-cols-[1.6rem_minmax(0,1fr)] gap-3">
      <span
        aria-hidden="true"
        className="grid size-6 place-items-center rounded-full border border-solid border-border text-[0.74rem] text-muted-foreground"
      >
        {String(number)}
      </span>
      <div className="grid min-w-0 gap-2">
        <div className="grid gap-[0.15rem]">
          <span className="text-[0.88rem] font-[600]">{step.title}</span>
          <span className="text-[0.82rem] text-muted-foreground">
            <WithCode text={step.detail} />
          </span>
        </div>
        {step.link !== undefined && (
          <a className="text-[0.82rem] text-primary" href={step.link.href} target="_blank" rel="noreferrer">
            {step.link.label} ↗
          </a>
        )}
        {step.paste !== undefined && <SecretFields names={step.paste} />}
        {step.verb !== undefined && <ConsentVerb verb={step.verb} label={label} />}
      </div>
    </li>
  );
}

/**
 * The facts column: what is stored and where, what reads it, what it can reach, how to take it away.
 *
 * @returns the column
 */
function Facts({ id }: { id: string }): ReactElement {
  const guide = guideOf({ id });
  const facts: readonly (readonly [string, string])[] = [
    ["Stored as", guide.storedAs],
    ["Used by", guide.usedBy],
    ["What it can reach", guide.reach],
    ["Disconnect", guide.disconnect],
  ];
  return (
    <aside className="grid content-start gap-3 rounded-[10px] border border-solid border-border p-3 text-[0.8rem]">
      {facts.map(([head, body]) => (
        <div key={head} className="grid gap-[0.15rem]">
          <h4 className={FACT_HEAD}>{head}</h4>
          <p className="m-0">{body}</p>
        </div>
      ))}
    </aside>
  );
}

/**
 * One integration's page inside Settings.
 *
 * @param status where it stands, or `undefined` while the store's status is unread
 * @param back returns to the catalog
 * @returns the page
 */
export function IntegrationPage({
  integration,
  status,
  back,
}: {
  integration: Integration;
  status: IntegrationStatus | undefined;
  back: () => void;
}): ReactElement {
  const guide = guideOf({ id: integration.id });
  return (
    <section aria-label={integration.label} className="grid gap-4">
      <button
        type="button"
        onClick={back}
        className="w-fit cursor-pointer border-0 bg-transparent p-0 text-[0.8rem] text-muted-foreground hover:text-foreground"
      >
        ‹ All integrations
      </button>
      <header className="grid grid-cols-[2.6rem_minmax(0,1fr)] items-center gap-3 pr-10">
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-[10px] bg-muted text-[1rem] font-[700]"
        >
          {integration.label.charAt(0)}
        </span>
        <div className="grid gap-[0.15rem]">
          <h2 className="m-0 flex items-center gap-2 text-[1.05rem] font-[650]">
            {integration.label}
            {status !== undefined && <StatusPill status={status} />}
          </h2>
          <p className="m-0 text-[0.84rem] text-muted-foreground">{guide.overview}</p>
        </div>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)_14rem] gap-5 max-[900px]:grid-cols-[minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <h3 className="m-0 text-[0.92rem] font-[650]">Configure</h3>
          {integration.pasteEither && (
            <p className="m-0 text-[0.8rem] text-muted-foreground">Either token connects it; both is fine too.</p>
          )}
          <ol className="m-0 grid list-none gap-4 p-0">
            {guide.steps.map((step, index) => (
              <Step key={step.title} step={step} number={index + 1} label={integration.label} />
            ))}
          </ol>
          <p className="m-0 text-[0.76rem] text-muted-foreground">
            Connected means everything {integration.label} reads is stored; nothing here tests that a key works yet.
            Leaving it unconnected is fine: everything that doesn&apos;t need it still works.
          </p>
        </div>
        <Facts id={integration.id} />
      </div>
    </section>
  );
}
