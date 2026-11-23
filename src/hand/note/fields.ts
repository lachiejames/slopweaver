/*
 * THE NOTE'S TEXT FIELDS — the two ways a row is drawn, a wrapped system-font `label` and a char-wrapped
 * `mono` block — kept as the JS SOURCE `./panel.ts` embeds, the same way `./clipboard.ts` holds the
 * pasteboard. Needs `nsstr`, `PAD` and `inner`, which the program declares before either is called.
 */

/** The emitted program's `label(text, size, weight, colour)` and `mono(text)`, each sized to its own wrapped text. */
export const FIELDS_JS = `
function label(text, size, weight, colour) {
  var field = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 0, inner, 20));
  field.setStringValue(nsstr(text));
  field.setBezeled(false);
  field.setDrawsBackground(false);
  field.setEditable(false);
  field.setSelectable(true);
  field.setFont($.NSFont.systemFontOfSizeWeight(size, weight));
  field.setTextColor(colour);
  field.cell.setWraps(true);
  field.cell.setLineBreakMode($.NSLineBreakByWordWrapping);
  var height = field.cell.cellSizeForBounds($.NSMakeRect(0, 0, inner, 10000)).height;
  field.setFrame($.NSMakeRect(PAD, 0, inner, height));
  return field;
}

function mono(text) {
  var field = $.NSTextField.alloc.initWithFrame($.NSMakeRect(0, 0, inner - 20, 20));
  field.setStringValue(nsstr(text));
  field.setBezeled(false);
  field.setDrawsBackground(false);
  field.setEditable(false);
  field.setSelectable(true);
  field.setFont($.NSFont.monospacedSystemFontOfSizeWeight(12, $.NSFontWeightRegular));
  field.setTextColor($.NSColor.secondaryLabelColor);
  field.cell.setWraps(true);
  field.cell.setLineBreakMode($.NSLineBreakByCharWrapping);
  var height = field.cell.cellSizeForBounds($.NSMakeRect(0, 0, inner - 20, 10000)).height;
  field.setFrame($.NSMakeRect(PAD + 10, 0, inner - 20, height));
  return field;
}
`;
