import type { GuideRequest, GuideResponse, PageContext } from '@beacon/shared'
import { indexPageElements, searchElements, suggestQueries } from '../../../lib/algolia'
import { runAgent, agentOutputToHighlights } from '../../../lib/agent'

function validatePageContext(context: unknown): context is PageContext {
  if (!context || typeof context !== 'object') {
    return false
  }

  const obj = context as Record<string, unknown>

  if (typeof obj.url !== 'string' || typeof obj.timestamp !== 'number') {
    return false
  }

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

  return Array.isArray(obj.elements) && Array.isArray(obj.interactions)
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
    await indexPageElements(context)
    
    // Algolia is eventually consistent; wait for indexing
    await new Promise(resolve => setTimeout(resolve, 2000))

    let queries = suggestQueries(context)
    queries = queries.filter((q) => q && q.trim().length > 0)

    const allSelectors = new Set<string>()
    const allResults: typeof context.elements = []
    
    if (queries.length > 0) {
      for (const query of queries) {
        const selectors = await searchElements(query, context.url, {
          limit: 5,
        })

        for (const selector of selectors) {
          const element = context.elements.find((e) => e.selector === selector)
          if (element && element.isVisible && !allResults.find((r) => r.selector === selector)) {
            allResults.push(element)
            allSelectors.add(selector)
          }
        }
      }
    }

    if (allResults.length > 0 && process.env.OPENAI_API_KEY) {
      const agentOutput = await runAgent(context, allResults, {
        maxHighlights: 50,
        minConfidence: 'low',
        timeout: 10000,
      })

      if (agentOutput && agentOutput.decisions.length > 0) {
        strategy = 'ai-agent'
        const agentHighlights = agentOutputToHighlights(agentOutput)
        highlights.push(...agentHighlights)
      }
    }

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
        }
      }
    }
  } catch (error) {
    console.warn('[Guide API] Search failed:', error instanceof Error ? error.message : String(error))
  }

  if (highlights.length === 0) {
    strategy = 'deterministic'
    const firstHeading = context.elements.find((e) => e.type === 'heading' && e.isVisible)
    if (firstHeading) {
      highlights.push({
        selector: firstHeading.selector,
        style: 'outline',
        reason: 'First visible heading (fallback)',
        priority: 'normal',
      })
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
    const body = await request.json()

    if (!body || typeof body !== 'object') {
      console.warn('[Guide API] Invalid request body')
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

    if (
      typeof guideRequest === 'object' &&
      guideRequest !== null &&
      'pageContext' in guideRequest
    ) {
      const pageContext = (guideRequest as Record<string, unknown>)
        .pageContext as unknown

      if (!validatePageContext(pageContext)) {
        console.warn('[Guide API] Invalid PageContext')
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

      const response = await selectElementsToHighlight(pageContext)

      const processingTimeMs = Date.now() - startTime
      if (!response.debug) {
        response.debug = {}
      }
      response.debug.processingTimeMs = processingTimeMs

      return addCorsHeaders(Response.json(response, { status: 200 }))
    } else {
      console.warn('[Guide API] Missing pageContext')
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
    console.error('[Guide API] Error:', error instanceof Error ? error.message : String(error))
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
