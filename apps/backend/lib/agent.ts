/**
 * AI Agent for UI Element Decision-Making
 *
 * Uses an LLM (via Algolia Agent Studio) to:
 * 1. Consume Algolia search results (top UI elements)
 * 2. Select the most relevant elements to highlight
 * 3. Explain why each was selected
 * 4. Return structured HighlightInstructions
 *
 * This agent is NOT a chat interface — it is a deterministic decision-maker
 * that operates on structured data (PageContext + Algolia results).
 *
 * Design principles:
 * - All decisions are grounded in provided data only (no hallucination)
 * - Explanations are concise and evidence-based
 * - Constraints (max highlights, confidence threshold) are enforced
 * - The agent gracefully degrades if LLM is unavailable
 */

import type { UIElement, PageContext, HighlightInstruction } from '@beacon/shared'
import { getProvider, type LLMMessage } from './llm'

/**
 * Represents a single decision made by the agent.
 */
export interface AgentDecision {
  selector: string
  elementType: string
  elementText: string
  reason: string
  confidence: 'low' | 'medium' | 'high'
  style: 'outline' | 'glow'
}

/**
 * Agent output after processing.
 */
export interface AgentOutput {
  decisions: AgentDecision[]
  reasoning: string
  tokensUsed?: number
}

/**
 * Configuration for agent constraints.
 */
export interface AgentConfig {
  maxHighlights?: number
  minConfidence?: 'low' | 'medium' | 'high'
  timeout?: number
}

/**
 * System prompt for the UI guidance agent.
 * Defines the agent's role, constraints, and output format.
 */
function buildSystemPrompt(): string {
  return `You are a UI guidance agent for complex webpages.
Your role is to select the most relevant UI elements to highlight for a user.

CRITICAL RULES:
1. You MUST ONLY reference elements provided in the Algolia search results.
2. You MUST NOT hallucinate elements, selectors, or content.
3. You MUST explain your reasoning based on element type and visibility.
4. You MUST return decisions as valid JSON (no markdown).
5. Be concise — explanations should be 1-2 sentences max.

ELEMENT TYPES:
- heading: Page headings (h1, h2, h3, etc.) — usually high priority
- button: Interactive buttons — often important for user actions
- link: Hyperlinks — relevant if text matches common actions
- text: Paragraphs, sections, articles — lower priority unless key content

CONFIDENCE LEVELS:
- high: Element is clearly relevant (e.g., main heading, primary button)
- medium: Element is moderately relevant (e.g., secondary button, subheading)
- low: Element might be relevant but less certain

OUTPUT FORMAT (STRICT JSON):
{
  "decisions": [
    {
      "selector": "<CSS selector>",
      "elementType": "<heading|button|link|text>",
      "elementText": "<visible text, max 50 chars>",
      "reason": "<1-2 sentence explanation>",
      "confidence": "<low|medium|high>",
      "style": "<outline|glow>"
    }
  ],
  "reasoning": "<Brief explanation of your selection strategy>"
}

STYLE RECOMMENDATIONS:
- headings: use 'outline' (clear border)
- buttons/links: use 'glow' (attention-grabbing)
- other: use 'outline' (default)

Be selective. Highlight only the most useful 2-3 elements per page.`
}

/**
 * Build the user prompt with Algolia results and page context.
 */
function buildUserPrompt(
  context: PageContext,
  algoliaResults: UIElement[]
): string {
  const visibleElementsCount = context.elements.filter((e) => e.isVisible).length
  const headings = algoliaResults.filter((e) => e.type === 'heading')
  const interactive = algoliaResults.filter((e) => e.type === 'button' || e.type === 'link')
  const textElements = algoliaResults.filter((e) => e.type === 'text')

  return `CURRENT PAGE:
URL: ${context.url}
Viewport: ${context.viewport.width}x${context.viewport.height}
Visible elements on page: ${visibleElementsCount}

ALGOLIA SEARCH RESULTS (top candidates):
Total results: ${algoliaResults.length}

Headings (${headings.length}):
${headings.map((e) => `  - selector: "${e.selector}", text: "${e.text.substring(0, 50)}", visible: ${e.isVisible}`).join('\n')}

Interactive Elements (${interactive.length}):
${interactive.map((e) => `  - selector: "${e.selector}", type: ${e.type}, text: "${e.text.substring(0, 50)}", visible: ${e.isVisible}`).join('\n')}

Other Content (${textElements.length}):
${textElements.map((e) => `  - selector: "${e.selector}", text: "${e.text.substring(0, 50)}", visible: ${e.isVisible}`).join('\n')}

USER INTERACTIONS:
${context.interactions.length > 0 ? context.interactions.map((i) => `  - ${i.type}: "${i.elementText}"`).join('\n') : '  (none)'}

TASK:
Select 2-3 of the most relevant elements from the above results to highlight.
Consider:
- Element type and visibility
- User interactions (if any)
- Page structure (headings usually come first)
- Element distinctiveness (avoid too many similar elements)

Return ONLY valid JSON. No markdown, no explanation outside the JSON block.`;
}

/**
 * Parse agent output and validate JSON structure.
 */
function parseAgentOutput(content: string): AgentOutput | null {
  try {
    // Try to extract JSON from the response (in case there's extra text)
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('[Agent] No JSON found in response:', content.substring(0, 100))
      return null
    }

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>

    if (!Array.isArray(parsed.decisions)) {
      console.warn('[Agent] Invalid decisions array in response')
      return null
    }

    const decisions = (parsed.decisions as Array<Record<string, unknown>>).map((d) => ({
      selector: String(d.selector || ''),
      elementType: String(d.elementType || ''),
      elementText: String(d.elementText || ''),
      reason: String(d.reason || ''),
      confidence: (d.confidence as 'low' | 'medium' | 'high') || 'medium',
      style: (d.style as 'outline' | 'glow') || 'outline',
    }))

    return {
      decisions,
      reasoning: String(parsed.reasoning || ''),
    }
  } catch (error) {
    console.warn('[Agent] Failed to parse agent output:', error instanceof Error ? error.message : String(error))
    return null
  }
}

/**
 * Apply configuration constraints to agent decisions.
 */
function applyConstraints(
  decisions: AgentDecision[],
  config: AgentConfig
): AgentDecision[] {
  let filtered = [...decisions]

  // Filter by confidence threshold
  if (config.minConfidence) {
    const confidenceOrder = { low: 0, medium: 1, high: 2 }
    const minLevel = confidenceOrder[config.minConfidence]
    filtered = filtered.filter(
      (d) => confidenceOrder[d.confidence] >= minLevel
    )
  }

  // Limit number of highlights
  if (config.maxHighlights && filtered.length > config.maxHighlights) {
    // Prefer high-confidence items
    filtered.sort((a, b) => {
      const confOrder = { low: 0, medium: 1, high: 2 }
      return confOrder[b.confidence] - confOrder[a.confidence]
    })
    filtered = filtered.slice(0, config.maxHighlights)
  }

  return filtered
}

/**
 * Convert agent decisions to HighlightInstructions.
 */
function decisionsToHighlights(decisions: AgentDecision[]): HighlightInstruction[] {
  return decisions.map((d) => ({
    selector: d.selector,
    style: d.style,
    reason: d.reason,
    priority: d.confidence === 'high' ? 'high' : d.confidence === 'medium' ? 'normal' : 'low',
  }))
}

/**
 * Run the AI agent to decide which elements to highlight.
 *
 * Process:
 * 1. Take Algolia search results (top UI elements)
 * 2. Build context-aware prompt
 * 3. Call LLM to make decisions
 * 4. Parse and validate output
 * 5. Apply constraints (max highlights, confidence threshold)
 * 6. Convert to HighlightInstructions
 *
 * Returns empty array if the agent fails or is disabled.
 */
export async function runAgent(
  context: PageContext,
  algoliaResults: UIElement[],
  config: AgentConfig = {}
): Promise<AgentOutput | null> {
  // Return early if no results to work with
  if (algoliaResults.length === 0) {
    console.log('[Agent] No Algolia results provided, skipping agent')
    return null
  }

  // Check if LLM is configured
  console.log('[Agent] Checking LLM provider availability, OPENAI_API_KEY set:', !!process.env.OPENAI_API_KEY)
  try {
    const provider = getProvider()
    if (!provider) {
      console.log('[Agent] LLM provider not available')
      return null
    }
  } catch (error) {
    console.warn('[Agent] LLM provider check failed:', error instanceof Error ? error.message : String(error))
    return null
  }

  const timeout = config.timeout || 30000
  const startTime = Date.now()

  try {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: buildSystemPrompt(),
      },
      {
        role: 'user',
        content: buildUserPrompt(context, algoliaResults),
      },
    ]

    console.log('[Agent] Running decision agent on', algoliaResults.length, 'Algolia results')

    const provider = getProvider()
    const response = await Promise.race([
      provider.complete(messages),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`[Agent] Timeout after ${timeout}ms`)), timeout)
      ),
    ])
    console.log(`[Agent] LLM response (first 200 chars):`, response.content.substring(0, 200))

    // Parse agent output
    const output = parseAgentOutput(response.content)
    if (!output) {
      console.warn('[Agent] Failed to parse agent output')
      return null
    }

    // Apply constraints
    const constrainedDecisions = applyConstraints(output.decisions, {
      maxHighlights: config.maxHighlights || 5,
      minConfidence: config.minConfidence || 'low',
    })

    console.log('[Agent] Agent produced', constrainedDecisions.length, 'decisions after constraints')

    return {
      decisions: constrainedDecisions,
      reasoning: output.reasoning,
      tokensUsed: response.tokensUsed,
    }
  } catch (error) {
    const elapsed = Date.now() - startTime
    console.warn(
      `[Agent] Agent execution failed after ${elapsed}ms:`,
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

/**
 * Convert agent output to HighlightInstructions for rendering.
 */
export function agentOutputToHighlights(output: AgentOutput): HighlightInstruction[] {
  return decisionsToHighlights(output.decisions)
}
