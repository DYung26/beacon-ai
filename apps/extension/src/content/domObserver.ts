/**
 * DOM Observer and Context Capture
 * 
 * This module observes the rendered DOM and captures a structured snapshot of:
 * - Visible page elements (headings, text, interactive elements)
 * - Viewport and scroll context
 * - User interactions (clicks)
 * 
 * Key principle: Only capture elements that are actually visible to the user.
 * No HTML serialization, no full DOM tree, no interpretation of intent.
 */

import type {
  BoundingBox,
  UIElement,
  UIElementType,
  VisibilityState,
  PageContext,
} from '@beacon/shared'
import { generateStableSelector } from './selectorUtils'
import { ContextHistory } from './contextHistory'

declare global {
  interface Window {
    __beaconDOMContext?: PageContext
    __beaconGetContext?: () => PageContext
    __beaconContextHistory?: ContextHistory
  }
}

// ============================================================================
// Visibility Detection
// ============================================================================

/**
 * Check if an element is visible on the page.
 * An element is considered visible if:
 * - display !== 'none'
 * - visibility !== 'hidden'
 * - opacity > 0
 * - bounding box has non-zero size
 * - element is within or near the viewport
 */
function isElementVisible(element: Element): boolean {
  const style = window.getComputedStyle(element)

  // Check display property
  if (style.display === 'none') {
    return false
  }

  // Check visibility property
  if (style.visibility === 'hidden') {
    return false
  }

  // Check opacity
  if (parseFloat(style.opacity) === 0) {
    return false
  }

  // Check bounding box
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) {
    return false
  }

  // Check if element is in viewport or near it (with some buffer)
  const buffer = 1000 // pixels below viewport to consider "near"
  if (
    rect.bottom < -buffer ||
    rect.top > window.innerHeight + buffer
  ) {
    return false
  }

  return true
}

/**
 * Determine visibility state relative to viewport.
 */
function getVisibilityState(
  rect: DOMRect,
  viewportHeight: number
): VisibilityState {
  const top = rect.top
  const bottom = rect.bottom

  // Completely off screen
  if (bottom < 0 || top > viewportHeight) {
    return 'offscreen'
  }

  // Completely in viewport
  if (top >= 0 && bottom <= viewportHeight) {
    return 'in-viewport'
  }

  // Partially visible
  return 'partially-visible'
}

// ============================================================================
// Element Extraction
// ============================================================================

/**
 * Extract text content from an element, trimming whitespace.
 * Skip elements that are just structural or empty.
 */
function extractTextContent(element: Element): string {
  const text = element.textContent || ''
  return text.trim().substring(0, 500) // Limit to 500 chars
}

/**
 * Determine the type of a UI element.
 * Expanded to classify diverse element types for AI reasoning.
 */
function getElementType(element: Element): UIElementType {
  const tag = element.tagName.toLowerCase()
  const role = element.getAttribute('role')

  // Headings
  if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
    return 'heading'
  }

  // Buttons
  if (tag === 'button' || role === 'button' || 
      ['submit', 'reset', 'button'].includes(tag === 'input' ? element.getAttribute('type') || '' : '')) {
    return 'button'
  }

  // Links
  if ((tag === 'a' && element.getAttribute('href')) || role === 'link') {
    return 'link'
  }

  // Form inputs
  if (['input', 'textarea', 'select'].includes(tag)) {
    return 'button' // Treat interactive form elements as button-like
  }

  // Navigation
  if (tag === 'nav' || role === 'navigation') {
    return 'text' // Navigation containers hold text/links
  }

  // Text and content (default)
  return 'text'
}

/**
 * Should we capture this element?
 * Filter to meaningful elements only.
 */
function shouldCaptureElement(element: Element, text: string): boolean {
  // Skip if no visible text
  if (!text || text.length === 0) {
    return false
  }

  // Skip script and style elements
  const tag = element.tagName.toLowerCase()
  if (['script', 'style', 'meta', 'link', 'noscript'].includes(tag)) {
    return false
  }

  // Skip elements with very long text (likely noise)
  if (text.length > 5000) {
    return false
  }

  return true
}

/**
 * Create a BoundingBox from a DOMRect, including scroll offset.
 */
function createBoundingBox(rect: DOMRect): BoundingBox {
  return {
    x: rect.left + window.scrollX,
    y: rect.top + window.scrollY,
    width: rect.width,
    height: rect.height,
  }
}

/**
 * Traverse the DOM and extract visible UI elements.
 * Returns a deduplicated list of meaningful elements.
 * 
 * This function now captures ALL meaningful visible content:
 * - Headings, links, buttons (as before)
 * - Text blocks, paragraphs, list items
 * - Plain text inside generic divs and spans
 * 
 * The goal is to give the AI agent complete page context,
 * not to filter or prioritize elements here.
 * Element filtering and prioritization are AI's job.
 */
function extractVisibleElements(): UIElement[] {
  const elements: UIElement[] = []
  const seenElements = new Set<Element>()
  let elementId = 0

  // First pass: use selectors to capture specific element types
  // (headings, buttons, links, etc.)
  const selectors = [
    // Headings (all levels)
    'h1, h2, h3, h4, h5, h6',
    // Buttons and button-like elements
    'button, [role="button"], input[type="button"], input[type="submit"]',
    // Links and navigation
    'a[href], nav, [role="navigation"]',
    // Text and content blocks
    'p, article, section, div[role="main"], main',
    // Form elements
    'input, textarea, select, label',
    // Lists and list items
    'ul, ol, li, [role="listitem"]',
    // Cards and containers (common UI patterns)
    '[role="article"], [class*="card"], [class*="item"], [class*="row"]',
  ]

  const viewportHeight = window.innerHeight

  for (const selector of selectors) {
    try {
      const foundElements = document.querySelectorAll(selector)

      for (const element of foundElements) {
        // Skip if already processed
        if (seenElements.has(element)) {
          continue
        }

        // Skip if not visible
        if (!isElementVisible(element)) {
          continue
        }

        const text = extractTextContent(element)

        // Skip if no meaningful text
        if (!shouldCaptureElement(element, text)) {
          continue
        }

        const rect = element.getBoundingClientRect()
        const type = getElementType(element)
        const tag = element.tagName.toLowerCase()
        const stableSelector = generateStableSelector(element)
        const visibility = getVisibilityState(rect, viewportHeight)

        elements.push({
          id: `elem-${elementId++}`,
          type,
          tag,
          text,
          selector: stableSelector,
          boundingBox: createBoundingBox(rect),
          visibility,
          isVisible: true,
        })

        seenElements.add(element)
      }
    } catch {
      // Silently skip invalid selectors
    }
  }

  // Second pass: traverse DOM to capture plain text content
  // This captures meaningful text in generic elements (divs, spans, etc.)
  // that might not match the selector list above.
  function traverseForTextElements(node: Node, depth: number = 0): void {
    if (depth > 20) return // Prevent excessive recursion

    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent?.trim() || ''
        
        // Skip whitespace-only text nodes
        if (!text || text.length === 0) {
          continue
        }

        // Skip very long text (likely a parent container with lots of content)
        if (text.length > 5000) {
          continue
        }

        // Use the parent element
        const parentElement = child.parentElement
        if (!parentElement || seenElements.has(parentElement)) {
          continue
        }

        // Skip if not visible
        if (!isElementVisible(parentElement)) {
          continue
        }

        // Skip script, style, and other non-content elements
        const tag = parentElement.tagName.toLowerCase()
        if (['script', 'style', 'meta', 'link', 'noscript', 'head', 'title'].includes(tag)) {
          continue
        }

        // Skip if parent is already a captured semantic element type
        // (we don't want to duplicate headings, buttons, etc.)
        if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'a', 'p', 'li'].includes(tag)) {
          continue
        }

        const rect = parentElement.getBoundingClientRect()
        const stableSelector = generateStableSelector(parentElement)
        const visibility = getVisibilityState(rect, viewportHeight)

        // Capture this text element
        elements.push({
          id: `elem-${elementId++}`,
          type: 'text',
          tag,
          text: text.substring(0, 500),
          selector: stableSelector,
          boundingBox: createBoundingBox(rect),
          visibility,
          isVisible: true,
        })

        seenElements.add(parentElement)
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        // Recursively traverse element nodes
        traverseForTextElements(child, depth + 1)
      }
    }
  }

  // Start traversal from document body
  if (document.body) {
    traverseForTextElements(document.body)
  }

  // Log element extraction statistics for debugging
  const elementCounts = elements.reduce((acc, el) => {
    acc[el.type] = (acc[el.type] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  
  console.log('[Beacon] Extracted elements:', {
    total: elements.length,
    byType: elementCounts,
  })

  return elements
}

// ============================================================================
// Interaction Tracking
// ============================================================================

/**
 * Simple click tracker. Records what the user clicked and where.
 * Stores interactions in the context object.
 */
function setupInteractionTracking(
  context: PageContext,
  maxInteractions: number = 100
): void {
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element
      if (!target) return

      // Build element identifier
      let elementText = ''
      if (target instanceof HTMLElement) {
        elementText = target.textContent?.trim().substring(0, 100) || ''
      }

      // Try to find a meaningful parent if the clicked element is too generic
      let element = target as Element | null
      while (
        element &&
        (!elementText || elementText.length === 0) &&
        element !== document.body
      ) {
        element = element.parentElement
        if (element instanceof HTMLElement) {
          elementText = element.textContent?.trim().substring(0, 100) || ''
        }
      }

      // Record interaction
      context.interactions.push({
        type: 'click',
        elementId: generateStableSelector(target),
        elementText,
        timestamp: Date.now(),
        x: event.clientX,
        y: event.clientY,
      })

      // Keep interactions list bounded
      if (context.interactions.length > maxInteractions) {
        context.interactions.shift()
      }
    },
    true // Use capture phase
  )
}

// ============================================================================
// Context Update
// ============================================================================

/**
 * Update viewport and scroll info in the context.
 */
function updateViewportContext(context: PageContext): void {
  context.viewport = {
    width: window.innerWidth,
    height: window.innerHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }
  context.timestamp = Date.now()
}

/**
 * Rebuild the elements list in the context.
 * Called on scroll and resize to keep element list fresh.
 */
function updateElements(context: PageContext): void {
  context.elements = extractVisibleElements()
}

/**
 * Create a listener for scroll and resize events to update context.
 */
function setupContextUpdaters(
  context: PageContext,
  history: ContextHistory
): void {
  let scrollTimeout: number | null = null
  let resizeTimeout: number | null = null

  // Debounced scroll handler
  document.addEventListener('scroll', () => {
    updateViewportContext(context)

    if (scrollTimeout !== null) {
      clearTimeout(scrollTimeout)
    }

    scrollTimeout = window.setTimeout(() => {
      updateElements(context)
      history.add(context)
      logContext(context)
      scrollTimeout = null
    }, 200)
  })

  // Debounced resize handler
  window.addEventListener('resize', () => {
    updateViewportContext(context)

    if (resizeTimeout !== null) {
      clearTimeout(resizeTimeout)
    }

    resizeTimeout = window.setTimeout(() => {
      updateElements(context)
      history.add(context)
      logContext(context)
      resizeTimeout = null
    }, 200)
  })
}

// ============================================================================
// Logging and Export
// ============================================================================

/**
 * Log the page context to console for inspection.
 * This helps verify that observation is working correctly.
 */
function logContext(context: PageContext): void {
  console.log('[Beacon DOM Observer]', {
    url: context.url,
    viewport: context.viewport,
    elementCount: context.elements.length,
    interactionCount: context.interactions.length,
    timestamp: new Date(context.timestamp).toISOString(),
  })

  console.log('[Beacon Elements]', context.elements)
  console.log('[Beacon Interactions]', context.interactions)
}

/**
 * Get the current page context snapshot.
 */
function getPageContext(): PageContext {
  return domObserverInstance?.getContext() || {
    url: window.location.href,
    timestamp: Date.now(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
    elements: [],
    interactions: [],
  }
}

// ============================================================================
// DOM Observer Instance
// ============================================================================

interface DOMObserver {
  getContext(): PageContext
  getHistory(): ContextHistory
  updateContext(): void
  destroy(): void
}

let domObserverInstance: DOMObserver | null = null

/**
 * Initialize the DOM observer on the page.
 * This function sets up all tracking and can only be called once.
 */
export function initializeDOMObserver(): PageContext {
  if (domObserverInstance) {
    console.warn('[Beacon DOM Observer] Already initialized')
    return domObserverInstance.getContext()
  }

  // Initialize context
  const context: PageContext = {
    url: window.location.href,
    timestamp: Date.now(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
    elements: [],
    interactions: [],
  }

  // Initialize context history
  const history = new ContextHistory(50)

  // Extract initial elements
  context.elements = extractVisibleElements()

  // Add initial context to history
  history.add(context)

  // Setup interaction tracking
  setupInteractionTracking(context)

  // Setup context updaters for scroll and resize
  setupContextUpdaters(context, history)

  // Create observer instance
  domObserverInstance = {
    getContext: () => context,
    getHistory: () => history,
    updateContext: () => {
      updateViewportContext(context)
      updateElements(context)
      history.add(context)
      logContext(context)
    },
    destroy: () => {
      domObserverInstance = null
    },
  }

  // Log initial context
  logContext(context)

  // Expose to window for debugging
  window.__beaconDOMContext = context
  window.__beaconGetContext = getPageContext
  window.__beaconContextHistory = history

  console.log('✓ Beacon DOM observer initialized')

  return context
}

/**
 * Get current page context (for external callers).
 * Note: When called from overlay.js (page context), this will use window.__beaconGetContext
 * if domObserverInstance is not available in this module instance.
 */
export function getCurrentPageContext(): PageContext {
  if (domObserverInstance) {
    return getPageContext()
  }
  // Fallback: For calls from overlay.js which runs in page context,
  // the content script has already exposed __beaconGetContext to window
  const windowGetContext = (window as unknown as Record<string, unknown>).__beaconGetContext as (() => PageContext) | undefined
  if (windowGetContext) {
    return windowGetContext()
  }
  // Last resort: return empty context
  return {
    url: window.location.href,
    timestamp: Date.now(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
    elements: [],
    interactions: [],
  }
}

/**
 * Get the context history (for external callers).
 */
export function getContextHistory(): ContextHistory {
  return domObserverInstance?.getHistory() || new ContextHistory(0)
}
