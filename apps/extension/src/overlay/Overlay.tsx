import { useState, forwardRef, useImperativeHandle } from 'react'

export type GuideStatus = 'idle' | 'loading' | 'error'

export interface OverlayHandle {
  setVisible: (visible: boolean) => void
  setGuideStatus: (status: GuideStatus) => void
}

export const Overlay = forwardRef<OverlayHandle>((_, ref) => {
  const [isVisible, setIsVisible] = useState(true)
  const [guideStatus, setGuideStatusState] = useState<GuideStatus>('idle')

  useImperativeHandle(ref, () => ({
    setVisible: (visible: boolean) => {
      setIsVisible(visible)
    },
    setGuideStatus: (status: GuideStatus) => {
      setGuideStatusState(status)
    },
  }))

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

  return (
    <div className="beacon-overlay">
      <div className="beacon-panel">
        <div className="beacon-header">
          <h2>🔦 Beacon</h2>
          <button
            className="beacon-close"
            onClick={() => setIsVisible(false)}
            aria-label="Close Beacon overlay"
          >
            ✕
          </button>
        </div>
        <div className="beacon-content">
          <p>Beacon overlay is active on this page.</p>
          <p className={`beacon-status beacon-status-${guideStatus}`}>
            {statusIcon} {statusText}
          </p>
          <p className="beacon-hint">
            Press <kbd>Alt + B</kbd> to toggle visibility.
          </p>
        </div>
      </div>
    </div>
  )
})

Overlay.displayName = 'Overlay'
