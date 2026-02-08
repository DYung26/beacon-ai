import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Overlay, type OverlayHandle, type GuideStatus } from './Overlay'
import { OVERLAY_STYLES } from './styles'

// Unique ID for the Beacon overlay container and Shadow DOM host
const BEACON_SHADOW_HOST_ID = 'beacon-shadow-host'
const BEACON_ROOT_ID = 'beacon-root'
const BEACON_STYLES_ID = 'beacon-overlay-styles'

interface OverlayManager {
  mount: () => void
  unmount: () => void
  toggle: () => void
  isVisible: () => boolean
  setGuideStatus: (status: GuideStatus) => void
}

let reactRoot: Root | null = null
let shadowHost: HTMLElement | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let overlayRef: any = null
let isOverlayVisible = true

/**
 * Injects a Shadow DOM host element into the page and mounts the React overlay inside it.
 * Shadow DOM provides style isolation so host page CSS doesn't affect Beacon's UI.
 *
 * This function is idempotent — calling it multiple times is safe and will not create duplicates.
 */
export function createOverlayManager(): OverlayManager {
  function mount() {
    // Check if already mounted to avoid duplicates
    if (reactRoot && shadowHost) {
      return
    }

    // Create or retrieve the Shadow DOM host element
    let host = document.getElementById(BEACON_SHADOW_HOST_ID)
    if (!host) {
      host = document.createElement('div')
      host.id = BEACON_SHADOW_HOST_ID
      // Attach to body to ensure it's in the DOM
      document.body.appendChild(host)
    }

    shadowHost = host

    // Attach Shadow DOM to the host
    // Using 'open' mode for debugging (can be changed to 'closed' for security)
    let shadowRoot = host.shadowRoot
    if (!shadowRoot) {
      shadowRoot = host.attachShadow({ mode: 'open' })

      // Inject styles into the Shadow DOM for complete isolation
      const styleElement = document.createElement('style')
      styleElement.id = BEACON_STYLES_ID
      styleElement.textContent = OVERLAY_STYLES
      shadowRoot.appendChild(styleElement)
    }

    // Create the React root container inside the Shadow DOM
    let rootDiv = shadowRoot.getElementById(BEACON_ROOT_ID)
    if (!rootDiv) {
      rootDiv = document.createElement('div')
      rootDiv.id = BEACON_ROOT_ID
      shadowRoot.appendChild(rootDiv)
    }

    // Mount the React app with a ref so we can control it externally
    if (!reactRoot) {
      overlayRef = React.createRef<OverlayHandle>()
      reactRoot = createRoot(rootDiv)
      reactRoot.render(React.createElement(Overlay, { ref: overlayRef }))
    }

    isOverlayVisible = true
    console.log('✓ Beacon overlay mounted')
  }

  function unmount() {
    if (reactRoot && shadowHost) {
      reactRoot.unmount()
      reactRoot = null
      overlayRef = null

      // Remove the Shadow DOM host from the document
      if (shadowHost.parentNode) {
        shadowHost.parentNode.removeChild(shadowHost)
      }
      shadowHost = null

      isOverlayVisible = false
      console.log('✓ Beacon overlay unmounted')
    }
  }

  function toggle() {
    if (reactRoot && overlayRef?.current) {
      isOverlayVisible = !isOverlayVisible
      // Use the ref to call setVisible on the component
      overlayRef.current.setVisible(isOverlayVisible)
      console.log(`✓ Beacon overlay ${isOverlayVisible ? 'shown' : 'hidden'}`)
    }
  }

  function isVisible() {
    return isOverlayVisible
  }

  function setGuideStatus(status: GuideStatus) {
    if (reactRoot && overlayRef?.current) {
      overlayRef.current.setGuideStatus(status)
    }
  }

  // Mount immediately on creation
  mount()

  return { mount, unmount, toggle, isVisible, setGuideStatus }
}
