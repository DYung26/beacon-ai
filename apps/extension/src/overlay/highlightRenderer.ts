/**
 * Highlight Renderer
 *
 * This module handles the actual rendering of visual highlights on the page.
 * Supports multiple simultaneous highlights with tooltips, applies animations,
 * and handles scroll/resize updates without blocking user interaction.
 */

import type { HighlightInstruction } from '@beacon/shared'

// IDs for highlight elements
const BEACON_HIGHLIGHT_CONTAINER_ID = 'beacon-highlight-container'
const BEACON_HIGHLIGHT_CLASS = 'beacon-highlight'
const BEACON_TOOLTIP_CLASS = 'beacon-tooltip'

// Visual configuration
const HIGHLIGHT_PADDING_PX = 6 // Space between element and highlight border
const ANIMATION_DURATION_MS = 300

/**
 * Highlight styles are now loaded via manifest.json's content_scripts.css
 * instead of being injected dynamically. This avoids CSP violations on
 * sites like GitHub that restrict script-src and style-src.
 *
 * The CSS file is in public/highlight-styles.css and is referenced in
 * manifest.json's content_scripts section.
 */

interface HighlightEntry {
  instruction: HighlightInstruction
  targetElement: Element
  highlightEl: HTMLElement
  tooltipEl: HTMLElement
  isVisible: boolean
  animationFrameId: number | null
  resizeObserver: ResizeObserver | null
}

// Store all active highlights by selector
const activeHighlights = new Map<string, HighlightEntry>()

let highlightContainer: HTMLElement | null = null
let scrollListener: (() => void) | null = null
let resizeListener: (() => void) | null = null

/**
 * Initialize the highlight rendering system.
 * Creates the highlight container (styles are already loaded via manifest.json).
 * Safe to call multiple times.
 */
export function initializeHighlighting(): void {
  // Styles are now loaded via manifest.json content_scripts.css
  // (public/highlight-styles.css), so we do NOT inject them dynamically.
  // This avoids CSP violations on sites like GitHub.

  // Create highlight container if not present
  if (!document.getElementById(BEACON_HIGHLIGHT_CONTAINER_ID)) {
    highlightContainer = document.createElement('div')
    highlightContainer.id = BEACON_HIGHLIGHT_CONTAINER_ID
    document.body.appendChild(highlightContainer)
  } else {
    highlightContainer = document.getElementById(BEACON_HIGHLIGHT_CONTAINER_ID)
  }

  // Setup listeners
  setupScrollListener()
  setupResizeListener()
}

/**
 * Create a new highlight element with tooltip.
 * Returns a HighlightEntry ready to be positioned and animated.
 */
function createHighlightElement(
  instruction: HighlightInstruction,
  targetElement: Element
): HighlightEntry {
  if (!highlightContainer) {
    throw new Error('Highlight container not initialized')
  }

  // Create highlight wrapper with padding
  const highlightEl = document.createElement('div')
  highlightEl.className = `${BEACON_HIGHLIGHT_CLASS} highlight-${instruction.style || 'outline'}`
  if (instruction.style === 'glow') {
    highlightEl.classList.add('animate')
  }
  highlightContainer.appendChild(highlightEl)

  // Create tooltip - supports full text on hover
  const tooltipEl = document.createElement('div')
  tooltipEl.className = BEACON_TOOLTIP_CLASS
  tooltipEl.title = instruction.reason || 'Highlighted' // Full text in title attribute
  tooltipEl.textContent = instruction.reason || 'Highlighted'
  highlightContainer.appendChild(tooltipEl)

  // Add hover listener to elevate tooltip z-index above all others
  // This ensures tooltips are always readable when hovered, even if they overlap
  tooltipEl.addEventListener('mouseenter', () => {
    // Store current z-index and set to maximum to bring to front
    tooltipEl.style.zIndex = '2147483648' // Just above other tooltips
    activeHighlights.forEach((entry) => {
      // Reset other tooltips to normal z-index
      if (entry.tooltipEl !== tooltipEl) {
        entry.tooltipEl.style.zIndex = '2147483647'
      }
    })
  })

  tooltipEl.addEventListener('mouseleave', () => {
    // Reset to normal z-index when hover ends
    tooltipEl.style.zIndex = '2147483647'
  })

  return {
    instruction,
    targetElement,
    highlightEl,
    tooltipEl,
    isVisible: false,
    animationFrameId: null,
    resizeObserver: null,
  }
}

/**
 * Render a highlight on the specified element.
 * Smoothly animates the highlight into view.
 * Supports multiple simultaneous highlights.
 *
 * @param instruction - What and how to highlight
 */
export function renderHighlight(instruction: HighlightInstruction): void {
  if (!highlightContainer) {
    initializeHighlighting()
  }

  // Find the target element
  let targetElement: Element | null = null
  try {
    targetElement = document.querySelector(instruction.selector)
  } catch {
    console.warn(`[Beacon] Invalid selector: ${instruction.selector}`)
    return
  }

  if (!targetElement) {
    console.warn(`[Beacon] Element not found: ${instruction.selector}`)
    return
  }

  // Reuse existing highlight or create new one
  let entry = activeHighlights.get(instruction.selector)
  if (!entry) {
    entry = createHighlightElement(instruction, targetElement)
    activeHighlights.set(instruction.selector, entry)
  } else {
    // Update instruction in case reason changed
    entry.instruction = instruction
  }

  // Position the highlight
  updateHighlightPosition(entry)

  // Animate in
  setTimeout(() => {
    entry!.highlightEl.classList.add('visible')
    entry!.tooltipEl.classList.add('visible')
    entry!.isVisible = true
  }, 10) // Small delay to trigger CSS transition

  // Start continuous position updates
  startPositionTracking(entry)
}

/**
 * Clear all highlights with a fade animation.
 */
export function clearAllHighlights(): void {
  for (const entry of activeHighlights.values()) {
    entry.highlightEl.classList.remove('visible')
    entry.tooltipEl.classList.remove('visible')
    entry.isVisible = false
  }

  setTimeout(() => {
    for (const entry of activeHighlights.values()) {
      stopPositionTracking(entry)
      if (entry.highlightEl.parentNode) {
        entry.highlightEl.parentNode.removeChild(entry.highlightEl)
      }
      if (entry.tooltipEl.parentNode) {
        entry.tooltipEl.parentNode.removeChild(entry.tooltipEl)
      }
    }
    activeHighlights.clear()
  }, ANIMATION_DURATION_MS)
}

/**
 * Clear a specific highlight by selector.
 */
export function clearHighlight(selector: string): void {
  const entry = activeHighlights.get(selector)
  if (!entry) {
    return
  }

  entry.highlightEl.classList.remove('visible')
  entry.tooltipEl.classList.remove('visible')
  entry.isVisible = false

  setTimeout(() => {
    stopPositionTracking(entry)
    if (entry.highlightEl.parentNode) {
      entry.highlightEl.parentNode.removeChild(entry.highlightEl)
    }
    if (entry.tooltipEl.parentNode) {
      entry.tooltipEl.parentNode.removeChild(entry.tooltipEl)
    }
    activeHighlights.delete(selector)
  }, ANIMATION_DURATION_MS)
}

/**
 * Update the position and size of a highlight to match its target element.
 * Accounts for scroll offset, viewport positioning, and padding.
 */
function updateHighlightPosition(entry: HighlightEntry): void {
  const rect = entry.targetElement.getBoundingClientRect()

  // Apply negative padding to expand the highlight around the element
  const left = rect.left - HIGHLIGHT_PADDING_PX
  const top = rect.top - HIGHLIGHT_PADDING_PX
  const width = rect.width + HIGHLIGHT_PADDING_PX * 2
  const height = rect.height + HIGHLIGHT_PADDING_PX * 2

  // Position highlight relative to viewport (fixed positioning)
  entry.highlightEl.style.left = `${left}px`
  entry.highlightEl.style.top = `${top}px`
  entry.highlightEl.style.width = `${width}px`
  entry.highlightEl.style.height = `${height}px`

  // Position tooltip above the highlight (if space, else below)
  const tooltipHeight = 28 // Approximate height of tooltip in normal state
  const tooltipGap = 8 // Gap between highlight and tooltip
  const tooltipTop = top - tooltipHeight - tooltipGap
  const tooltipLeft = Math.max(0, left) // Don't go off-screen left

  if (tooltipTop < 0) {
    // Not enough space above, position below instead
    entry.tooltipEl.style.top = `${top + height + tooltipGap}px`
    entry.tooltipEl.classList.remove('above')
  } else {
    entry.tooltipEl.style.top = `${tooltipTop}px`
    entry.tooltipEl.classList.add('above')
  }

  entry.tooltipEl.style.left = `${tooltipLeft}px`
}

/**
 * Setup scroll listener for continuous highlight position updates.
 */
function setupScrollListener(): void {
  if (scrollListener) {
    return // Already setup
  }

  scrollListener = () => {
    for (const entry of activeHighlights.values()) {
      if (entry.isVisible) {
        // Use requestAnimationFrame to debounce updates
        if (entry.animationFrameId !== null) {
          cancelAnimationFrame(entry.animationFrameId)
        }
        entry.animationFrameId = requestAnimationFrame(() => {
          updateHighlightPosition(entry)
        })
      }
    }
  }

  window.addEventListener('scroll', scrollListener, true) // Capture phase for early update
}

/**
 * Setup resize listener for continuous highlight updates on window resize.
 */
function setupResizeListener(): void {
  if (resizeListener) {
    return // Already setup
  }

  resizeListener = () => {
    for (const entry of activeHighlights.values()) {
      if (entry.isVisible) {
        updateHighlightPosition(entry)
      }
    }
  }

  window.addEventListener('resize', resizeListener)
}

/**
 * Start tracking position changes for a highlight using ResizeObserver.
 * This ensures highlights stay aligned even if the target element changes size.
 */
function startPositionTracking(entry: HighlightEntry): void {
  // Stop existing observer
  if (entry.resizeObserver) {
    entry.resizeObserver.disconnect()
  }

  // Create new observer to track target element changes
  entry.resizeObserver = new ResizeObserver(() => {
    if (entry.isVisible) {
      updateHighlightPosition(entry)
    }
  })

  entry.resizeObserver.observe(entry.targetElement)
}

/**
 * Stop tracking position changes for a highlight.
 */
function stopPositionTracking(entry: HighlightEntry): void {
  if (entry.resizeObserver) {
    entry.resizeObserver.disconnect()
    entry.resizeObserver = null
  }
}

/**
 * Get the current set of active highlights.
 */
export function getActiveHighlights(): HighlightInstruction[] {
  return Array.from(activeHighlights.values()).map((entry) => entry.instruction)
}

/**
 * Check if a highlight is currently visible by selector.
 */
export function isHighlightVisible(selector?: string): boolean {
  if (!selector) {
    return activeHighlights.size > 0
  }
  const entry = activeHighlights.get(selector)
  return entry ? entry.isVisible : false
}

/**
 * Cleanup highlight rendering system.
 * Removes listeners and all highlight elements.
 */
export function cleanupHighlighting(): void {
  clearAllHighlights()

  if (scrollListener) {
    window.removeEventListener('scroll', scrollListener, true)
    scrollListener = null
  }

  if (resizeListener) {
    window.removeEventListener('resize', resizeListener)
    resizeListener = null
  }

  if (highlightContainer && highlightContainer.parentNode) {
    highlightContainer.parentNode.removeChild(highlightContainer)
    highlightContainer = null
  }

  // Note: Styles are now loaded via manifest.json and do NOT need to be removed
  // (public/highlight-styles.css is automatically loaded/unloaded by the browser)
}
