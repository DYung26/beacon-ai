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
        window.removeEventListener('message', handleResponse)
        resolve(message.payload as GuideResponse)
      }
    }

    // Listen for response
    window.addEventListener('message', handleResponse)

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
      window.removeEventListener('message', handleResponse)
      resolve({
        highlights: [],
        debug: {
          reason: 'Request timeout',
        },
      })
    }, 30000)
  })
}
