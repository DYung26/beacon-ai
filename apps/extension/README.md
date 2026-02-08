# Beacon Chrome Extension

This is a Manifest v3 Chrome extension built with React and TypeScript using Vite.

The extension injects a React-based overlay into webpages using Shadow DOM for complete style isolation.

## Building and Loading the Extension

### Build the extension

```bash
npm run build
```

This outputs the extension to `dist/` with:
- `manifest.json` - Extension configuration
- `content.js` - Content script that runs on all URLs and injects the overlay
- `overlay.js` - React overlay application (mounted in Shadow DOM)
- `index.html` + `main.js` - Main app bundle (currently a template for future features)

### Load in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Navigate to the `dist/` directory in this folder
5. Click **Select Folder**

The extension is now installed and active on all websites.

## Testing the Overlay and DOM Observer

### Verify the Content Script is Running

1. Visit any website
2. Open DevTools (F12)
3. Go to the **Console** tab
4. You should see:
   - `✓ Beacon content script loaded`
   - `✓ Beacon DOM observer initialized`
   - `✓ Beacon overlay initialized (press Alt + B to toggle)`
   - `[Beacon DOM Observer]` summary with element and interaction counts
   - `[Beacon Elements]` and `[Beacon Interactions]` detailed logs

### Inspect the Captured Page Context

1. Visit any information-dense page (e.g., a news site or search results page)
2. Open DevTools Console
3. Type: `window.__beaconGetContext()` to see the current snapshot
4. Scroll the page and watch the element list update automatically (debounced)
5. Click on elements and check the `interactions` array in the context

### See the Overlay

When you load the extension on a website:
- **A purple panel should appear in the top-right corner** of the page with the Beacon logo
- The overlay is rendered inside a Shadow DOM for complete style isolation from the host page

### Toggle the Overlay (Debug)

Press **Alt + B** to show/hide the overlay on any page.

You can also programmatically control the overlay from the DevTools console:
```javascript
window.__beaconOverlay.toggle()    // Toggle visibility
window.__beaconOverlay.isVisible() // Check if visible
window.__beaconOverlay.unmount()   // Remove overlay
window.__beaconOverlay.mount()     // Re-mount overlay
```

## DOM Observer and Context Capture

The extension now includes a **DOM Observer** that captures a grounded snapshot of visible page elements and user interactions.

### What is Captured

The DOM observer extracts and tracks:

- **Visible Elements**: Headings (h1-h6), text blocks (p, section, article), buttons, and links
- **Element Metadata**: 
  - Visible text content (trimmed, max 500 chars)
  - Tag name
  - Reasonably stable CSS selector
  - Bounding box (x, y, width, height in page coordinates)
  - Visibility state (in-viewport, partially-visible, or offscreen)
- **Viewport Context**: Width, height, scroll position
- **User Interactions**: Clicks (element selector, text, coordinates, timestamp)

### Visibility Rules

An element is considered visible only if:
- `display !== 'none'`
- `visibility !== 'hidden'`
- `opacity > 0`
- Bounding box has non-zero width and height
- Element is in viewport or within 1000px below it

Hidden elements are automatically excluded.

### Accessing Page Context

In the DevTools console on any page:

```javascript
// Get the current page context snapshot
window.__beaconGetContext()

// Get the context object directly (updates in real-time)
window.__beaconDOMContext

// Context object structure
{
  url: string,
  timestamp: number,
  viewport: { width, height, scrollX, scrollY },
  elements: [
    {
      id: string,
      type: 'heading' | 'text' | 'button' | 'link',
      tag: string,
      text: string,
      selector: string,
      boundingBox: { x, y, width, height },
      visibility: 'in-viewport' | 'partially-visible' | 'offscreen',
      isVisible: boolean
    }
  ],
  interactions: [
    {
      type: 'click',
      elementId: string,
      elementText: string,
      timestamp: number,
      x: number,
      y: number
    }
  ]
}
```

### Logging

The observer logs to the console whenever the page context updates:
- Initial page load: `[Beacon DOM Observer]` summary
- Detailed element and interaction lists: `[Beacon Elements]` and `[Beacon Interactions]`
- Scroll/resize events trigger context refresh (debounced 200ms)

## How the Overlay Works

The overlay is injected through a multi-layer architecture:

1. **Content Script** (`src/content/observer.ts`): Runs in the extension context, initializes the DOM observer, and injects the overlay script as an ES6 module
2. **Overlay Script** (`src/overlay/init.ts`): Loaded as `<script type="module">` in the page context, initializes the React app
3. **React Components** (`src/overlay/Overlay.tsx`): The actual UI component
4. **Shadow DOM**: Provides complete style isolation so host page CSS cannot affect Beacon's UI

### Script Injection Details

- The content script injects `overlay.js` with `<script type="module">` which allows ES6 import statements
- The `overlay.js` module imports React dependencies from `assets/jsx-runtime-*.js` (made accessible via manifest)
- This separation allows the overlay to run in the page context while keeping styles isolated

### Key Features

- **Style Isolation**: Uses Shadow DOM to prevent host page styles from affecting the overlay
- **Idempotent Injection**: Safe to call mount multiple times; won't create duplicates
- **Debug Toggle**: Press Alt + B to show/hide the overlay
- **Console API**: Exposed `window.__beaconOverlay` for debugging and testing
- **DOM Observation**: Passive observation of page structure and user interactions for context capture

## Project Structure

- `src/content/observer.ts` - Content script (runs in extension context, initializes DOM observer)
- `src/content/domObserver.ts` - DOM observation and context capture (visible elements, viewport, interactions)
- `src/overlay/init.ts` - Overlay initialization (runs in page context)
- `src/overlay/Overlay.tsx` - React overlay component
- `src/overlay/overlayManager.ts` - Handles Shadow DOM creation and React mounting
- `src/overlay/styles.ts` - Overlay styles (injected into Shadow DOM)
- `public/manifest.json` - Chrome Extension manifest (Manifest v3)
- `vite.config.ts` - Vite configuration with multiple entry points

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.
