// Overlay initialization script
// This is loaded as a separate bundle and injected into the page by the content script
// It mounts the React overlay into a Shadow DOM container for style isolation

import { getCurrentPageContext } from '../content/domObserver'
import { createOverlayManager } from './overlayManager'
import { startHighlightSystem, createHighlightManager } from './highlightManager'
import { createGuideCoordinator } from '../content/guideCoordinator'
import { createGuideIntegration } from './guideIntegration'
import { requestGuideFromOverlay } from './guideClientOverlay'

// NOTE: DOM observer is already initialized in the content script (content/observer.ts)
// We do NOT initialize it again here, as it would create a duplicate instance.
// Instead, we use getCurrentPageContext() which uses the __beaconGetContext
// function that was exposed by the content script.

// Create the overlay manager and mount the React app
const overlayManager = createOverlayManager()

// Expose overlay manager to window for debugging if needed
declare global {
  interface Window {
    __beaconOverlay?: typeof overlayManager
    __beaconSelfHighlightingEnabled?: boolean
  }
}
window.__beaconOverlay = overlayManager
// Initialize self-highlighting as enabled by default
window.__beaconSelfHighlightingEnabled = true

/**
 * Create highlight manager first, as we need it in the coordinator's onResponse callback.
 */
const highlightManager = createHighlightManager()
highlightManager.initialize()

/**
 * Initialize the guide API coordinator for backend communication.
 *
 * IMPORTANT: We use requestGuideFromOverlay as the custom request function.
 * This ensures that all fetch() calls happen in the content script context,
 * which is NOT subject to webpage CSP restrictions.
 *
 * Flow:
 * 1. Overlay sends request via window.postMessage()
 * 2. Content script receives message and executes fetch()
 * 3. Content script sends response back via window.postMessage()
 * 4. Overlay receives response and updates highlights
 *
 * CRITICAL: onResponse callback triggers immediate highlight updates.
 * This ensures highlights render as soon as the backend responds,
 * not just on scroll/resize events.
 */
const guideCoordinator = createGuideCoordinator({
  requestFn: requestGuideFromOverlay, // Use message-based communication
  onResponse: (response) => {
    // Render highlights immediately when response arrives
    highlightManager.updateFromGuide(response)
  },
  onError: (error) => {
    console.warn('[Beacon] Guide API request failed:', error.message)
  },
})

// Create highlight manager separately for integration
// (Already created above before guideCoordinator for onResponse callback)

// Set up guide integration bridge
const guideIntegration = createGuideIntegration(
  guideCoordinator,
  highlightManager,
  overlayManager
)

// Initialize the highlight system
// This will automatically select and render highlights based on page content
// and use backend guide API when available
let stopHighlighting: (() => void) | null = null

try {
  stopHighlighting = startHighlightSystem(getCurrentPageContext, guideCoordinator)
} catch (error) {
  console.warn('[Beacon] Failed to start highlight system:', error)
}

// Listen for self-highlighting toggle changes from the overlay
window.addEventListener('message', (event) => {
  if (event.source !== window) return
  
  const message = event.data
  if (!message || typeof message !== 'object') return
  
  // Handle self-highlighting toggle
  if (message.type === 'beacon:set-self-highlighting') {
    const enabled = message.enabled as boolean
    window.__beaconSelfHighlightingEnabled = enabled
    
    // If disabled, clear current highlights
    if (!enabled) {
      highlightManager.clear()
    }
  }
})

// Debug toggle: Press Alt + B to show/hide the overlay
document.addEventListener('keydown', (event) => {
  if (event.altKey && event.code === 'KeyB') {
    event.preventDefault()
    overlayManager.toggle()
  }
})

// Set up chat message handler in the overlay
// This listens for chat responses from the content script
window.addEventListener('message', async (event) => {
  if (event.source !== window) return

  const message = event.data
  if (!message || typeof message !== 'object') return

  // Handle chat responses from content script
  if (message.type === 'beacon:chat-response') {
    const { payload } = message as {
      type: string
      id: string
      payload: { message: string; highlights: any[] }
    }

    // Update highlights if the chat response includes new ones
    if (payload.highlights && payload.highlights.length > 0) {
      highlightManager.updateFromGuide({
        highlights: payload.highlights,
        debug: { reason: 'Chat-driven highlights' },
      })
    }

    // Broadcast to overlay to update chat UI
    const chatUpdateEvent = new CustomEvent('beacon:chat-response', {
      detail: payload,
    })
    window.dispatchEvent(chatUpdateEvent)
  }
})

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (stopHighlighting) {
    stopHighlighting()
  }
  guideIntegration.cleanup()
})

console.log('[Beacon] Initialized')
