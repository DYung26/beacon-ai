# Beacon

**Beacon is a browser extension that uses AI to intelligently highlight relevant UI elements on complex webpages, helping users navigate more effectively.**

Instead of overwhelming users with all interactive elements, Beacon learns what matters on each page and visually guides attention to the most useful features.

## Features

- 🔍 **AI-Powered Highlighting**: Uses LLMs to understand page context and decide what's important
- 💬 **Interactive Chat**: Ask Beacon questions about the page ("Where's my username?")
- 🎯 **Multiple Highlight Styles**: Outline for headings, glow animation for interactive elements
- 🚀 **Fast Search**: Algolia powers instant indexing and retrieval of page elements
- 📱 **Overlay + Popup**: Highlights appear on the page; chat available in overlay or popup
- ⌨️ **Keyboard Control**: Alt+B to toggle modes
- 🔄 **Graceful Fallbacks**: Works even without AI, using deterministic highlighting
- 🛡️ **CSP-Safe**: Designed to work on sites with strict content security policies (GitHub, etc.)

## How It Works

1. **Observe**: Extension scans the page for visible elements (headings, buttons, text, links, inputs)
2. **Index**: Elements are sent to Algolia for fast searching
3. **Decide**: AI agent analyzes context and selects 1-5 most relevant elements
4. **Highlight**: Selected elements are visually marked with cyan borders and tooltips
5. **Explain**: Each highlight includes a conversational explanation

### User Modes

**Rectangle Mode** (default)
- Passive highlighting based on inferred page intent
- Highlights update as you scroll
- Useful for understanding page structure

**Chat Mode** (Alt+B)
- Ask Beacon direct questions
- Highlights appear only for matching results
- Get precise, intent-specific guidance

## Getting Started

### Prerequisites

- Node.js 18+
- Chrome/Chromium browser
- OpenAI API key (optional, for AI features)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/DYung26/beacon-ai.git
   cd beacon-ai
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Build the extension**
   ```bash
   cd apps/extension
   pnpm run build
   ```

4. **Load in Chrome**
   - Open `chrome://extensions`
   - Enable "Developer mode" (top-right corner)
   - Click "Load unpacked"
   - Select `apps/extension/dist`

5. **Start the backend** (in another terminal)
   ```bash
   cd apps/backend
   cp .env.example .env.local  # Configure if needed
   pnpm run dev
   # Runs on http://localhost:3000
   ```

6. **Test it out**
   - Navigate to any webpage (e.g., GitHub)
   - Beacon overlay appears in top-right
   - Click Alt+B to toggle modes
   - Try asking questions in chat mode

### Configuration

Create `.env.local` in `apps/backend/`:

```bash
# Required for AI agent
OPENAI_API_KEY=sk-...

# Optional: LLM model to use (default: gpt-4o-mini)
OPENAI_MODEL=gpt-4o-mini

# Optional: Algolia credentials (will be auto-generated or provide your own)
NEXT_PUBLIC_ALGOLIA_APP_ID=...
NEXT_PUBLIC_ALGOLIA_SEARCH_KEY=...
ALGOLIA_ADMIN_KEY=...
```

## Usage

### Keyboard Shortcuts

- **Alt+B**: Toggle Beacon modes (Hidden → Rectangle → Chat → Hidden)
- **X button**: Close Beacon completely
- **In chat**: Type your question, press Enter to send

### Chat Examples

```
"Show me where my username is"
→ Highlights your GitHub username

"Where can I see my achievements?"
→ Highlights the achievements section

"Show me navigation"
→ Highlights menu/navigation elements
```

## Architecture

Beacon consists of three main parts:

**Extension** (`apps/extension/`)
- Content script observes DOM and extracts visible elements
- Overlay renders highlights and chat UI
- Popup provides fallback chat interface

**Backend** (`apps/backend/`)
- `/api/guide` endpoint receives PageContext and returns HighlightInstructions
- Indexes elements into Algolia
- Orchestrates AI agent for highlight decisions

**AI Agent** (powered by OpenAI)
- Analyzes page context and search results
- Selects relevant elements to highlight
- Generates conversational explanations

For detailed architecture, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Development

### Project Structure

```
beacon-ai/
├── apps/
│   ├── extension/           # Chrome extension (content script, overlay, popup)
│   └── backend/             # Next.js API backend
├── packages/
│   └── shared/              # Shared TypeScript types
├── docs/                    # Architecture documentation
└── README.md               # This file
```

### Building for Development

```bash
# Extension
cd apps/extension
pnpm run dev      # Watch mode
pnpm run build    # Production build

# Backend
cd apps/backend
pnpm run dev      # Start dev server with hot reload
pnpm run build    # Production build
```

### Debugging

**In Browser DevTools** (webpage console):
```javascript
// View current page context
window.__beaconDOMContext

// Get snapshot of page state
window.__beaconGetContext()

// Access context history (last 50 snapshots)
window.__beaconContextHistory.getLatest()
window.__beaconContextHistory.getAll()

// View logs from extension
// Look for [Beacon] prefixed messages
```

**Backend Logs** (terminal):
```bash
# Watch logs
tail -f apps/backend/.next/server.log

# Look for patterns:
# [Guide API] - Highlight decision logic
# [Algolia] - Search results
# [Agent] - AI decision logs
```

## Known Limitations

- ⚠️ **Element Extraction**: Only visible elements are extracted, no dynamic content detection
- ⚠️ **Keyboard Suppression**: Chat overlay uses best-effort keyboard capture; popup fallback recommended for complex sites
- ⚠️ **AI Optional**: Works without OpenAI key, but highlighting uses deterministic rules instead
- ⚠️ **No Persistence**: Highlights don't survive page reload
- ⚠️ **English Only**: Designed for English interfaces

## Browser Compatibility

- ✅ Chrome 120+
- ✅ Chromium-based browsers (Edge, Brave, etc.)
- ❌ Firefox (Manifest v3 not supported)
- ❌ Safari (Manifest v3 not supported)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly (extension + backend)
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Acknowledgments

- **Algolia** for fast search indexing
- **OpenAI** for GPT language models
- **React** for UI rendering

## Quick Reference

| Action | Result |
|--------|--------|
| Alt+B (once) | Show rectangle overlay |
| Alt+B (twice) | Show chat bubble |
| Alt+B (three times) | Hide Beacon |
| X button | Close Beacon |
| Type in chat | Send query to AI |
| Hover tooltip | Expand full explanation |
| Scroll page | Highlights update automatically |

## Roadmap

**Near-term**
- [ ] Multi-language support
- [ ] User preferences/settings
- [ ] Highlight history in chat

**Medium-term**
- [ ] Per-domain AI customization
- [ ] Real-time DOM mutation tracking
- [ ] Persistent highlight storage

**Long-term**
- [ ] Mobile browser support
- [ ] Collaborative highlighting
- [ ] Custom LLM backends

---

For technical details, architecture decisions, and API documentation, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

Have questions? Open an issue on GitHub!
