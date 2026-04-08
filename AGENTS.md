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

### Testing in real Obsidian

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
