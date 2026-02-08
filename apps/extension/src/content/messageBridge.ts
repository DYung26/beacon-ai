/**
 * Message Bridge for Content Script
 *
 * Handles communication between the overlay/injected page code and the content script.
 * This allows network requests (fetch) to be executed in the content script context,
 * which is exempt from webpage CSP restrictions.
 *
 * Message format:
 * {
 *   type: 'beacon:request-guide',
 *   id: string (for matching responses),
 *   payload: PageContext
 * }
 */

import type { PageContext, GuideResponse } from '@beacon/shared'
import { requestGuide } from './guideClient'

const BACKEND_URL = 'http://localhost:3000'

// Track pending requests to match responses
const pendingRequests = new Map<string, (response: GuideResponse) => void>()

/**
 * Set up message listener in the content script to handle requests from the overlay.
 * Call this once when the content script initializes.
 */
export function setupGuideMessageHandler(): void {
  console.log('[Beacon Bridge] Setting up message handler')
  
  // Listen for messages from the injected page script
  window.addEventListener('message', async (event) => {
    // Only accept messages from the same window
    if (event.source !== window) return

    const message = event.data
    if (!message || typeof message !== 'object') return

    console.log('[Beacon Bridge] Received message:', (message as Record<string, unknown>).type)

    // Handle guide request messages
    if (message.type === 'beacon:request-guide') {
      console.log('[Beacon Bridge] Processing guide request')
      const { id, payload } = message as {
        type: string
        id: string
        payload: PageContext
      }

      try {
        // Execute fetch in content script context (not subject to page CSP)
        const response = await requestGuide(payload, BACKEND_URL)

        // Send response back through message
        window.postMessage(
          {
            type: 'beacon:guide-response',
            id,
            payload: response,
          },
          '*'
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error('[Beacon Bridge] Failed to request guide:', message)

        window.postMessage(
          {
            type: 'beacon:guide-response',
            id,
            payload: {
              highlights: [],
              debug: {
                reason: `Content script error: ${message}`,
              },
            },
          },
          '*'
        )
      }
    }

    // Handle response messages (for the overlay to receive)
    if (message.type === 'beacon:guide-response') {
      const { id, payload } = message as {
        type: string
        id: string
        payload: GuideResponse
      }

      const callback = pendingRequests.get(id)
      if (callback) {
        pendingRequests.delete(id)
        callback(payload)
      }
    }
  })
}

/**
 * Request guide from the content script.
 * This is called from the overlay/injected page code and will be handled
 * by the content script, which has permission to make backend requests.
 *
 * @param pageContext - The page context to send
 * @returns Promise resolving to GuideResponse
 */
export async function requestGuideViaContentScript(
  pageContext: PageContext
): Promise<GuideResponse> {
  return new Promise((resolve) => {
    const id = `beacon-${Date.now()}-${Math.random()}`

    // Register callback to receive response
    pendingRequests.set(id, (response) => {
      resolve(response)
    })

    // Send request to content script
    window.postMessage(
      {
        type: 'beacon:request-guide',
        id,
        payload: pageContext,
      },
      '*'
    )

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        resolve({
          highlights: [],
          debug: {
            reason: 'Request timeout',
          },
        })
      }
    }, 30000)
  })
}
