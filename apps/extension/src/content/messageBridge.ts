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
 *
 * Chat message format:
 * {
 *   type: 'beacon:chat-request',
 *   id: string (for matching responses),
 *   payload: { message: string, context: { mode: string } }
 * }
 */

import type { PageContext, GuideResponse } from '@beacon/shared'
import { requestGuide } from './guideClient'

// Backend URL is hardcoded here.
// Browser extensions cannot reliably read environment variables at runtime,
// so we use a fixed localhost URL for development.
// For production builds, update this URL or inject it via a config file.
const BACKEND_URL = 'http://localhost:3000'

// Track pending requests to match responses
const pendingRequests = new Map<string, (response: GuideResponse) => void>()
const pendingChatRequests = new Map<string, (response: { message: string; highlights: any[] }) => void>()

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

    // Handle chat request messages
    if (message.type === 'beacon:chat-request') {
      console.log('[Beacon Bridge] Processing chat request')
      const { id, payload } = message as {
        type: string
        id: string
        payload: { message: string; context: { mode: string } }
      }

      try {
        // Get current page context for chat intent understanding
        const pageContext = window.__beaconGetContext?.()
        
        // Send chat request to backend
        const response = await fetch(`${BACKEND_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userMessage: payload.message,
            pageContext,
          }),
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const data = await response.json()

        // Send response back through message
        window.postMessage(
          {
            type: 'beacon:chat-response',
            id,
            payload: data,
          },
          '*'
        )
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[Beacon Bridge] Failed to process chat request:', msg)

        window.postMessage(
          {
            type: 'beacon:chat-response',
            id,
            payload: {
              message: 'Sorry, I encountered an error processing your request.',
              highlights: [],
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

    // Handle chat response messages
    if (message.type === 'beacon:chat-response') {
      const { id, payload } = message as {
        type: string
        id: string
        payload: { message: string; highlights: any[] }
      }

      const callback = pendingChatRequests.get(id)
      if (callback) {
        pendingChatRequests.delete(id)
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

/**
 * Send a chat message from the overlay to the backend via content script.
 * Handles the full message-passing round-trip.
 *
 * @param message - User's chat message
 * @returns Promise resolving to { message: AI response, highlights: new highlight instructions }
 */
export async function sendChatMessageViaContentScript(
  message: string
): Promise<{ message: string; highlights: any[] }> {
  return new Promise((resolve) => {
    const id = `beacon-chat-${Date.now()}-${Math.random()}`

    // Register callback to receive response
    pendingChatRequests.set(id, (response) => {
      resolve(response)
    })

    // Send request to content script
    window.postMessage(
      {
        type: 'beacon:chat-request',
        id,
        payload: { message, context: { mode: 'chat' } },
      },
      '*'
    )

    // Timeout after 30 seconds
    setTimeout(() => {
      if (pendingChatRequests.has(id)) {
        pendingChatRequests.delete(id)
        resolve({
          message: 'Request timed out. Please try again.',
          highlights: [],
        })
      }
    }, 30000)
  })
}

