/**
 * Content Script Loader for Beacon
 * This is the manifest v3 content script entry point.
 * It runs in the content script context and has access to:
 * - Chrome APIs (chrome.runtime, etc.)
 * - Page DOM (not isolated)
 * - No page CSP restrictions on fetch()
 *
 * Responsibilities:
 * 1. Store chrome.runtime.getURL in window for overlay to access
 * 2. Set up message handler for guide API requests (CSP workaround)
 * 3. Initialize DOM observer to capture page context
 * 4. Inject overlay.js into the page
 */

declare const chrome: any

declare global {
  interface Window {
    __chromeRuntimeGetURL?: (path: string) => string
  }
}

// Store chrome.runtime.getURL in window so that other content script code can access it
window.__chromeRuntimeGetURL = chrome.runtime.getURL.bind(chrome.runtime)

console.log('✓ Beacon content script loaded')

// Initialize content script modules
// The overlay code is imported directly here instead of being injected as a separate script.
// This ensures everything runs in the content script context, which is NOT subject to page CSP.
Promise.all([
  import('./domObserver').then(m => m.initializeDOMObserver),
  import('./messageBridge').then(m => m.setupGuideMessageHandler),
  import('../overlay/init') // Initialize overlay directly in content script context
]).then(([initDOMObserver, setupMessageHandler]) => {
  // Initialize DOM observer to capture page context
  try {
    initDOMObserver()
  } catch (error) {
    console.error('[Beacon] Failed to initialize DOM observer:', error)
  }

  // Set up message handler for guide API requests
  // This runs in the content script context, which is NOT subject to page CSP
  try {
    setupMessageHandler()
    console.log('✓ Beacon guide message handler initialized successfully')
  } catch (error) {
    console.error('[Beacon] Failed to initialize guide message handler:', error)
  }

  // NOTE: Overlay is initialized directly above via dynamic import.
  // We do NOT inject it as a separate <script> tag because that would violate
  // the page's Content Security Policy. Instead, all overlay code runs in this
  // content script context, which has full access to chrome APIs and is not
  // subject to page CSP restrictions.
}).catch(error => {
  console.error('[Beacon] Failed to initialize content script:', error)
})




