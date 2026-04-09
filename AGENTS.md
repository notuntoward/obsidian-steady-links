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
