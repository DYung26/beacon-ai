/**
 * Guide API Client
 *
 * Communicates with the backend /api/guide endpoint.
 * Sends PageContext and receives HighlightInstructions.
 *
 * Features:
 * - Simple request/response handling
 * - Error handling and logging
 * - No caching or retry logic (keep it simple)
 */

import type { GuideRequest, GuideResponse, PageContext } from '@beacon/shared'

// Configuration
const DEFAULT_BACKEND_URL = 'http://localhost:3000'

/**
 * Send PageContext to the backend and receive HighlightInstructions.
 *
 * @param pageContext - Current page context snapshot
 * @param backendUrl - Backend base URL (defaults to localhost:3001)
 * @returns Promise resolving to GuideResponse
 */
export async function requestGuide(
  pageContext: PageContext,
  backendUrl: string = DEFAULT_BACKEND_URL
): Promise<GuideResponse> {
  const url = `${backendUrl}/api/guide`
  console.log('[Beacon Content Script] Making request to:', url, {
    elementCount: pageContext.elements.length,
  })

  const request: GuideRequest = {
    pageContext,
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })

    console.log('[Beacon Content Script] Response status:', response.status)

    if (!response.ok) {
      console.warn(
        `[Beacon Guide Client] Server returned ${response.status}: ${response.statusText}`
      )
      return {
        highlights: [],
        debug: {
          reason: `HTTP ${response.status}`,
        },
      }
    }

    const data = await response.json() as unknown

    // Validate response structure
    if (
      data &&
      typeof data === 'object' &&
      'highlights' in data &&
      Array.isArray((data as Record<string, unknown>).highlights)
    ) {
      console.log('[Beacon Content Script] Valid response with', ((data as Record<string, unknown>).highlights as unknown[]).length, 'highlights')
      return data as GuideResponse
    }

    console.warn('[Beacon Guide Client] Invalid response structure')
    return {
      highlights: [],
      debug: {
        reason: 'Invalid response structure',
      },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.warn(`[Beacon Guide Client] Request failed: ${message}`)
    return {
      highlights: [],
      debug: {
        reason: `Network error: ${message}`,
      },
    }
  }
}
