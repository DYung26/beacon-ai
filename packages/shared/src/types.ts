/**
 * Page Context and UI Element Models
 * Defines explicit, intentional data structures for DOM observation.
 */

/**
 * Bounding box of an element on the page.
 * Coordinates include scroll offset (page coordinates, not viewport).
 */
export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Visibility state of an element relative to the viewport.
 */
export type VisibilityState = 'in-viewport' | 'partially-visible' | 'offscreen'

/**
 * Type category of a UI element.
 */
export type UIElementType = 'heading' | 'text' | 'button' | 'link'

/**
 * Represents a single visible DOM element on the page.
 * Extracted from the rendered DOM, not raw HTML.
 */
export interface UIElement {
  /** Unique identifier within this session */
  id: string
  /** Element category */
  type: UIElementType
  /** HTML tag name (e.g., "h1", "button", "a") */
  tag: string
  /** Visible text content (trimmed, max 500 chars) */
  text: string
  /** Stable CSS selector for this element */
  selector: string
  /** Position and size on the page */
  boundingBox: BoundingBox
  /** Visibility relative to viewport */
  visibility: VisibilityState
  /** Whether element is currently visible (convenience flag) */
  isVisible: boolean
}

/**
 * Type of user interaction.
 */
export type InteractionType = 'click'

/**
 * Records a user interaction with the page.
 */
export interface Interaction {
  /** Type of interaction */
  type: InteractionType
  /** CSS selector of the element that was interacted with */
  elementId: string
  /** Visible text of the element or its parent */
  elementText: string
  /** When the interaction occurred */
  timestamp: number
  /** X coordinate of the interaction (page coordinates) */
  x: number
  /** Y coordinate of the interaction (page coordinates) */
  y: number
}

/**
 * Viewport dimensions and scroll position.
 */
export interface ViewportContext {
  /** Window inner width in pixels */
  width: number
  /** Window inner height in pixels */
  height: number
  /** Horizontal scroll position */
  scrollX: number
  /** Vertical scroll position */
  scrollY: number
}

/**
 * Snapshot of the page state at a moment in time.
 * Represents what the user can see and has interacted with.
 */
export interface PageContext {
  /** Current page URL */
  url: string
  /** When this snapshot was captured */
  timestamp: number
  /** Current viewport and scroll state */
  viewport: ViewportContext
  /** All visible UI elements on the page */
  elements: UIElement[]
  /** Interaction history (bounded list, most recent last) */
  interactions: Interaction[]
}

/**
 * Style variant for visual highlights.
 */
export type HighlightStyle = 'outline' | 'glow'

/**
 * Instructions for rendering a visual highlight on a page element.
 * Describes which element to highlight and how to visually highlight it.
 */
export interface HighlightInstruction {
  /** CSS selector of the element to highlight */
  selector: string
  /** Visual style to apply (outline or glow) */
  style?: HighlightStyle
  /** Optional human-readable reason for the highlight */
  reason?: string
  /** Optional priority level (default: 'normal') */
  priority?: 'low' | 'normal' | 'high'
}

/**
 * Request sent from the extension to the backend guide API.
 * Contains the current page context for analysis.
 */
export interface GuideRequest {
  /** Current page context snapshot */
  pageContext: PageContext
}

/**
 * Response returned from the backend guide API.
 * Contains instructions for what to highlight on the page.
 */
export interface GuideResponse {
  /** List of highlight instructions to render */
  highlights: HighlightInstruction[]
  /** Optional debug information */
  debug?: {
    processingTimeMs?: number
    elementsConsidered?: number
    reason?: string
  }
}
