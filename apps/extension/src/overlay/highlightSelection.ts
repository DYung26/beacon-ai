/**
 * Temporary Highlight Selection Logic
 *
 * This module contains a simple, deterministic rule for selecting which
 * elements to highlight on the page. This rule is TEMPORARY and will be
 * replaced by a real decision system later.
 *
 * Current Rule: Select the first visible heading and the first visible
 * interactive element, rendering them simultaneously.
 */

import type { PageContext, HighlightInstruction } from '@beacon/shared'

/**
 * TEMPORARY: Select elements to highlight based on a simple rule.
 *
 * This rule is deliberately simple and deterministic:
 * 1. Always include the first visible heading (h1-h6) if found
 * 2. Also include the first visible interactive element (button or link)
 * 3. Return an array of instructions (may be empty or contain 1-2 items)
 *
 * TODO: Replace this with a proper decision system that considers:
 * - User navigation history
 * - Page structure and semantics
 * - Element importance and prominence
 * - AI/ML-based relevance scoring
 * - User preferences and personalization
 *
 * @param context - Current page context with elements
 * @returns Array of HighlightInstructions (may be empty)
 */
export function selectElementsToHighlight(
  context: PageContext
): HighlightInstruction[] {
  if (!context.elements || context.elements.length === 0) {
    return []
  }

  const instructions: HighlightInstruction[] = []

  // Strategy 1: Find the first visible heading
  const heading = context.elements.find(
    (el) =>
      el.type === 'heading' &&
      (el.visibility === 'in-viewport' || el.visibility === 'partially-visible')
  )

  if (heading) {
    instructions.push({
      selector: heading.selector,
      style: 'outline',
      reason: `Heading: "${heading.text.substring(0, 50)}"`,
      priority: 'normal',
    })
  }

  // Strategy 2: Find the first visible interactive element (button or link)
  const interactive = context.elements.find(
    (el) =>
      (el.type === 'button' || el.type === 'link') &&
      (el.visibility === 'in-viewport' || el.visibility === 'partially-visible')
  )

  if (interactive) {
    instructions.push({
      selector: interactive.selector,
      style: 'glow',
      reason: `Interactive: "${interactive.text.substring(0, 50)}"`,
      priority: 'low',
    })
  }

  return instructions
}
