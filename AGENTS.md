# Agent Instructions for obsidian-steady-links

## Critical: Cursor correction ordering in linkSyntaxHider.ts

The `cursorCorrector` update listener in `src/linkSyntaxHider.ts` contains
fragile ordering dependencies that have been broken by AI at least 4 times.
Each regression takes significant time and money to diagnose and fix because
the bug only manifests in real Obsidian (not in standalone CM6 test harnesses).

### The bug pattern

When the user presses ArrowDown from a blank line above a line-start markdown
link like `[text](url)`, or ArrowUp from below it, the cursor bounces back
instead of landing on the link line. Wikilinks `[[target]]` are not affected
because their leading hidden range is 2+ chars wide and CM6 lands at
`leading.from`, not `textFrom`.

### Root cause

Two code blocks in the `ranges.map()` callback match the same cursor pattern
(`oldHead = textFrom, head = leading.from`):

1. **Obsidian normalization suppression** — checks `cameFromOutside` and
   returns early (keeps cursor on the link line)
2. **`markdownLeadingExit`** — bounces cursor to `leading.from - 1`
   (previous line) for genuine left-arrow presses

If `markdownLeadingExit` runs first, it bounces before the suppression check
can fire. The suppression MUST run first.

### How to verify

The test suite includes a dedicated describe block:

```
"Obsidian normalization must not bounce cursor off line-start markdown links"
```

These tests simulate the exact 3-step Obsidian sequence:

1. CM6 vertical motion lands at `textFrom` (with goalColumn)
2. Our corrector sets `arrivedFromOutside`
3. Obsidian normalizes `textFrom -> leading.from` (no userEvent)

If step 3 bounces to `leading.from - 1`, the tests fail.

**Always run `npm run test:run` after modifying `cursorCorrector` or
`correctCursorPos`. If the "Obsidian normalization" tests fail, you have
broken the ordering.**

### What NOT to do

- Do NOT move `markdownLeadingExit` above the Obsidian normalization
  suppression check
- Do NOT remove the `arrivedFromOutside` marker from the vertical-motion
  span loop
- Do NOT assume standalone CM6 (Playwright harness) reproduces Obsidian's
  cursor normalization behavior. Real Obsidian fires an extra no-userEvent
  `textFrom -> leading.from` dispatch that standalone CM6 does not.
- Do NOT change the ordering of checks in the `ranges.map()` callback
  without running the full test suite AND testing in real Obsidian

## Critical: Suppression must redirect to textFrom, not stay at leading.from

The Obsidian normalisation suppression (the `cameFromOutside` block) must
redirect the cursor to `textFrom` (the visible alias text start), NOT stay
at `leading.from` (the hidden `[[` or `[` syntax position).

### Why this matters

When the cursor stays at `leading.from` after suppression:

- The **visible-cursor plugin** renders a garbled block cursor on the hidden
  `[` character instead of the visible alias character
- **Two right-arrow presses** are needed to move off the first visible
  character (the real selection is on hidden syntax, not visible text)
- `coordsAtPos()` at `leading.from` returns ~1px width (collapsed syntax),
  causing the block cursor to be a thin sliver or wrong width

This interaction between steady-links and visible-cursor has been broken by
AI at least 5 times.

### The correct code

```typescript
// In the cameFromOutside suppression block:
head = obsidianNorm.textFrom;   // CORRECT: redirect to visible alias start
needsAdjust = true;

// NOT this (the old buggy version):
// return range.empty
//     ? EditorSelection.cursor(head)   // WRONG: head = leading.from = hidden [[
//     : EditorSelection.range(range.anchor, head);
```

### How to verify

The test suite includes:

```
"Obsidian normalisation suppression must redirect to textFrom"
```

These tests check that after the suppression fires, the cursor is at
`textFrom` (visible alias start), NOT at `leading.from` (hidden syntax).
They cover wikilinks, piped wikilinks with aliases, and markdown links.

### What NOT to do

- Do NOT change the suppression to `return` early with `head` unchanged —
  that leaves the cursor at `leading.from` (inside hidden syntax)
- Do NOT remove `needsAdjust = true` from the suppression — without it,
  the corrective dispatch never fires
- Do NOT assume the cursor position after suppression is correct without
  checking that it equals `textFrom`, not `leading.from`

### Testing in real Obsidian

Use this test document (both wikilinks and markdown links):

```markdown
(blank line)
[[test-notes/Note-09.md#Note Nine |Wote Nine]]
(blank line)
[dklfsdfg](http://arxiv.org/abs/2602.19141) asdflkjasdlfj
alsdkfjasldjf
```

1. Put cursor on the blank line above each link, press ArrowDown — cursor
   must land on the link line with the block cursor correctly sized on the
   first visible alias character
2. Press ArrowUp from below — same result
3. A single ArrowRight should move to the second visible character
4. Open DevTools console — look for `redirecting to textFrom=` in the
   `[SteadyLinks corrector]` logs
5. If you see `staying at h.from=` instead, the bug has regressed

### Testing in real Obsidian (markdown link bounce)

The integration tests simulate Obsidian's behavior, but if you need to verify
in the real app, use this test document:

```markdown
(blank line)
[dklfsdfg](http://arxiv.org/abs/2602.19141) asdflkjasdlfj
alsdkfjasldjf
```

1. Put cursor on the blank line, press ArrowDown — cursor must land on the
   link line (not bounce back)
2. Put cursor on the third line, press ArrowUp — cursor must land on the
   link line (not skip over it)
3. Open DevTools console — look for `[SteadyLinks corrector]` logs to trace
   the exact correction sequence

## Critical: deleteSelectionKeymap must pass a userEvent to rewriteDeleteChanges

The `deleteSelectionKeymap` keymap handler (Backspace/Delete with a non-empty
selection) MUST pass a non-null `userEvent` (e.g. `"delete.selection"`) when
calling `rewriteDeleteChanges`.  Without it, the `matchesExactSingleLink`
branch in `rewriteDeleteChangeForLinks` fires — that branch is reserved for
**programmatic, no-userEvent** deletes (Emacs delete-char where `goRight`
jumps the full link decoration and `replaceSelection("")` follows).

### The bug pattern

When the user selects the visible text of a link (e.g. `[[Destination]]` →
select "Destination") and presses Backspace or Delete:

1. `expandSelectionRangeToFullLinks` expands `[textFrom, textTo)` to
   `[link.from, link.to)` (the full link span).
2. `matchesExactSingleLink` becomes true (`change.from === link.from &&
   change.to === link.to`).
3. If `userEvent` is null/undefined, the `matchesExactSingleLink` branch
   fires and **converts the bare wikilink to an aliased wikilink + deletes
   only 1 character** — instead of deleting the entire link.

This has been broken by AI at least 3 times because the fix looks
counter-intuitive (why pass a userEvent to an internal helper?).  The
`matchesExactSingleLink` branch's `userEvent === null || userEvent ===
undefined` guard is the ONLY thing that distinguishes a genuine user
selection-delete from a programmatic Emacs delete-char.

### How to verify

The test suite includes:

```
"Backspace on a selected bare wikilink deletes the entire link"
"Delete on a selected bare wikilink deletes the entire link"
```

These dispatch real `KeyboardEvent`s and expect the entire link to be
deleted (empty document), NOT `[[Destination|estination]]`.

The Emacs delete-char path is guarded by:

```
"Emacs delete-char (programmatic, no userEvent) on a full-link selection still converts bare wikilink"
```

This dispatches with NO `userEvent` annotation and expects the aliased
conversion — proving the two paths are correctly distinguished.

### What NOT to do

- Do NOT remove the `"delete.selection"` userEvent argument from
  `deleteSelectionKeymap`'s `rewriteDeleteChanges` calls
- Do NOT change the `matchesExactSingleLink` branch's `userEvent === null
  || userEvent === undefined` guard to always fire — that would break
  Emacs delete-char
- Do NOT assume `deleteSelectionKeymap` and `clampSelectionDeleteFilter`
  are interchangeable — the keymap handles keypresses (user-driven), the
  filter handles programmatic dispatches (no userEvent)

## Critical: Selection-collapse redirect in cursorCorrector

The `cursorCorrector` update listener contains a block that redirects the
cursor to `textFrom` when a non-empty selection is collapsed to empty at a
link's trailing boundary.  This block MUST run BEFORE `correctCursorPos`
and MUST include `!update.docChanged` in its condition.

### The bug pattern

When the user selects the visible text of a link (e.g. `[[Destination]]` →
select "Destination") and runs Emacs kill-line:

1. Emacs `disableSelection` collapses the selection to the head.
2. For a left-to-right selection, the head was at `textTo` (trailing.from),
   but the cursor corrector already moved it to `span.to` or `span.to + 1`
   during selection creation.
3. `correctCursorPos` would leave the cursor at `span.to` / lineEnd.
4. Emacs `getCursor()` returns lineEnd → `setSelection(lineEnd, lineEnd)` =
   empty selection → `replaceSelection("")` does nothing.

The redirect block catches this: when a non-empty selection is collapsed to
empty, and the head is within `[span.from, span.to + 1]`, and the old
selection's anchor was within the link's leading syntax or at `textFrom`,
it redirects the cursor to `textFrom`.  This makes kill-line select
`[textFrom, lineEnd]` which expands to `[link.from, link.to]` and deletes
the entire link.

### Why `!update.docChanged` is required

Without `!update.docChanged`, the redirect also fires during edit-driven
selection changes (e.g. `emulateEmacsKillLine`'s delete step where
`oldSel` was non-empty and `newSel` is empty).  In that case
`correctCursorPos` already handles the cursor correctly via `isEditUpdate`
(keeping it at `textTo`), and the redirect would incorrectly move it to
`textFrom`.  The "kill-line inside a wikilink alias" and "kill-line inside
a markdown link" tests will fail if `!update.docChanged` is removed.

### How to verify

The test suite includes:

```
"collapsing a selection ending at textTo redirects cursor to textFrom, not lineEnd"
"Emacs kill-line on a selected bare wikilink deletes the entire link"
```

### What NOT to do

- Do NOT remove the `!update.docChanged` condition — edit-driven cursor
  changes have their own handling via `isEditUpdate` in `correctCursorPos`
- Do NOT move this block AFTER the `correctCursorPos` loop — the loop
  moves the head past the link, after which the span match fails
- Do NOT remove the `oldRange.anchor >= span.from && oldRange.anchor <=
  span.textFrom` check — without it, selections that include text BEFORE
  the link would also get redirected, breaking kill-line for those cases

## Critical: End / line-end moves must not advance past trailing link syntax

`correctCursorPos` accepts an `isLineEndMove` flag (8th parameter) that the
`cursorCorrector` computes. When a line-end move (End key, Emacs "Move end of
line" / `emacs.moveToEnd`, Shift+End / `selectLineEnd`) lands the cursor inside
a link's trailing hidden range, `correctCursorPos` MUST return `null` (leave
the selection unchanged) instead of advancing to `h.to` / `h.to + 1`.

### The bug pattern

On a soft-wrapped line whose visible alias text ends at the right edge, the End
command (CM6 `moveToLineBoundary(forward)`, assoc=-1) lands the cursor at the
link's `textTo` — the start of the hidden trailing `]]` syntax. Without the
`isLineEndMove` guard, the trailing "moving right" branch advances the cursor
to `h.to + 1` (past the `]]`), which visually lands on the next visual line.
Pressing Delete then removes the first character of the next visual line
instead of the character at the wrap boundary. This is a regression from the
"line-ending links, stop at h.to" fix.

### The correct code

In the trailing `movingRight` branch of `correctCursorPos`:

```typescript
const textFrom = findTextFromForTrailing(hidden, h, doc);
const isSingleCharInLinkAdvance =
    textFrom !== null &&
    oldPos >= textFrom &&
    oldPos < h.from &&
    Math.abs(pos - oldPos) <= 1;
if (!isSingleCharInLinkAdvance && isLineEndMove) {
    return null;   // keep cursor at the wrap boundary End placed it on
}
// ...otherwise preserve the existing advance to h.to / h.to + 1
```

A single-character right-arrow from inside the link's visible text must STILL
advance past the trailing syntax — even right after an End keydown — so the
`isSingleCharInLinkAdvance` exception is required (otherwise a Right press
immediately after End would get stuck at `textTo`).

### How the End key is detected

The Emacs command and Shift+End carry distinct userEvents (`emacs.moveToEnd`,
`selectLineEnd`). The bare End key dispatches with a generic `select`
userEvent indistinguishable from arrow keys, so `cursorCorrector` also checks
`Date.now() - lastEndKeyDownAt < 300`, where `lastEndKeyDownAt` is set by the
`endKeyTracker` `EditorView.domEventHandlers` keydown. This mirrors the
visible-cursor plugin's `lastKeyDownTime` approach.

### How to verify

The integration test suite includes:

```
"End / emacs.moveToEnd landing at a link's trailing boundary (soft-wrap regression)"
```

These cover `emacs.moveToEnd`, `selectLineEnd`, the bare End key (keydown +
generic `select` dispatch), and the preserved single-char right-arrow advance.
They also verify the line-end-link case (where `h.to === lineEnd`).

### What NOT to do

- Do NOT remove the `isLineEndMove` parameter or the `isSingleCharInLinkAdvance`
  exception — without the exception, right-arrow-after-End breaks; without the
  flag, the End regression returns.
- Do NOT detect line-end moves by `assoc` alone — CM6 normalises assoc at wrap
  boundaries, so it is unreliable.
- Do NOT remove the `endKeyTracker` domEventHandler — the bare End key has no
  distinguishable userEvent and relies on the keydown timestamp.

## Note: worktree builds (Agent Manager) and the vault junction

Steady Links also ships a pre-built `main.js` that the vault loads via a
junction at `<vault>/.obsidian/plugins/steady-links` pointing to the main
checkout, so builds inside a git worktree are not automatically visible.

For the workflow and the shared relink script, see the global rule in
`~/.config/kilo/AGENTS.md` under *When building an Obsidian plugin inside a
git worktree*.  The script at `$env:USERPROFILE\.config\kilo\tools\obsidian-relink.ps1`
re-points the vault junction in one command; do not ask the user to do
the delete/re-create manually.
