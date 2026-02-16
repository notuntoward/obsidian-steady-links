# Steady Links

When you arrow-key through a note in stock Obsidian, every link you touch springs open to reveal its raw syntax—brackets, URLs, everything.

<!-- picture here? -->

Your cursor jumps, your place in the text shifts, and if the link is long, you can end up lines of horror from the simple link text edit you wanted to make.  Safe Travels.

**Steady Links** keeps links quiet. Move through them like normal text, edit them in a focused modal when you actually want to, and get on with your writing. But even if you prefer Obsidian's default link-expanding behavior, the included utility commands are still worth your time.

<!-- 📸 IMAGE SUGGESTION: Animated GIF showing side-by-side comparison.
     Left: default Obsidian behavior where arrowing into a link causes it to expand
     and the cursor to jump. Right: Steady Links enabled, cursor passes smoothly
     through the link text without any expansion. Caption: "Before and after." -->

## What It Does

**Links stay put.** Enable "Keep links steady" in settings, and links in Live Preview stop expanding when your cursor enters them. You see the display text, you can edit it like any other word, and the underlying destination stays out of your way.

**Edit links without juggling brackets.** The *Edit Link* command opens a modal where you can change the link text, destination, and type—with autocomplete suggestions for files, headings, and block references. No hand-editing syntax. No mismatched brackets.

<!-- 📸 IMAGE SUGGESTION: Screenshot of the Edit Link modal with a file suggestion
     dropdown visible. Show a partially typed filename in the Destination field
     with the autocomplete list appearing below. -->

**Works how you work.** Prefer Obsidian's default link behavior? Skip the setting and use the standalone commands to show, hide, or toggle link syntax on demand. Steady Links adapts to your workflow, not the other way around.

## Getting Started

Install the plugin, then open Settings → Steady Links.

Turn on **Keep links steady**. That's it—links in Live Preview will no longer expand when you cursor into them. Navigate your notes in peace.

When you need to change where a link points, put your cursor on it and run **Edit Link** from the Command Palette (`Ctrl/Cmd + P`). The modal opens pre-filled with the current link's details. Change what you need, hit `Enter`, and you're done.

<!-- 📸 IMAGE SUGGESTION: Screenshot of the Settings tab showing the
     "Keep links steady" toggle with its description text visible. -->

## The Edit Link Modal

The modal is the heart of the plugin. It works for both new and existing links, and handles WikiLinks and Markdown links equally.

**Creating a new link:** Select some text (or just place your cursor) and run *Edit Link*. The modal opens with smart defaults:

- If you selected text, it becomes the link text
- If your clipboard holds a URL, it fills the destination
- If your cursor is on a bare URL, it converts it into a proper link

<!-- 📸 IMAGE SUGGESTION: Short GIF showing the workflow of selecting text,
     running Edit Link, and the modal pre-filling the link text field with
     the selection and the destination with a URL from the clipboard. -->

**Editing an existing link:** Cursor onto any link and run *Edit Link*. The modal shows the current text, destination, link type (Wiki or Markdown), and embed status. Change anything, hit `Enter`.

**Suggestions:** As you type in the Destination field, you get autocomplete for:

- **Files** in your vault (with path disambiguation)
- **Headings** within a file (type `#` after a filename)
- **Block references** (type `^` after a filename)

Tab accepts the current suggestion. `Ctrl+N`/`Ctrl+P` navigate the list.

<!-- 📸 IMAGE SUGGESTION: Screenshot or GIF showing heading suggestions appearing
     after typing "NoteName#" in the Destination field, with a list of headings
     from that note. -->

## Utility Commands

For users who want surgical control over link display—whether or not "Keep links steady" is enabled:

| Command | What It Does |
|---|---|
| **Skip Link** | Jumps the cursor past the current link. Handy when a link expands and you just want to move on. |
| **Hide Link Syntax** | Collapses the link at your cursor back to its display text. |
| **Show Link Syntax** | Reveals the full syntax of the link at your cursor. |
| **Toggle Link Syntax** | Flips between shown and hidden. One hotkey for both directions. |

These commands work in Live Preview mode. In Source mode, syntax is always visible, so they're not needed; **Edit Link** is the only tool you need.

> **Tip:** Bind *Toggle Link Syntax* to a hotkey for quick peeking at link destinations without opening the modal. Bind *Skip Link* if you keep "Keep links steady" off but want a fast escape hatch when a link expands.

## Use Cases

**"I navigate by keyboard and links keep jumping around."**
Turn on "Keep links steady." Endit link text like any other text. Options below make the rest easier.

**"I want to edit link destinations without wrestling with bracket syntax."**
Use *Edit Link*. The modal handles formatting, suggests files and headings, and validates your input.

**"I like the default link-expanding behavior, but sometimes I want to collapse a link quickly."**
Leave the setting off. Use *Hide Link Syntax* or *Toggle Link Syntax* when you need a link to settle down.

**"I have a URL on my clipboard and want to turn selected text into a link."**
Select the text, run *Edit Link*. The URL is pre-filled from your clipboard.

## Commands Reference

| Command | ID | Description |
|---|---|---|
| Edit Link | `steady-links:edit-link` | Open the link editor modal for the link at cursor, or create a new link |
| Hide Link Syntax | `steady-links:hide-link-syntax` | Collapse link syntax to show only display text (Live Preview) |
| Show Link Syntax | `steady-links:show-link-syntax` | Reveal full link syntax including destination (Live Preview) |
| Toggle Link Syntax | `steady-links:toggle-link-syntax` | Toggle between shown and hidden link syntax (Live Preview) |
| Skip Link | `steady-links:skip-link` | Move cursor past the current link |

## Settings

| Setting | Default | Description |
|---|---|---|
| Keep links steady | Off | Prevent links from expanding when the cursor enters them in Live Preview. Link text remains editable; use *Edit Link* to change destinations. |

## Compatibility

- Works in **Live Preview** and **Source** mode
- Supports **WikiLinks** (`[[destination]]`) and **Markdown links** (`[text](url)`)
- Supports **embeds** (`![[file]]` and `![alt](url)`)
- Requires Obsidian **1.9.0** or later

## License

MIT
