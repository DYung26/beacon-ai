/**
 * Guide Request Coordinator
 *
 * Manages requests to the backend guide API with throttling/debouncing.
 * Prevents spam and excessive API calls.
 *
 * Strategy:
 * - Throttle: Wait at least THROTTLE_INTERVAL_MS between requests
 * - Debounce: Delay request by DEBOUNCE_DELAY_MS when context changes
 * - Queue: If a request comes in while throttled, schedule the next one
 *
 * Chosen interval: 1000ms (1 second) - balances responsiveness and backend load
 */

import type { PageContext, GuideResponse } from '@beacon/shared'
import { requestGuide } from './guideClient'

// Throttle and debounce configuration
const THROTTLE_INTERVAL_MS = 1000 // Minimum time between requests
const DEBOUNCE_DELAY_MS = 200 // Delay before sending after context change
// Backend URL is hardcoded here.
// Browser extensions cannot reliably read environment variables at runtime,
// so we use a fixed localhost URL for development.
// For production builds, update this URL or inject it via a config file.
const BACKEND_URL = 'http://localhost:3000'

interface GuideCoordinatorConfig {
  onResponse?: (response: GuideResponse) => void
  onError?: (error: Error) => void
  backendUrl?: string
  /**
   * Custom request function for testing or overlay contexts.
   * If provided, this will be used instead of the default requestGuide function.
   * This allows the overlay to send requests through the content script message bridge.
   */
  requestFn?: (context: PageContext) => Promise<GuideResponse>
}

export interface GuideCoordinator {
  requestGuide: (context: PageContext) => Promise<void>
  getLastResponse: () => GuideResponse | null
  cleanup: () => void
}

/**
 * Create a guide request coordinator.
 * Manages throttling and debouncing of API requests.
 *
 * IMPORTANT: This coordinator is designed to work in the content script context,
 * where fetch() calls are exempt from webpage CSP restrictions.
 * Do NOT instantiate this in injected page scripts or overlay code.
 */
export function createGuideCoordinator(
  config: GuideCoordinatorConfig = {}
): GuideCoordinator {
  const backendUrl = config.backendUrl || BACKEND_URL
  let lastRequestTime = 0
  let lastResponse: GuideResponse | null = null
  let debounceTimeout: number | null = null
  let pendingContext: PageContext | null = null
  let isRequesting = false

  /**
   * Actually send the request to the backend.
   * This runs in the content script context, so fetch() is not subject to page CSP.
   *
   * If a custom requestFn is provided (e.g., for overlay contexts), that is used instead.
   */
  async function sendRequest(context: PageContext): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - lastRequestTime

    // Check throttle
    if (timeSinceLastRequest < THROTTLE_INTERVAL_MS) {
      // Throttled - schedule for later
      const delay = THROTTLE_INTERVAL_MS - timeSinceLastRequest
      pendingContext = context

      if (debounceTimeout !== null) {
        clearTimeout(debounceTimeout)
      }

      debounceTimeout = window.setTimeout(() => {
        debounceTimeout = null
        if (pendingContext && !isRequesting) {
          sendRequest(pendingContext)
        }
      }, delay)

      return
    }

    // Not throttled - send request
    isRequesting = true
    lastRequestTime = now

    try {
      // Use custom request function if provided, otherwise use default
      const response = config.requestFn
        ? await config.requestFn(context)
        : await requestGuide(context, backendUrl)
      lastResponse = response

      // Log response for debugging
      console.log('[Beacon Guide Coordinator] Response received', {
        highlightCount: response.highlights.length,
        debug: response.debug,
      })

      // Call callback if provided
      if (config.onResponse) {
        config.onResponse(response)
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      console.error('[Beacon Guide Coordinator] Request failed:', err)

      if (config.onError) {
        config.onError(err)
      }
    } finally {
      isRequesting = false

      // Check if there's a pending context to process
      if (pendingContext && pendingContext !== context) {
        sendRequest(pendingContext)
      }
    }
  }

  /**
   * Request guide highlights for the given context.
   * Throttled and debounced to prevent excessive requests.
   */
  async function requestGuideWithThrottle(
    context: PageContext
  ): Promise<void> {
    pendingContext = context

    // Clear existing debounce timeout
    if (debounceTimeout !== null) {
      clearTimeout(debounceTimeout)
    }

    // Debounce the request
    debounceTimeout = window.setTimeout(() => {
      debounceTimeout = null
      if (pendingContext) {
        sendRequest(pendingContext)
      }
    }, DEBOUNCE_DELAY_MS)
  }

  return {
    requestGuide: requestGuideWithThrottle,
    getLastResponse: () => lastResponse,
    cleanup: () => {
      if (debounceTimeout !== null) {
        clearTimeout(debounceTimeout)
        debounceTimeout = null
      }
      isRequesting = false
      pendingContext = null
    },
  }
}
