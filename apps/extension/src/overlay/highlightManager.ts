/**
 * Highlight Manager
 *
 * Coordinates the highlight selection and rendering system.
 * Bridges between DOM observation (what elements exist) and backend/local highlight logic.
 * Supports multiple simultaneous highlights.
 *
 * Integration points:
 * - May use backend guide API (via external caller)
 * - Falls back to local temporary selection if no backend response
 */

import type { PageContext, GuideResponse } from '@beacon/shared'
import { selectElementsToHighlight } from './highlightSelection'
import {
  initializeHighlighting,
  renderHighlight,
  clearHighlight,
  clearAllHighlights,
  isHighlightVisible,
  getActiveHighlights,
  cleanupHighlighting,
} from './highlightRenderer'

interface HighlightManagerInterface {
  initialize: () => void
  update: (context: PageContext) => void
  updateFromGuide: (guideResponse: GuideResponse) => void
  clear: () => void
  cleanup: () => void
  isActive: () => boolean
  getHighlightCount: () => number
}

let initialized = false
let currentSelectors = new Set<string>()

/**
 * Create and return the highlight manager.
 * The manager is responsible for selecting which elements to highlight
 * and rendering highlights as the page changes.
 */
export function createHighlightManager(): HighlightManagerInterface {
  function initialize(): void {
    if (initialized) {
      return
    }

    initializeHighlighting()
    initialized = true
    console.log('✓ Beacon highlight manager initialized')
  }

  function update(context: PageContext): void {
    if (!initialized) {
      return
    }

    // Use local temporary selection logic
    // This will be replaced by backend responses when guide API is active
    const instructions = selectElementsToHighlight(context)
    const newSelectors = new Set(instructions.map((i) => i.selector))

    // Remove highlights that are no longer selected
    for (const selector of currentSelectors) {
      if (!newSelectors.has(selector)) {
        clearHighlight(selector)
      }
    }

    // Add/update highlights for selected elements
    for (const instruction of instructions) {
      renderHighlight(instruction)
    }

    currentSelectors = newSelectors
  }

  /**
   * Update highlights based on backend guide response.
   * Replaces any local selection with backend-provided instructions.
   */
  function updateFromGuide(guideResponse: GuideResponse): void {
    if (!initialized) {
      return
    }

    const newSelectors = new Set(guideResponse.highlights.map((i) => i.selector))

    // Remove highlights that are no longer in the guide response
    for (const selector of currentSelectors) {
      if (!newSelectors.has(selector)) {
        clearHighlight(selector)
      }
    }

    // Add/update highlights from guide response
    for (const instruction of guideResponse.highlights) {
      renderHighlight(instruction)
    }

    currentSelectors = newSelectors
  }

  function clear(): void {
    if (isHighlightVisible()) {
      clearAllHighlights()
      currentSelectors.clear()
    }
  }

  function cleanup(): void {
    clear()
    cleanupHighlighting()
    initialized = false
    console.log('✓ Beacon highlight manager cleaned up')
  }

  function isActive(): boolean {
    return initialized && isHighlightVisible()
  }

  function getHighlightCount(): number {
    return getActiveHighlights().length
  }

  return {
    initialize,
    update,
    updateFromGuide,
    clear,
    cleanup,
    isActive,
    getHighlightCount,
  }
}

/**
 * Create a highlight manager and integrate it with DOM observation and guide API.
 * Updates highlights whenever the page context changes.
 *
 * If guideCoordinator is provided, the system will:
 * 1. Request guide highlights from the backend
 * 2. Use backend responses to update highlights
 * 3. Fall back to local selection if guide fails
 *
 * If guideCoordinator is not provided, uses local selection only.
 */
export function startHighlightSystem(
  getPageContext: () => PageContext,
  guideCoordinator?: {
    requestGuide: (context: PageContext) => Promise<void>
    getLastResponse: () => GuideResponse | null
  }
): () => void {
  const manager = createHighlightManager()
  manager.initialize()

  let lastContext: PageContext | null = null
  let lastGuideRequestTime = 0
  const MIN_GUIDE_REQUEST_INTERVAL = 2000 // Minimum 2s between guide requests

  // Function to update highlights based on context
  // This is called when the page context changes (via scroll/resize listeners)
  function updateHighlights(context: PageContext) {
    try {
      const now = Date.now()
      
      // If guide coordinator is available, request backend guide
      // But only if enough time has passed since last request
      if (guideCoordinator && now - lastGuideRequestTime >= MIN_GUIDE_REQUEST_INTERVAL) {
        lastGuideRequestTime = now
        guideCoordinator.requestGuide(context).catch((error) => {
          console.warn('[Beacon] Failed to request guide:', error)
        })
      }

      // If there's a cached response, use it; otherwise fall back to local selection
      if (guideCoordinator) {
        const lastResponse = guideCoordinator.getLastResponse()
        if (lastResponse) {
          manager.updateFromGuide(lastResponse)
        } else {
          manager.update(context)
        }
      } else {
        // No guide coordinator - use local selection only
        manager.update(context)
      }
    } catch (error) {
      console.warn('[Beacon] Error updating highlights:', error)
    }
  }

  // Set up event listeners for page changes
  let scrollTimeout: number | null = null
  let resizeTimeout: number | null = null
  const SCROLL_DEBOUNCE = 300
  const RESIZE_DEBOUNCE = 300

  // Scroll listener: Update when user scrolls
  const handleScroll = () => {
    if (scrollTimeout !== null) {
      clearTimeout(scrollTimeout)
    }
    scrollTimeout = window.setTimeout(() => {
      const context = getPageContext()
      if (context !== lastContext) {
        lastContext = context
        updateHighlights(context)
      }
      scrollTimeout = null
    }, SCROLL_DEBOUNCE)
  }

  // Resize listener: Update when viewport resizes
  const handleResize = () => {
    if (resizeTimeout !== null) {
      clearTimeout(resizeTimeout)
    }
    resizeTimeout = window.setTimeout(() => {
      const context = getPageContext()
      if (context !== lastContext) {
        lastContext = context
        updateHighlights(context)
      }
      resizeTimeout = null
    }, RESIZE_DEBOUNCE)
  }

  // Add event listeners
  window.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('resize', handleResize, { passive: true })

  // Initial highlight render
  const initialContext = getPageContext()
  lastContext = initialContext
  updateHighlights(initialContext)

  // Return cleanup function
  return () => {
    window.removeEventListener('scroll', handleScroll)
    window.removeEventListener('resize', handleResize)
    
    if (scrollTimeout !== null) {
      clearTimeout(scrollTimeout)
      scrollTimeout = null
    }
    if (resizeTimeout !== null) {
      clearTimeout(resizeTimeout)
      resizeTimeout = null
    }
    manager.cleanup()
  }
}
