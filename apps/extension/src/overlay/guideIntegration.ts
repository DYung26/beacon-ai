/**
 * Guide API Integration Bridge
 *
 * Integrates the guide API coordinator with the highlight manager and overlay manager.
 * Handles status updates and response routing.
 */

import type { GuideResponse, PageContext } from '@beacon/shared'
import type { GuideCoordinator } from '../content/guideCoordinator'

interface HighlightManagerRef {
  updateFromGuide: (response: GuideResponse) => void
}

interface OverlayManagerRef {
  setGuideStatus: (status: 'idle' | 'loading' | 'error') => void
}

export interface GuideIntegration {
  requestGuide: (context: PageContext) => Promise<void>
  cleanup: () => void
}

/**
 * Create a guide API integration bridge.
 * Orchestrates requests and updates across the system.
 */
export function createGuideIntegration(
  guideCoordinator: GuideCoordinator,
  highlightManager: HighlightManagerRef,
  overlayManager: OverlayManagerRef
): GuideIntegration {
  let requestInProgress = false

  return {
    requestGuide: async (context: PageContext) => {
      if (requestInProgress) {
        return
      }

      requestInProgress = true
      overlayManager.setGuideStatus('loading')

      try {
        await guideCoordinator.requestGuide(context)
        const response = guideCoordinator.getLastResponse()

        if (response) {
          highlightManager.updateFromGuide(response)
          overlayManager.setGuideStatus('idle')
        } else {
          overlayManager.setGuideStatus('error')
        }
      } catch (error) {
        console.warn('[Beacon Guide Integration] Request failed:', error)
        overlayManager.setGuideStatus('error')
      } finally {
        requestInProgress = false
      }
    },

    cleanup: () => {
      guideCoordinator.cleanup()
      overlayManager.setGuideStatus('idle')
    },
  }
}
