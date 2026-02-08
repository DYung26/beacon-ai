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
 *
 * UPDATED: Tone changed from descriptive documentation to conversational guidance.
 * The agent now speaks directly to the user (second person) using soft, uncertain
 * language ("looks like", "you might", "you can") to explain WHY elements are
 * relevant, not WHAT they are.
 */
function buildSystemPrompt(): string {
  return `You are a helpful guide for complex webpages. Your role is to highlight elements that might help the user navigate or understand the page better.

CRITICAL RULES:
1. You MUST ONLY reference elements provided in the Algolia search results.
2. You MUST NOT hallucinate elements, selectors, or content.
3. You MUST explain your reasoning based on what the user might be looking for.
4. You MUST return decisions as valid JSON (no markdown).
5. Be concise — explanations should be 1-2 sentences max.

TONE & LANGUAGE:
- Speak directly to the user ("you", "your")
- Use soft, uncertain language: "looks like", "you might be", "you can", "if you want to"
- Explain WHY an element is useful, not WHAT it is
- Sound helpful and collaborative, not instructional

ELEMENT TYPES:
- heading: Page headings (h1, h2, h3, etc.) — signposts for page organization
- button: Interactive buttons — entry points for user actions
- link: Hyperlinks — pathways to related content or actions
- text: Paragraphs, sections, articles — detailed information and context

CONFIDENCE LEVELS:
- high: Element is clearly useful (e.g., you're probably looking at the main section, this is a key action button)
- medium: Element is probably relevant (e.g., secondary navigation, supporting information)
- low: Element might help but less certain

OUTPUT FORMAT (STRICT JSON):
{
  "decisions": [
    {
      "selector": "<CSS selector>",
      "elementType": "<heading|button|link|text>",
      "elementText": "<visible text, max 50 chars>",
      "reason": "<1-2 sentence guidance, speaking to the user>",
      "confidence": "<low|medium|high>",
      "style": "<outline|glow>"
    }
  ],
  "reasoning": "<Brief explanation of your selection strategy>"
}

STYLE RECOMMENDATIONS:
- headings: use 'outline' (clear, structural)
- buttons/links: use 'glow' (action-oriented)
- other: use 'outline' (default)

Highlight elements that genuinely help the user. Multiple highlights are fine if they each offer real guidance.`
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
Select all relevant elements from the above results to highlight.
Consider:
- Element type and visibility
- User interactions (if any)
- Page structure (headings usually come first)
- Element distinctiveness (avoid too many similar elements)
- Multiple highlights are acceptable if they provide genuine guidance

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

/**
 * Build a system prompt for highlight selection in CHAT MODE.
 * 
 * This is DIFFERENT from the general highlight agent prompt.
 * In chat mode, the agent should:
 * - Select ONLY elements directly relevant to the user's specific request
 * - Avoid broad, general selections
 * - Prefer precision over coverage
 * - Return FEW highlights, not MANY
 * 
 * The user asked for something specific. The AI must respect that scope.
 */
function buildChatHighlightSystemPrompt(): string {
  return `You are a precise guide for webpages. Your role is to highlight elements that directly answer a user's specific question.

CRITICAL RULES:
1. You MUST ONLY reference elements provided in the page elements list.
2. You MUST NOT hallucinate elements, selectors, or content.
3. You are answering a SPECIFIC USER QUESTION — not providing general page guidance.
4. Select ONLY elements that directly satisfy the user's request.
5. You MUST return decisions as valid JSON (no markdown).
6. Be highly selective — prefer 0-2 highlights to many highlights.

SELECTION STRATEGY:
- If the user asks for one thing, highlight ONE element (the best match).
- If the user asks for multiple things, highlight those (and only those).
- DO NOT highlight "other useful" or "contextual" elements unless explicitly asked.
- DO NOT highlight headings just for navigation unless the user asked for navigation.

CONFIDENCE LEVELS:
- high: Element perfectly matches the user's request
- medium: Element matches but with minor ambiguity
- low: Element might relate but is not a direct match

OUTPUT FORMAT (STRICT JSON):
{
  "decisions": [
    {
      "selector": "<CSS selector>",
      "elementType": "<heading|button|link|text>",
      "elementText": "<visible text, max 50 chars>",
      "reason": "<1-2 sentence explanation of why this element matches the request>",
      "confidence": "<low|medium|high>",
      "style": "<outline|glow>"
    }
  ],
  "reasoning": "<Brief explanation of your selection strategy>"
}

STYLE RECOMMENDATIONS:
- headings: use 'outline' (if they're the answer to the question)
- buttons/links: use 'glow' (direct actions the user might want)
- other: use 'outline' (default)

Remember: The user asked for something SPECIFIC. Honor that specificity.`
}

/**
 * Build a user prompt for highlight selection in CHAT MODE.
 * 
 * This prompt includes the user's specific request, so the agent
 * understands it should select narrowly and precisely.
 */
function buildChatHighlightUserPrompt(
  userMessage: string,
  visibleElements: UIElement[],
  pageUrl?: string
): string {
  const headings = visibleElements.filter((e) => e.type === 'heading').slice(0, 10)
  const interactive = visibleElements.filter((e) => e.type === 'button' || e.type === 'link').slice(0, 10)
  const textElements = visibleElements.filter((e) => e.type === 'text').slice(0, 10)

  // Extract domain from URL for context
  let siteName = ''
  if (pageUrl) {
    try {
      const url = new URL(pageUrl)
      siteName = `\nCurrent site: ${url.hostname}`
    } catch {
      // Ignore URL parsing errors
    }
  }

  return `USER'S SPECIFIC REQUEST:
"${userMessage}"${siteName}

AVAILABLE ELEMENTS ON PAGE:
Headings (${headings.length}):
${headings.map((e) => `  - selector: "${e.selector}", text: "${e.text.substring(0, 50)}"`).join('\n')}

Interactive Elements (${interactive.length}):
${interactive.map((e) => `  - selector: "${e.selector}", type: ${e.type}, text: "${e.text.substring(0, 50)}"`).join('\n')}

Content (${textElements.length}):
${textElements.map((e) => `  - selector: "${e.selector}", text: "${e.text.substring(0, 50)}"`).join('\n')}

TASK:
Select ONLY elements that directly answer or satisfy the user's request above.
Be highly selective. If nothing matches the request, return empty decisions.
Return ONLY valid JSON. No markdown, no explanation outside the JSON block.`
}

/**
 * Run the highlight agent in CHAT MODE.
 * 
 * This is a variant of runAgent() specifically for responding to user chat requests.
 * It uses a different system prompt that emphasizes precision and directness:
 * - Highlight ONLY elements matching the user's specific request
 * - Avoid broad selections
 * - Return few highlights (0-2) rather than many
 * 
 * @param userMessage - The user's specific request
 * @param visibleElements - All visible elements on the page (not Algolia filtered)
 * @param config - Agent configuration (maxHighlights, minConfidence, timeout)
 * @returns Promise resolving to AgentOutput | null
 */
export async function runChatHighlightAgent(
  userMessage: string,
  visibleElements: UIElement[],
  config: AgentConfig = {},
  pageUrl?: string
): Promise<AgentOutput | null> {
  if (visibleElements.length === 0) {
    console.log('[Chat Highlight Agent] No visible elements, skipping agent')
    return null
  }

  const timeout = config.timeout || 15000
  const startTime = Date.now()

  try {
    const provider = getProvider()
    if (!provider) {
      console.log('[Chat Highlight Agent] LLM provider not available')
      return null
    }

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: buildChatHighlightSystemPrompt(),
      },
      {
        role: 'user',
        content: buildChatHighlightUserPrompt(userMessage, visibleElements, pageUrl),
      },
    ]

    console.log('[Chat Highlight Agent] Running with user request:', userMessage.substring(0, 60))

    const response = await Promise.race([
      provider.complete(messages),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`[Chat Highlight Agent] Timeout after ${timeout}ms`)), timeout)
      ),
    ])

    console.log(`[Chat Highlight Agent] LLM response (first 150 chars):`, response.content.substring(0, 150))

    // Parse agent output
    const output = parseAgentOutput(response.content)
    if (!output) {
      console.warn('[Chat Highlight Agent] Failed to parse agent output')
      return null
    }

    // Apply stricter constraints for chat mode
    // Default to max 2-3 highlights in chat mode (user asked for something specific)
    const constrainedDecisions = applyConstraints(output.decisions, {
      maxHighlights: config.maxHighlights || 3,
      minConfidence: config.minConfidence || 'low',
    })

    console.log('[Chat Highlight Agent] Agent produced', constrainedDecisions.length, 'decisions for chat request')

    return {
      decisions: constrainedDecisions,
      reasoning: output.reasoning,
      tokensUsed: response.tokensUsed,
    }
  } catch (error) {
    const elapsed = Date.now() - startTime
    console.warn(
      `[Chat Highlight Agent] Execution failed after ${elapsed}ms:`,
      error instanceof Error ? error.message : String(error)
    )
    return null
  }
}

/**
 * Build a conversational system prompt for chat responses.
 * This is SEPARATE from the highlight-selection agent prompt.
 * 
 * The chat agent should:
 * - Respond naturally to user queries
 * - Explain what it found on the page
 * - NOT expose internal element selection reasoning
 */
function buildChatSystemPrompt(): string {
  return `You are a helpful assistant guiding someone through a complex webpage. Your role is to:
1. Answer the user's specific questions about the page
2. Explain what relevant content you found
3. Help them understand what's available

CRITICAL RULES:
- Be conversational and helpful
- Only mention elements that actually exist on the page
- Keep responses concise (1-3 sentences max)
- Do NOT explain HOW you selected elements or WHY you ranked them
- Do NOT mention internal decision-making or reasoning about element types
- Speak naturally to the user ("you", "your", "I found")

TONE:
- Friendly and direct
- Acknowledge what the user is looking for
- Offer concrete guidance based on what's available on the page`
}

/**
 * Build a prompt for the chat agent that incorporates the user's message and available elements.
 * IMPORTANT: Now includes page URL so AI knows which site it's on.
 */
function buildChatUserPrompt(
  userMessage: string,
  visibleElements: UIElement[],
  pageUrl?: string
): string {
  const elementsByType = {
    heading: visibleElements.filter((e) => e.type === 'heading').slice(0, 5),
    button: visibleElements.filter((e) => e.type === 'button').slice(0, 5),
    link: visibleElements.filter((e) => e.type === 'link').slice(0, 5),
    text: visibleElements.filter((e) => e.type === 'text').slice(0, 5),
  }

  const elementsList = [
    elementsByType.heading.length > 0 ? `Headings: ${elementsByType.heading.map((e) => `"${e.text.substring(0, 30)}"`).join(', ')}` : null,
    elementsByType.button.length > 0 ? `Buttons: ${elementsByType.button.map((e) => `"${e.text.substring(0, 30)}"`).join(', ')}` : null,
    elementsByType.link.length > 0 ? `Links: ${elementsByType.link.map((e) => `"${e.text.substring(0, 30)}"`).join(', ')}` : null,
    elementsByType.text.length > 0 ? `Content: ${elementsByType.text.map((e) => `"${e.text.substring(0, 30)}"`).join(', ')}` : null,
  ].filter((x) => x !== null)

  // Extract domain from URL for context
  let siteName = ''
  if (pageUrl) {
    try {
      const url = new URL(pageUrl)
      siteName = `\nYou are on: ${url.hostname}`
    } catch {
      // Ignore URL parsing errors
    }
  }

  return `User's question: "${userMessage}"${siteName}

Available on the page:
${elementsList.join('\n')}

Respond to the user's question naturally. Identify which elements on the page are relevant to their question and explain what you found. Keep your response concise and friendly.`
}

/**
 * Chat Agent: Processes conversational user queries and returns highlights + explanation.
 *
 * This function:
 * 1. Takes a user message (conversational intent)
 * 2. Receives page context (current visible elements)
 * 3. Uses a SEPARATE conversational prompt to respond naturally
 * 4. Also runs the highlight agent to decide what to highlight
 * 5. Returns both a conversational response and highlight instructions
 *
 * IMPORTANT: The chat response uses a different system prompt than the highlight agent.
 * This ensures chat responses are conversational, not analytical.
 *
 * @param userMessage - The user's question or request
 * @param pageContext - Current page context with elements
 * @returns Promise resolving to { message: assistant response, highlights: HighlightInstructions[] }
 */
export async function runChatAgent(
  userMessage: string,
  pageContext?: PageContext
): Promise<{ message: string; highlights: HighlightInstruction[] }> {
  try {
    // If no page context, return a helpful message
    if (!pageContext || !pageContext.elements || pageContext.elements.length === 0) {
      return {
        message: 'I can see you\'re on a page, but I don\'t have visibility into the elements right now. Try asking about something specific on the page.',
        highlights: [],
      }
    }

    // For chat mode, use all visible elements as candidates
    const visibleElements = pageContext.elements.filter(
      (el) => el.visibility !== 'offscreen'
    )

    if (visibleElements.length === 0) {
      return {
        message: 'I don\'t see any visible elements on the page right now. Try scrolling and asking again.',
        highlights: [],
      }
    }

    // Step 1: Generate a conversational response using the chat prompt
    let conversationalMessage = ''
    try {
      const provider = getProvider()
      if (provider) {
        const chatMessages: LLMMessage[] = [
          {
            role: 'system',
            content: buildChatSystemPrompt(),
          },
          {
            role: 'user',
            content: buildChatUserPrompt(userMessage, visibleElements, pageContext.url),
          },
        ]

        const chatResponse = await Promise.race([
          provider.complete(chatMessages),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Chat response timeout')), 15000)
          ),
        ])

        conversationalMessage = chatResponse.content.trim()
        console.log('[Chat Agent] Generated conversational response:', conversationalMessage.substring(0, 100))
      }
    } catch (error) {
      console.warn('[Chat Agent] Failed to generate conversational response:', error instanceof Error ? error.message : String(error))
      conversationalMessage = `I found some content on the page related to "${userMessage}". Check the highlighted elements below.`
    }

    // Step 2: Run the CHAT-SPECIFIC highlight agent to decide what to highlight
    // This uses a precision-focused prompt that respects the user's specific request
    // (different from the general highlight-selection agent used in proactive mode)
    const highlightConfig: AgentConfig = {
      maxHighlights: 3, // Stricter limit in chat mode (user asked for something specific)
      minConfidence: 'low',
      timeout: 15000,
    }

    let highlights: HighlightInstruction[] = []
    try {
      const highlightOutput = await runChatHighlightAgent(userMessage, visibleElements, highlightConfig, pageContext.url)
      if (highlightOutput && highlightOutput.decisions.length > 0) {
        highlights = agentOutputToHighlights(highlightOutput)
        console.log('[Chat Agent] Generated', highlights.length, 'highlights from chat-specific highlight agent')
      } else {
        console.log('[Chat Agent] Chat highlight agent returned no decisions')
      }
    } catch (error) {
      console.warn('[Chat Agent] Failed to generate highlights:', error instanceof Error ? error.message : String(error))
      // No highlights on error — that's okay, the conversational response stands alone
    }

    return {
      message: conversationalMessage,
      highlights,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('[Chat Agent] Error processing chat request:', msg)

    return {
      message: 'I encountered an issue understanding your request. Please try again.',
      highlights: [],
    }
  }
}
