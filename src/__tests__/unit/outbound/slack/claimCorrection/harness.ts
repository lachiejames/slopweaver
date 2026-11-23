/*
 * What the outbound Slack claim correction test files share: the bold Correction line and its block, the rich-text
 * lead whose middle run is bold, and the answer metadata a correction keeps. They moved here when
 * `claimCorrection.test.ts` was split by behaviour.
 */
export const LINE = {
  elements: [
    { style: { bold: true }, text: "Correction: ", type: "text" },
    { text: "4.2.1 is affected.", type: "text" },
  ],
  type: "rich_text_section",
};
export const CORRECTION_BLOCK = { elements: [LINE], type: "rich_text" };

/** A rich-text lead whose middle run is bold, so a claim crossing the run boundary has to split both. */
export const LEAD = {
  block_id: "lead",
  elements: [
    {
      elements: [
        { text: "Only ", type: "text" },
        { style: { bold: true }, text: "4.2.0 is affected", type: "text" },
        { text: ", ", type: "text" },
        { type: "user", user_id: "U0ASKER" },
        { text: " — upgrade.", type: "text" },
      ],
      type: "rich_text_section",
    },
  ],
  type: "rich_text",
};

export const METADATA = {
  event_payload: { renderer: "slack-assistant-answer-v2" },
  event_type: "slopweaver_assistant_answer_v2",
};
