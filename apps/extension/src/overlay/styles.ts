// Beacon Overlay Styles - to be injected into Shadow DOM
export const OVERLAY_STYLES = `
/* Beacon Overlay Styles - Isolated from host page using Shadow DOM */

.beacon-overlay {
  all: revert;
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 2147483647;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #1a1a1a;
}

.beacon-panel {
  all: revert;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  min-width: 300px;
  max-width: 400px;
}

.beacon-header {
  all: revert;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: rgba(255, 255, 255, 0.1);
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
}

.beacon-header h2 {
  all: revert;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: white;
}

.beacon-close {
  all: revert;
  background: transparent;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 20px;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s ease;
}

.beacon-close:hover {
  transform: scale(1.2);
}

.beacon-close:active {
  transform: scale(0.95);
}

.beacon-content {
  all: revert;
  padding: 16px;
  background: white;
  color: #333;
}

.beacon-content p {
  all: revert;
  margin: 0 0 12px 0;
  font-size: 14px;
  line-height: 1.5;
}

.beacon-content p:last-child {
  margin-bottom: 0;
}

/* Status indicator styles */
.beacon-status {
  all: revert;
  font-size: 13px !important;
  font-weight: 500;
  padding: 8px 12px;
  border-radius: 4px;
  margin: 12px 0 !important;
  display: flex;
  align-items: center;
  gap: 6px;
}

.beacon-status-idle {
  background: #e8f5e9;
  color: #2e7d32;
  border: 1px solid #c8e6c9;
}

.beacon-status-loading {
  background: #e3f2fd;
  color: #1565c0;
  border: 1px solid #bbdefb;
  animation: beacon-pulse 1.5s ease-in-out infinite;
}

.beacon-status-error {
  background: #ffebee;
  color: #c62828;
  border: 1px solid #ffcdd2;
}

@keyframes beacon-pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

.beacon-hint {
  all: revert;
  font-size: 12px !important;
  color: #666;
  margin-top: 8px !important;
}

.beacon-hint kbd {
  all: revert;
  background: #f0f0f0;
  border: 1px solid #ccc;
  border-radius: 3px;
  padding: 2px 6px;
  font-family: 'Monaco', 'Courier New', monospace;
  font-size: 11px;
  display: inline-block;
}

/* Header actions (mode toggle + close button) */
.beacon-header-actions {
  all: revert;
  display: flex;
  gap: 8px;
  align-items: center;
}

.beacon-mode-toggle {
  all: revert;
  background: transparent;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 18px;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.2s ease;
}

.beacon-mode-toggle:hover {
  transform: scale(1.15);
}

.beacon-mode-toggle:active {
  transform: scale(0.95);
}

/* Chat panel styles */
.beacon-chat-panel {
  all: revert;
  display: flex;
  flex-direction: column;
  min-width: 350px;
  max-width: 400px;
  height: 500px;
  background: white;
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

.beacon-chat-panel .beacon-header {
  all: revert;
  background: linear-gradient(135deg, #06b6d4 0%, #0891b2 100%);
  border: none;
}

.beacon-chat-panel .beacon-header h2 {
  all: revert;
  color: white;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.beacon-chat-messages {
  all: revert;
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #fafafa;
}

.beacon-chat-placeholder {
  all: revert;
  color: #999;
  font-size: 13px;
  text-align: center;
  margin: auto;
  padding: 0 12px;
  line-height: 1.4;
}

.beacon-chat-message {
  all: revert;
  display: flex;
  justify-content: flex-end;
}

.beacon-chat-user {
  all: revert;
  justify-content: flex-end !important;
}

.beacon-chat-assistant {
  all: revert;
  justify-content: flex-start !important;
}

.beacon-chat-bubble {
  all: revert;
  max-width: 80%;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.4;
  word-wrap: break-word;
}

.beacon-chat-user .beacon-chat-bubble {
  all: revert;
  background: #06b6d4;
  color: white;
  border-radius: 12px 4px 12px 12px;
}

.beacon-chat-assistant .beacon-chat-bubble {
  all: revert;
  background: white;
  color: #1a1a1a;
  border: 1px solid #e5e7eb;
  border-radius: 4px 12px 12px 12px;
}

.beacon-chat-loading {
  all: revert;
  color: #666;
  font-style: italic;
}

.beacon-chat-input-area {
  all: revert;
  display: flex;
  gap: 8px;
  padding: 12px;
  background: white;
  border-top: 1px solid #e5e7eb;
}

.beacon-chat-input {
  all: revert;
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
}

.beacon-chat-input:focus {
  border-color: #06b6d4;
  box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.1);
}

.beacon-chat-input:disabled {
  background: #f3f4f6;
  color: #999;
  cursor: not-allowed;
}

.beacon-chat-send {
  all: revert;
  padding: 10px 12px;
  background: #06b6d4;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.2s;
}

.beacon-chat-send:hover:not(:disabled) {
  background: #0891b2;
}

.beacon-chat-send:active:not(:disabled) {
  transform: scale(0.95);
}

.beacon-chat-send:disabled {
  background: #cbd5e1;
  cursor: not-allowed;
}
`
