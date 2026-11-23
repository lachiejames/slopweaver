/*
 * THE NOTE'S DETAILS DISCLOSURE — the folded list behind the `▸ Details (N)` row and the click that opens it —
 * kept as the JS SOURCE `./panel.ts` embeds, the same way `./clipboard.ts` holds the pasteboard and
 * `./fitRows.ts` the layout arithmetic. Spliced in after the rows are laid out; needs `nsstr`, `STEP`, `panel`,
 * `effect`, `hasDetails`, `detailsToggle`, `contentHeight`, `SCREEN_MARGIN`, `BUTTON_BAND`, `PAD` and `inner`.
 *
 * The owner asked for a drop down showing everything failing, when it failed and why. Folded by default is
 * rule 7's progressive disclosure. The list needs proper formatting and may scroll: a single char-wrapped
 * monospaced run broke HOLDER_GONE across two lines and grew the note toward the button band. So each line
 * is an ENTRY (`../details.ts` § detailEntry): its status, name and age on a first line and its reason as wrapped
 * prose under it, all inside a region that scrolls under a height cap.
 */
import { siblingQueueLink } from "../consoleLink.js";
import { type DetailEntry, detailEntry } from "../details.js";

/**
 * The emitted program's `detailsRegionHeight` and `openedOriginY`, as source: the two numbers the opened region
 * turns on, kept apart from the AppKit half so `panel.test.ts` runs this exact string on exact numbers.
 *
 * The region is the text's own height, capped at `DETAILS_MAX_HEIGHT` and at the room the collapsed note leaves on
 * the display, and never below zero. There is no floor: a floor is the one term that could exceed the room, which
 * is how opening the list could carry the button band off a small display. A list taller than its region scrolls;
 * nothing is cut, and `slopweaver hand list --json` prints every line besides.
 *
 * `openedOriginY` is where the panel's bottom goes once it grows: down by the region, as it always did, unless the owner
 * dragged the note low enough that the band would leave the visible frame — then it moves UP instead.
 */
export const DETAILS_FIT_JS = `
var DETAILS_MAX_HEIGHT = 240;
var DETAILS_GAP = 8;

function detailsRegionHeight(textHeight, room) {
  var height = Math.min(textHeight, DETAILS_MAX_HEIGHT, room);
  if (height < 0) { return 0; }
  return Math.floor(height);
}

// An empty region grows nothing, not even its gap: on a display the folded note already nearly fills, the gap
// alone would be the overflow.
function detailsGrow(regionHeight) {
  if (regionHeight <= 0) { return 0; }
  return regionHeight + DETAILS_GAP;
}

function openedOriginY(originY, grow, floorY) {
  return Math.max(originY - grow, floorY);
}
`;

/** The emitted program's `detailsTitle`, the details region, `toggleDetails` and the disclosure row's overlay. */
export const DETAILS_JS = `
function detailsTitle(open) {
  if (open) { return '\\u25be Hide details'; }
  return '\\u25b8 Details (' + STEP.detailCount + ')' + STEP.detailsNeedYou;
}

${DETAILS_FIT_JS}

// One attributed string for the whole list, each entry two paragraphs: the head (status, name, age and count)
// and the reason as prose. Word-wrapped in the system face, never the char-wrapped mono run that split
// HOLDER_GONE. Built by appending to ONE mutable string and styling the appended range, because the bridge
// exposes neither initWithString:attributes: nor initWithString: on an allocated attributed string (measured
// in a scratch osascript run: both undefined). And nothing here is a top-level function named run:
// JXA calls that as the script's own entry handler, with argv, once the program is evaluated.
// Every colour is labelColor at an alpha, never secondaryLabelColor: the secondary colours are made to be
// BLENDED by a vibrant NSTextField, and a text view draws them unblended — measured on a raised note,
// the reason and age came out dark grey on the dark HUD, all but unreadable.
// An entry whose step is the OWNER'S and has an open card ends on an ACT line, "Open its card", in the link colour, so
// the action is a button in front of them. Its character range is kept in detailsActs, and once the
// text is laid out a transparent button is laid over exactly that line (detailsActButtons, below).
var DETAILS_ACT_TITLE = 'Open its card \\u203a';
var detailsActs = [];
function detailsText(entries) {
  var dim = $.NSColor.labelColor.colorWithAlphaComponent(0.6);
  var prose = $.NSColor.labelColor.colorWithAlphaComponent(0.82);
  var text = $.NSMutableAttributedString.alloc.init;
  function appendStyled(value, font, colour, spacingBefore) {
    var style = $.NSMutableParagraphStyle.alloc.init;
    style.setLineBreakMode($.NSLineBreakByWordWrapping);
    style.setParagraphSpacingBefore(spacingBefore);
    var attrs = $.NSMutableDictionary.alloc.init;
    attrs.setObjectForKey(font, $.NSFontAttributeName);
    attrs.setObjectForKey(colour, $.NSForegroundColorAttributeName);
    attrs.setObjectForKey(style, $.NSParagraphStyleAttributeName);
    var at = Number(text.length);
    text.mutableString.appendString(nsstr(value));
    text.setAttributesRange(attrs, $.NSMakeRange(at, Number(text.length) - at));
  }
  for (var e = 0; e < entries.length; e += 1) {
    var entry = entries[e];
    var lead = '';
    var spacing = 0;
    if (e > 0) { lead = '\\n'; spacing = 10; }
    if (entry.status.length > 0) {
      appendStyled(lead + entry.status + '  ', $.NSFont.systemFontOfSizeWeight(10, $.NSFontWeightBold), dim, spacing);
      lead = '';
    }
    appendStyled(lead + entry.name, $.NSFont.systemFontOfSizeWeight(12, $.NSFontWeightSemibold), $.NSColor.labelColor, spacing);
    if (entry.meta.length > 0) {
      appendStyled('  \\u00b7  ' + entry.meta, $.NSFont.systemFontOfSizeWeight(11, $.NSFontWeightRegular), dim, spacing);
    }
    if (entry.reason.length > 0) {
      // A step of the owner's reads at full strength, so the rows that need them stand out of a list of the fleet's.
      if (entry.owner === 'you') {
        appendStyled('\\n' + entry.reason, $.NSFont.systemFontOfSizeWeight(12, $.NSFontWeightMedium), $.NSColor.labelColor, 2);
      } else {
        appendStyled('\\n' + entry.reason, $.NSFont.systemFontOfSizeWeight(12, $.NSFontWeightRegular), prose, 2);
      }
    }
    if (entry.url.length > 0) {
      var actAt = Number(text.length) + 1;
      appendStyled('\\n' + DETAILS_ACT_TITLE, $.NSFont.systemFontOfSizeWeight(12, $.NSFontWeightSemibold), $.NSColor.linkColor, 4);
      detailsActs.push({ at: actAt, length: DETAILS_ACT_TITLE.length, url: entry.url });
    }
  }
  return text;
}

// The region is a scroll view over a read-only text view, built now and added only when opened. The text view is
// flipped, so the list opens at its first entry with no scrolling call. Not selectable, for the reason the literal
// is not: this nonactivating panel never becomes key, so a field editor never arrives.
var detailsScroll = null;
var detailsActButtons = [];
var detailsOpen = false;
var detailsTextHeight = 0;
var detailsGrown = 0;
if (hasDetails) {
  var detailsView = $.NSTextView.alloc.initWithFrame($.NSMakeRect(0, 0, inner, 10));
  detailsView.setEditable(false);
  detailsView.setSelectable(false);
  detailsView.setDrawsBackground(false);
  detailsView.textContainer.setLineFragmentPadding(0);
  detailsView.textStorage.setAttributedString(detailsText(STEP.detailEntries));
  detailsView.layoutManager.ensureLayoutForTextContainer(detailsView.textContainer);
  detailsTextHeight = Math.ceil(Number(detailsView.layoutManager.usedRectForTextContainer(detailsView.textContainer).size.height));
  detailsView.setFrame($.NSMakeRect(0, 0, inner, detailsTextHeight));
  // Each act line's own rect, read off the laid-out text: the text view is flipped and its container sits at its
  // origin with no padding, so a glyph rect IS the button's frame, and as the text view's subview it scrolls with it.
  for (var a = 0; a < detailsActs.length; a += 1) {
    var glyphs = detailsView.layoutManager.glyphRangeForCharacterRangeActualCharacterRange($.NSMakeRange(detailsActs[a].at, detailsActs[a].length), null);
    var actRect = detailsView.layoutManager.boundingRectForGlyphRangeInTextContainer(glyphs, detailsView.textContainer);
    var actButton = $.NSButton.alloc.initWithFrame(actRect);
    actButton.setTitle(nsstr(''));
    actButton.setTransparent(true);
    actButton.setButtonType($.NSButtonTypePushOnPushOff);
    detailsView.addSubview(actButton);
    detailsActButtons.push({ button: actButton, url: detailsActs[a].url });
  }
  detailsScroll = $.NSScrollView.alloc.initWithFrame($.NSMakeRect(PAD, PAD + BUTTON_BAND, inner, 0));
  detailsScroll.setHasVerticalScroller(true);
  detailsScroll.setAutohidesScrollers(true);
  detailsScroll.setDrawsBackground(false);
  detailsScroll.setDocumentView(detailsView);
}

// Sized when OPENED, against the screen the note is on then: the owner can drag it to a shorter display after it is
// drawn, and a region sized for the main screen would carry the note's top off that one.
function toggleDetails() {
  var frame = panel.frame;
  detailsOpen = !detailsOpen;
  if (detailsOpen) {
    var screen = panel.screen;
    if (screen.isNil()) { screen = $.NSScreen.mainScreen; }
    var visible = screen.visibleFrame;
    var region = detailsRegionHeight(detailsTextHeight, Number(visible.size.height) - SCREEN_MARGIN - contentHeight - DETAILS_GAP);
    detailsGrown = detailsGrow(region);
    detailsScroll.setFrame($.NSMakeRect(PAD, PAD + BUTTON_BAND, inner, region));
    var originY = openedOriginY(Number(frame.origin.y), detailsGrown, Number(visible.origin.y));
    panel.setFrameDisplay($.NSMakeRect(frame.origin.x, originY, frame.size.width, frame.size.height + detailsGrown), true);
    effect.addSubview(detailsScroll);
  } else {
    detailsScroll.removeFromSuperview;
    panel.setFrameDisplay($.NSMakeRect(frame.origin.x, frame.origin.y + detailsGrown, frame.size.width, frame.size.height - detailsGrown), true);
  }
  detailsToggle.setStringValue(nsstr(detailsTitle(detailsOpen)));
}

// The disclosure row takes its click through a transparent button over its own frame, for the same reason
// the literal does: this nonactivating panel never becomes key, so a field never sees a click of its own.
var detailsOverlay = null;
if (detailsToggle !== null) {
  detailsOverlay = $.NSButton.alloc.initWithFrame(detailsToggle.frame);
  detailsOverlay.setTitle(nsstr(''));
  detailsOverlay.setTransparent(true);
  detailsOverlay.setButtonType($.NSButtonTypePushOnPushOff);
  detailsOverlay.setAutoresizingMask($.NSViewMinYMargin);
  effect.addSubview(detailsOverlay);
}
`;

/**
 * One detail line as the program draws it: its entry, and the link its act control opens — the card its marker names,
 * on the console the step's own link opens (`../consoleLink.ts` § siblingQueueLink). A step with no queue link of its
 * own has no console to open a card on, so its entries draw no control rather than one that goes nowhere.
 *
 * @param line one checked detail line
 * @param url the step's own link, or empty
 * @returns the entry and its act link, empty when it has none
 */
export function panelDetailEntry({ line, url }: { line: string; url: string }): DetailEntry & { readonly url: string } {
  const entry = detailEntry({ line });
  if (entry.act === "") {
    return { ...entry, url: "" };
  }
  const link = siblingQueueLink({ id: entry.act, url });
  if (link === undefined) {
    return { ...entry, url: "" };
  }
  return { ...entry, url: link };
}

/**
 * What the folded disclosure row adds after its count, so the owner sees without opening it whether any row is theirs.
 *
 * @param count how many entries need the owner
 * @returns ` · 1 needs you`, ` · 3 need you`, or empty at zero
 */
export function needYouSuffix({ count }: { count: number }): string {
  if (count === 0) {
    return "";
  }
  return ` · ${String(count)} ${count === 1 ? "needs" : "need"} you`;
}
