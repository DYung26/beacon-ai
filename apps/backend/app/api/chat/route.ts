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

function setCORSHeaders(response: Response): Response {
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return response
}

export async function OPTIONS(): Promise<Response> {
  return setCORSHeaders(new Response(null, { status: 200 }))
}

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

    const agentResponse = await runChatAgent(
      body.userMessage,
      body.pageContext
    )

    const response: ChatResponse = {
      message: agentResponse.message,
      highlights: agentResponse.highlights,
    }

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
