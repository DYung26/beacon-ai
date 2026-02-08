/**
 * Stable Selector Generation
 * Generates reasonably stable CSS selectors for DOM elements.
 * Centralized utility for consistent selector generation across the extension.
 */

/**
 * Generate a reasonably stable selector for an element.
 * Strategy (in order of preference):
 * 1. ID-based: #elementId (most stable)
 * 2. Class-based: tag.class1.class2 (fairly stable)
 * 3. Path-based: html > body > main:nth-of-type(2) (fallback)
 *
 * Note: Selectors are deterministic but NOT guaranteed to be globally unique
 * or persist across major DOM restructuring. They are intended to be stable
 * within a single session for the purpose of identifying previously-seen elements.
 */
export function generateStableSelector(element: Element): string {
  // Prefer ID if available (most stable)
  if (element.id) {
    return `#${element.id}`
  }

  // Try class-based selector if classes are present
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(/\s+/).filter((c) => c)
    if (classes.length > 0) {
      return `${element.tagName.toLowerCase()}.${classes.join('.')}`
    }
  }

  // Fall back to path-based selector
  return buildPathSelector(element)
}

/**
 * Build a path-based selector using tag names and nth-of-type.
 * Example: html > body > main > article:nth-of-type(2)
 */
function buildPathSelector(element: Element): string {
  const path: string[] = []
  let current: Element | null = element

  while (current && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase()

    // Add nth-of-type if there are siblings with the same tag
    if (current.parentElement) {
      const siblings = Array.from(current.parentElement.children).filter(
        (el) => el.tagName === current?.tagName
      )
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1
        selector += `:nth-of-type(${index})`
      }
    }

    path.unshift(selector)
    current = current.parentElement
  }

  return path.join(' > ')
}
