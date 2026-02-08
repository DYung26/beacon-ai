/**
 * Guide Client for Overlay
 *
 * This version of the guide client is designed to work in the overlay/injected page code
 * where fetch() calls would be subject to webpage CSP restrictions.
 *
 * Instead of making direct fetch calls, it sends messages to the content script,
 * which handles the actual backend communication.
 *
 * This solves the CSP violation issue where:
 * - Page JavaScript is restricted by website CSP
 * - Content scripts are NOT restricted by page CSP
 * - Background/service workers are NOT restricted by page CSP
 */

import type { GuideResponse, PageContext } from '@beacon/shared'

/**
 * Send PageContext to the backend via content script message passing.
 *
 * @param pageContext - Current page context snapshot
 * @returns Promise resolving to GuideResponse
 */
export async function requestGuideFromOverlay(
  pageContext: PageContext
): Promise<GuideResponse> {
  console.log('[Beacon Overlay Guide Client] Sending request to content script', {
    elementCount: pageContext.elements.length,
    url: pageContext.url,
  })

  return new Promise((resolve) => {
    const id = `beacon-overlay-${Date.now()}-${Math.random()}`

    // Create a one-time listener for the response
    const handleResponse = (event: MessageEvent) => {
      if (event.source !== window) return

      const message = event.data
      if (
        message &&
        typeof message === 'object' &&
        message.type === 'beacon:guide-response' &&
        message.id === id
      ) {
        console.log('[Beacon Overlay Guide Client] Response received from content script', message.payload)
        window.removeEventListener('message', handleResponse)
        resolve(message.payload as GuideResponse)
      }
    }

    // Listen for response
    window.addEventListener('message', handleResponse)

    // Send request to content script
    console.log('[Beacon Overlay Guide Client] Posting message with id:', id)
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
      window.removeEventListener('message', handleResponse)
      console.log('[Beacon Overlay Guide Client] Request timeout after 30s')
      resolve({
        highlights: [],
        debug: {
          reason: 'Request timeout',
        },
      })
    }, 30000)
  })
}
