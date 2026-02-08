/**
 * Guide API Endpoint
 * POST /api/guide
 *
 * Accepts a PageContext snapshot from the extension and returns HighlightInstructions
 * for what to highlight on the page.
 *
 * Decision pipeline:
 * 1. Index elements into Algolia
 * 2. Search Algolia for relevant elements
 * 3. (Optional) Run AI agent to select best elements
 * 4. Fall back to deterministic rule if steps 1-3 fail
 */

import type { GuideRequest, GuideResponse, PageContext } from '@beacon/shared'
import { indexPageElements, searchElements, suggestQueries } from '../../../lib/algolia'
import { runAgent, agentOutputToHighlights } from '../../../lib/agent'

/**
 * Validate that the request contains a valid PageContext.
 * Performs basic shape checks only.
 */
function validatePageContext(context: unknown): context is PageContext {
  if (!context || typeof context !== 'object') {
    return false
  }

  const obj = context as Record<string, unknown>

  // Check required top-level fields
  if (typeof obj.url !== 'string') {
    return false
  }

  if (typeof obj.timestamp !== 'number') {
    return false
  }

  // Check viewport
  if (!obj.viewport || typeof obj.viewport !== 'object') {
    return false
  }

  const viewport = obj.viewport as Record<string, unknown>
  if (
    typeof viewport.width !== 'number' ||
    typeof viewport.height !== 'number' ||
    typeof viewport.scrollX !== 'number' ||
    typeof viewport.scrollY !== 'number'
  ) {
    return false
  }

  // Check elements array exists
  if (!Array.isArray(obj.elements)) {
    return false
  }

  // Check interactions array exists
  if (!Array.isArray(obj.interactions)) {
    return false
  }

  return true
}

/**
 * Simple deterministic rule to select elements to highlight.
 * Attempts several strategies in order:
 * 1. AI agent on Algolia results (if LLM is available)
 * 2. Algolia search with deterministic queries
 * 3. Fallback to hardcoded heuristics
 */
async function selectElementsToHighlight(
  context: PageContext
): Promise<GuideResponse> {
  const highlights: GuideResponse['highlights'] = []
  const elementsConsidered = context.elements.length
  let strategy = 'deterministic'

  try {
    // Index elements into Algolia
    console.log('[Guide API] Indexing', context.elements.length, 'elements from', context.url)
    await indexPageElements(context)
    
    // Wait for Algolia indexing to complete
    // Algolia is eventually consistent; we need to give it time to process the newly indexed records
    // 2 seconds is typically sufficient for most operations, but longer for peak load
    await new Promise(resolve => setTimeout(resolve, 2000))

    // Get suggested queries based on page content
    let queries = suggestQueries(context)
    
    // Defensive: Filter out empty queries to prevent Algolia no-match issue
    queries = queries.filter((q) => q && q.trim().length > 0)
    console.log('[Guide API] Generated', queries.length, 'non-empty queries:', queries)

    // Execute queries and collect results
    const allSelectors = new Set<string>()
    const allResults: typeof context.elements = []
    
    if (queries.length > 0) {
      for (const query of queries) {
        // Search Algolia WITHOUT visibility filter (no facets)
        // We'll filter visibility in-memory after getting results
        const selectors = await searchElements(query, context.url, {
          limit: 5,
        })
        console.log(`[Guide API] Query "${query}" returned ${selectors.length} results:`, selectors)

        // Collect full elements for agent, filtering by visibility in-memory
        for (const selector of selectors) {
          const element = context.elements.find((e) => e.selector === selector)
          // Only include visible elements
          if (element && element.isVisible && !allResults.find((r) => r.selector === selector)) {
            allResults.push(element)
            allSelectors.add(selector)
          }
        }
      }

      console.log('[Guide API] Total unique selectors found after visibility filter:', allSelectors.size)
    } else {
      console.warn('[Guide API] No non-empty queries generated, skipping Algolia search')
    }

    // Try AI agent if we have Algolia results
    if (allResults.length > 0 && process.env.OPENAI_API_KEY) {
      console.log('[Guide API] Running AI agent on', allResults.length, 'Algolia results')
      const agentOutput = await runAgent(context, allResults, {
        maxHighlights: 50,
        minConfidence: 'low',
        timeout: 10000,
      })

      if (agentOutput && agentOutput.decisions.length > 0) {
        strategy = 'ai-agent'
        const agentHighlights = agentOutputToHighlights(agentOutput)
        highlights.push(...agentHighlights)
        console.log('[Guide API] AI agent selected', agentHighlights.length, 'elements')
      } else {
        console.log('[Guide API] AI agent failed or produced no results, falling back to Algolia results')
      }
    }

    // Convert selectors back to elements and create highlights (if not using agent)
    if (highlights.length === 0 && allSelectors.size > 0) {
      strategy = 'algolia'
      const selectorArray = Array.from(allSelectors)

      for (const selector of selectorArray) {
        const element = context.elements.find((e) => e.selector === selector)
        if (element) {
          highlights.push({
            selector: element.selector,
            style: element.type === 'heading' ? 'outline' : 'glow',
            reason: `Found via search: ${element.type}`,
            priority:
              element.type === 'heading' || element.type === 'button'
                ? 'high'
                : 'normal',
          })
        } else {
          console.warn('[Guide API] Selector found in Algolia but not in context elements:', selector)
        }
      }
    } else if (highlights.length === 0) {
      console.log('[Guide API] No selectors found from Algolia queries, will use fallback')
    }
  } catch (error) {
    console.warn('[Guide API] Algolia search failed, using fallback:', error)
    // Fall through to fallback logic
  }

  // Fallback: If no results from Algolia or agent, use deterministic rule
  if (highlights.length === 0) {
    strategy = 'deterministic-fallback'
    console.log('[Guide API] No highlights from Algolia/agent, using deterministic fallback')

    // Find first visible heading
    const heading = context.elements.find(
      (elem) => elem.type === 'heading' && elem.isVisible
    )
    if (heading) {
      console.log('[Guide API] Found heading:', heading.selector, heading.text.substring(0, 50))
      highlights.push({
        selector: heading.selector,
        style: 'outline',
        reason: 'First visible heading on the page',
        priority: 'high',
      })
    } else {
      console.log('[Guide API] No visible headings found in context.elements')
    }

    // Find first visible button or link
    const interactive = context.elements.find(
      (elem) =>
        (elem.type === 'button' || elem.type === 'link') && elem.isVisible
    )
    if (interactive) {
      console.log('[Guide API] Found interactive:', interactive.selector, interactive.text.substring(0, 50))
      highlights.push({
        selector: interactive.selector,
        style: 'glow',
        reason: `First visible ${interactive.type} on the page`,
        priority: 'normal',
      })
    } else {
      console.log('[Guide API] No visible interactive elements found in context.elements')
    }
  }

  return {
    highlights,
    debug: {
      elementsConsidered,
      reason: `Strategy: ${strategy}`,
    },
  }
}

/**
 * Add CORS headers to response.
 * Allows requests from the browser extension.
 */
function addCorsHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * OPTIONS handler for CORS preflight.
 */
export async function OPTIONS(): Promise<Response> {
  return addCorsHeaders(
    new Response(null, {
      status: 204,
    })
  )
}

/**
 * POST handler for /api/guide
 * Accepts GuideRequest, returns GuideResponse.
 */
export async function POST(request: Request): Promise<Response> {
  const startTime = Date.now()

  try {
    // Parse request body
    const body = await request.json()

    // Validate request structure
    if (!body || typeof body !== 'object') {
      console.warn('[Beacon Guide API] Invalid request body')
      return addCorsHeaders(
        Response.json(
          {
            error: 'Invalid request body',
            highlights: [],
          },
          { status: 400 }
        )
      )
    }

    const guideRequest = body as unknown

    // Check if this looks like a GuideRequest
    if (
      typeof guideRequest === 'object' &&
      guideRequest !== null &&
      'pageContext' in guideRequest
    ) {
      const pageContext = (guideRequest as Record<string, unknown>)
        .pageContext as unknown

      // Validate PageContext
      if (!validatePageContext(pageContext)) {
        console.warn('[Beacon Guide API] Invalid PageContext in request')
        return addCorsHeaders(
          Response.json(
            {
              error: 'Invalid PageContext',
              highlights: [],
            },
            { status: 400 }
          )
        )
      }

      // Select elements to highlight using Algolia search
      const response = await selectElementsToHighlight(pageContext)

      // Add timing info
      const processingTimeMs = Date.now() - startTime
      if (!response.debug) {
        response.debug = {}
      }
      response.debug.processingTimeMs = processingTimeMs

      // Log for debugging
      console.log('[Beacon Guide API] Processing request', {
        url: pageContext.url,
        elementCount: pageContext.elements.length,
        highlightCount: response.highlights.length,
        processingTimeMs,
      })

      return addCorsHeaders(Response.json(response, { status: 200 }))
    } else {
      console.warn('[Beacon Guide API] Missing pageContext in request')
      return addCorsHeaders(
        Response.json(
          {
            error: 'Missing pageContext',
            highlights: [],
          },
          { status: 400 }
        )
      )
    }
  } catch (error) {
    console.error('[Beacon Guide API] Error processing request:', error)
    return addCorsHeaders(
      Response.json(
        {
          error: 'Internal server error',
          highlights: [],
        },
        { status: 500 }
      )
    )
  }
}
