# Obsidian Link Editor

Edit links in a modal with intelligent suggestions for files, headings, and blocks.

## Features

- Edit both WikiLinks and Markdown links
- File suggestions with autocomplete
- Heading suggestions (current file or all files)
- Block reference support with automatic ID generation
- Convert between WikiLink and Markdown formats
- Smart URL detection and normalization
- Keyboard-friendly navigation (Tab, Ctrl+N/P, Enter, Escape)

## Development

### Setup

1. Clone this repo into your local development folder
2. Install dependencies: `npm install`
3. Create a symlink from your vault's plugins folder to this repo (see below)

### Windows Symlink Setup

```powershell
# Run as Administrator in PowerShell
New-Item -ItemType SymbolicLink `
  -Path "C:\Users\YOUR_USERNAME\path\to\vault\.obsidian\plugins\obsidian-link-editor" `
  -Target "$HOME\repos\obsidian-link-editor"
```

### Development Workflow

1. Start development build with file watching:
   ```bash
   npm run dev
   ```

2. Install the [Hot-Reload plugin](https://github.com/pjeby/hot-reload) in your vault
   - The `.hotreload` file signals hot-reload to watch this directory

3. Make changes to TypeScript files in `src/`
   - esbuild watches and rebuilds automatically
   - hot-reload detects changes and reloads the plugin
   - No need to manually reload Obsidian

### Build for Production

```bash
npm run build
```

### Format Code

```bash
npm run format
```

## Project Structure

```
obsidian-link-editor/
├── src/
│   ├── main.ts              # Main plugin class
│   ├── LinkEditModal.ts     # Link editing modal
│   ├── FileSuggest.ts       # File/heading/block suggestions
│   ├── SettingTab.ts        # Plugin settings
│   ├── types.ts             # TypeScript interfaces
│   └── utils.ts             # Link format utilities
├── styles.css               # Plugin styles
├── manifest.json            # Plugin manifest
├── package.json             # npm configuration
├── tsconfig.json            # TypeScript configuration
├── esbuild.config.mjs       # Build configuration
└── .hotreload               # Hot-reload marker
```

## Configuration

The plugin name can be changed by editing:
- `manifest.json` - Change the `id` and `name` fields
- `package.json` - Change the `name` field
- Update the symlink path accordingly

## License

MIT
