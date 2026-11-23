/**
 * The argv `handover register --ask` parses for a card a verb places itself, on this machine's own workspace. Pure.
 *
 * A verb that places its own Queue card (the fleet-ceiling morning, the weekly value sample) states its fields once
 * and hands them here, so the flag spelling of a card row lives in one place rather than in each verb that files one.
 * The row's workspace is always `self`, stated with the one reason the verb gives.
 */
import { workspaceRegisterArgv } from "./workspace.js";

/** The fields one `handover register --ask` row carries, before they become argv. */
export interface AskRowFields {
  readonly slug: string;
  readonly ask: string;
  readonly problem: string;
  readonly options: readonly string[];
  readonly lean: string;
  readonly risk: string;
  readonly blastRadius: string;
  readonly stillReal: string;
  /** The concrete scene the card leads with (`./askExamples.ts`), ending on its question. */
  readonly example: string;
}

/**
 * The full process argv that registers one card.
 *
 * @param ask the card's fields
 * @param because why the card's work sits on this machine's own workspace
 * @param home the Slopweaver home the row is written under
 * @returns the full process argv, `node slopweaver handover register …`
 */
export function askRegisterArgv({
  ask,
  because,
  home,
}: {
  ask: AskRowFields;
  because: string;
  home: string;
}): readonly string[] {
  return [
    "node",
    "slopweaver",
    "handover",
    "register",
    "--ask",
    ask.ask,
    "--slug",
    ask.slug,
    "--problem",
    ask.problem,
    "--options",
    ask.options.join("\n"),
    "--lean",
    ask.lean,
    "--risk",
    ask.risk,
    "--blast-radius",
    ask.blastRadius,
    "--still-real",
    ask.stillReal,
    "--example",
    ask.example,
    ...workspaceRegisterArgv({ stated: { because, workspace: "self" } }),
    "--home",
    home,
  ];
}
