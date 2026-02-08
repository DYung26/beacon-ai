import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { Overlay, type OverlayHandle, type GuideStatus, type OverlayMode } from './Overlay'
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
  setMode: (mode: OverlayMode) => void
  sendChatMessage: (message: string) => void
}

let reactRoot: Root | null = null
let shadowHost: HTMLElement | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let overlayRef: any = null

// Track Beacon's state: hidden, highlights-only, or chat mode
type BeaconState = 'hidden' | 'highlights-only' | 'chat'
let currentState: BeaconState = 'hidden'

// Keyboard event suppression for chat mode
let keyboardSuppressListener: ((e: KeyboardEvent) => void) | null = null

/**
 * Injects a Shadow DOM host element into the page and mounts the React overlay inside it.
 * Shadow DOM provides style isolation so host page CSS doesn't affect Beacon's UI.
 *
 * This function is idempotent — calling it multiple times is safe and will not create duplicates.
 */
function enableKeyboardSuppression() {
  // Prevent keyboard events from reaching the underlying page when chat is active
  if (!keyboardSuppressListener) {
    keyboardSuppressListener = (e: KeyboardEvent) => {
      // Block all keyboard events in chat mode using capture phase
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
    }
    // Use capture phase to intercept events before they propagate
    document.addEventListener('keydown', keyboardSuppressListener, true)
    document.addEventListener('keypress', keyboardSuppressListener, true)
    document.addEventListener('keyup', keyboardSuppressListener, true)
  }
}

function disableKeyboardSuppression() {
  // Restore keyboard input to the underlying page
  if (keyboardSuppressListener) {
    document.removeEventListener('keydown', keyboardSuppressListener, true)
    document.removeEventListener('keypress', keyboardSuppressListener, true)
    document.removeEventListener('keyup', keyboardSuppressListener, true)
    keyboardSuppressListener = null
  }
}

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

      currentState = 'hidden'
      disableKeyboardSuppression() // Ensure keyboard is restored when unmounting
      console.log('✓ Beacon overlay unmounted')
    }
  }

  /**
   * Alt+B toggles between three states: hidden → highlights-only → chat → hidden
   * This preserves state and does NOT reset on each toggle.
   * Keyboard suppression is enabled in chat mode to prevent input from reaching the page.
   */
  function toggle() {
    if (!reactRoot || !overlayRef?.current) {
      // If not mounted, start with highlights-only mode
      mount()
      currentState = 'highlights-only'
      overlayRef.current?.setVisible(true)
      overlayRef.current?.setMode('highlights-only')
      disableKeyboardSuppression() // Highlights-only mode allows page keyboard
      console.log('✓ Beacon showing in highlights-only mode')
      return
    }

    // Cycle through states: hidden → highlights-only → chat → hidden
    switch (currentState) {
      case 'hidden':
        // Show highlights-only mode
        currentState = 'highlights-only'
        overlayRef.current.setVisible(true)
        overlayRef.current.setMode('highlights-only')
        disableKeyboardSuppression() // Highlights-only mode allows page keyboard
        console.log('✓ Beacon showing in highlights-only mode')
        break

      case 'highlights-only':
        // Switch to chat mode
        currentState = 'chat'
        overlayRef.current.setMode('chat')
        enableKeyboardSuppression() // Chat mode blocks all page keyboard input
        console.log('✓ Beacon switched to chat mode')
        break

      case 'chat':
        // Hide Beacon completely
        currentState = 'hidden'
        overlayRef.current.setVisible(false)
        disableKeyboardSuppression() // Hidden mode allows page keyboard
        console.log('✓ Beacon hidden')
        break
    }
  }

  function isVisible() {
    return currentState !== 'hidden'
  }

  function setGuideStatus(status: GuideStatus) {
    if (reactRoot && overlayRef?.current) {
      overlayRef.current.setGuideStatus(status)
    }
  }

  function setMode(mode: OverlayMode) {
    if (reactRoot && overlayRef?.current) {
      overlayRef.current.setMode(mode)
    }
  }

  function sendChatMessage(message: string) {
    if (reactRoot && overlayRef?.current) {
      overlayRef.current.sendChatMessage?.(message)
    }
  }

  // Mount immediately on creation
  mount()
  currentState = 'highlights-only' // Start in highlights-only mode

  return { mount, unmount, toggle, isVisible, setGuideStatus, setMode, sendChatMessage }
}

