/**
 * Chat API Endpoint
 * POST /api/chat
 *
 * Accepts user messages and page context, interprets user intent,
 * and returns both an AI response and updated HighlightInstructions
 * to guide the user's attention on the page.
 *
 * This endpoint integrates with the AI agent to handle conversational
 * requests while maintaining highlighting context.
 */

import type { PageContext } from '@beacon/shared'
import { runChatAgent } from '../../../lib/agent'

interface ChatRequest {
  userMessage: string
  pageContext?: PageContext
}

interface ChatResponse {
  message: string
  highlights: Array<{
    selector: string
    style?: 'outline' | 'glow'
    reason?: string
    priority?: 'high' | 'normal' | 'low'
  }>
}

/**
 * Enable CORS for the chat endpoint.
 * This allows the extension to make requests from any webpage context.
 */
function setCORSHeaders(response: Response): Response {
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return response
}

/**
 * Handle preflight requests
 */
export async function OPTIONS(): Promise<Response> {
  return setCORSHeaders(new Response(null, { status: 200 }))
}

/**
 * Handle chat requests
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as ChatRequest

    if (!body.userMessage || typeof body.userMessage !== 'string') {
      return setCORSHeaders(
        new Response(
          JSON.stringify({
            message: 'Invalid request: userMessage is required',
            highlights: [],
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        )
      )
    }

    console.log('[Chat API] Received message:', body.userMessage)
    console.log('[Chat API] Page context:', body.pageContext?.url)

    // Run the AI agent to process the chat message and determine highlights
    const agentResponse = await runChatAgent(
      body.userMessage,
      body.pageContext
    )

    const response: ChatResponse = {
      message: agentResponse.message,
      highlights: agentResponse.highlights,
    }

    console.log('[Chat API] Response:', {
      messageLength: response.message.length,
      highlightCount: response.highlights.length,
    })

    return setCORSHeaders(
      new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[Chat API] Error:', message)

    return setCORSHeaders(
      new Response(
        JSON.stringify({
          message: 'An error occurred processing your message. Please try again.',
          highlights: [],
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      )
    )
  }
}
