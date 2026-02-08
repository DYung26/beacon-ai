import { useState, forwardRef, useImperativeHandle, useEffect } from 'react'
import { sendChatMessageViaContentScript } from '../content/messageBridge'

export type GuideStatus = 'idle' | 'loading' | 'error'
export type OverlayMode = 'highlights-only' | 'chat'

export interface OverlayHandle {
  setVisible: (visible: boolean) => void
  setGuideStatus: (status: GuideStatus) => void
  setMode: (mode: OverlayMode) => void
  sendChatMessage?: (message: string) => void
  setSelfHighlightingEnabled: (enabled: boolean) => void
}

export const Overlay = forwardRef<OverlayHandle>((_, ref) => {
  const [isVisible, setIsVisible] = useState(true)
  const [guideStatus, setGuideStatusState] = useState<GuideStatus>('idle')
  const [mode, setModeState] = useState<OverlayMode>('highlights-only')
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([])
  const [chatInput, setChatInput] = useState('')
  const [isChatLoading, setIsChatLoading] = useState(false)
  // Self-highlighting toggle: controls whether Beacon proactively highlights elements
  const [selfHighlightingEnabled, setSelfHighlightingEnabled] = useState(true)

  // Listen for chat responses from the content script
  useEffect(() => {
    const handleChatResponse = (event: CustomEvent) => {
      const payload = event.detail as { message: string; highlights: any[] }
      console.log('[Beacon Overlay] Chat response received:', payload)
      
      // Add assistant message to chat
      setChatMessages((prev) => [...prev, { role: 'assistant', text: payload.message }])
      setIsChatLoading(false)
    }

    window.addEventListener('beacon:chat-response', handleChatResponse as EventListener)
    return () => {
      window.removeEventListener('beacon:chat-response', handleChatResponse as EventListener)
    }
  }, [])

  // Notify content script when self-highlighting toggle changes
  useEffect(() => {
    window.postMessage({
      type: 'beacon:set-self-highlighting',
      enabled: selfHighlightingEnabled
    }, '*')
  }, [selfHighlightingEnabled])

  useImperativeHandle(ref, () => ({
    setVisible: (visible: boolean) => {
      setIsVisible(visible)
    },
    setGuideStatus: (status: GuideStatus) => {
      setGuideStatusState(status)
    },
    setMode: (newMode: OverlayMode) => {
      setModeState(newMode)
    },
    setSelfHighlightingEnabled: (enabled: boolean) => {
      setSelfHighlightingEnabled(enabled)
    },
    sendChatMessage: (message: string) => {
      if (!message.trim()) return
      // Add user message to chat
      setChatMessages((prev) => [...prev, { role: 'user', text: message }])
      setChatInput('')
      setIsChatLoading(true)
      
      // Send through content script bridge
      sendChatMessageViaContentScript(message)
        .then(() => {
          console.log('[Beacon Overlay] Chat response processed')
        })
        .catch((error) => {
          console.error('[Beacon Overlay] Chat error:', error)
          setChatMessages((prev) => [
            ...prev,
            { role: 'assistant', text: 'Sorry, I encountered an error. Please try again.' },
          ])
          setIsChatLoading(false)
        })
    },
  }))

  // Handle close button to fully unmount Beacon
  const handleClose = () => {
    setIsVisible(false)
    // Trigger unmount via the overlay manager
    const manager = (window as any).__beaconOverlay
    if (manager) {
      manager.unmount()
    }
  }

  if (!isVisible) {
    return null
  }

  const statusIcon =
    guideStatus === 'loading'
      ? '⟳'
      : guideStatus === 'error'
        ? '⚠'
        : '✓'

  const statusText =
    guideStatus === 'loading'
      ? 'Requesting guide...'
      : guideStatus === 'error'
        ? 'Guide request failed'
        : 'Ready'

  // Highlights-only mode
  if (mode === 'highlights-only') {
    return (
      <div className="beacon-overlay">
        <div className="beacon-panel">
          <div className="beacon-header">
            <h2>🔦 Beacon</h2>
            <div className="beacon-header-actions">
              <button
                className="beacon-mode-toggle"
                onClick={() => setModeState('chat')}
                title="Switch to chat mode"
                aria-label="Switch to chat mode"
              >
                💬
              </button>
              <button
                className="beacon-close"
                onClick={handleClose}
                aria-label="Close Beacon overlay"
              >
                ✕
              </button>
            </div>
          </div>
          <div className="beacon-content">
            <p>Beacon overlay is active on this page.</p>
            <p className={`beacon-status beacon-status-${guideStatus}`}>
              {statusIcon} {statusText}
            </p>
            {/* Self-highlighting toggle */}
            <div className="beacon-toggle-container">
              <label className="beacon-toggle-label">
                <input
                  type="checkbox"
                  checked={selfHighlightingEnabled}
                  onChange={(e) => setSelfHighlightingEnabled(e.target.checked)}
                  className="beacon-toggle-input"
                />
                <span>Auto guidance</span>
              </label>
            </div>
            <p className="beacon-hint">
              Press <kbd>Alt + B</kbd> to switch modes.
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Chat mode
  return (
    <div className="beacon-overlay">
      <div className="beacon-panel beacon-chat-panel">
        <div className="beacon-header">
          <h2>🔦 Beacon Chat</h2>
          <div className="beacon-header-actions">
            <button
              className="beacon-mode-toggle"
              onClick={() => setModeState('highlights-only')}
              title="Switch to highlights-only mode"
              aria-label="Switch to highlights-only mode"
            >
              ✨
            </button>
            <button
              className="beacon-close"
              onClick={handleClose}
              aria-label="Close Beacon overlay"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="beacon-chat-messages">
          {chatMessages.length === 0 ? (
            <p className="beacon-chat-placeholder">
              Ask me anything about this page. I'll highlight relevant elements for you.
            </p>
          ) : (
            chatMessages.map((msg, idx) => (
              <div key={idx} className={`beacon-chat-message beacon-chat-${msg.role}`}>
                <div className="beacon-chat-bubble">
                  {msg.text}
                </div>
              </div>
            ))
          )}
          {isChatLoading && (
            <div className="beacon-chat-message beacon-chat-assistant">
              <div className="beacon-chat-bubble beacon-chat-loading">
                ⟳ Thinking...
              </div>
            </div>
          )}
        </div>
        <div className="beacon-chat-input-area">
          <input
            type="text"
            className="beacon-chat-input"
            placeholder="Ask about this page..."
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter' && !isChatLoading) {
                const message = chatInput.trim()
                if (message) {
                  const handle = ref as any
                  handle.current?.sendChatMessage(message)
                }
              }
            }}
            disabled={isChatLoading}
          />
          <button
            className="beacon-chat-send"
            onClick={() => {
              const message = chatInput.trim()
              if (message) {
                const handle = ref as any
                handle.current?.sendChatMessage(message)
              }
            }}
            disabled={isChatLoading || !chatInput.trim()}
            aria-label="Send message"
          >
            →
          </button>
        </div>
      </div>
    </div>
  )
})

Overlay.displayName = 'Overlay'
