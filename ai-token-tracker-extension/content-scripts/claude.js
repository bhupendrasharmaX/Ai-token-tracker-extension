/**
 * AI Token Tracker & Switcher — Claude.ai Content Script
 * 
 * Watches the Claude chat interface for new messages,
 * extracts conversation text, and sends token counts to the service worker.
 * 
 * Uses multi-strategy DOM targeting with fallback selectors
 * since Claude's UI uses obfuscated/changing class names.
 */

(() => {
  'use strict';

  const LOG_PREFIX = '[AI-Tracker][Claude]';
  const SITE_ID = 'claude';

  console.log(`${LOG_PREFIX} Content script loaded on ${window.location.href}`);

  // ═══════════════════════════════════════════════
  // Claude-specific DOM selectors (multi-strategy)
  // ═══════════════════════════════════════════════

  /**
   * Selectors for the main chat container.
   * Ordered by reliability — first match wins.
   */
  const CONTAINER_SELECTORS = [
    '[role="main"]',                           // ARIA role (most stable)
    'main',                                     // Semantic HTML
    '[class*="conversation"]',                  // Class-based fallback
    '.flex-1.overflow-y-auto',                  // Layout-based
    'div[class*="react-scroll"]',               // Scroll container
    '#__next main',                             // Next.js root
  ];

  /**
   * Selectors for individual message elements.
   */
  const MESSAGE_SELECTORS = [
    '[data-testid*="message"]',                 // Test ID (if present)
    '[class*="Message"]',                       // Component class
    'div[class*="message"]',                    // Generic message class
    '.font-claude-message',                     // Claude-specific font class
    'article',                                  // Semantic article
    '[role="article"]',                         // ARIA article
    '[class*="ConversationItem"]',              // Conversation item component
    'div[class*="prose"]',                      // Prose content blocks
  ];

  /**
   * Selectors for the chat input box (used during handoff injection).
   */
  const INPUT_SELECTORS = [
    '[contenteditable="true"]',
    'div.ProseMirror',
    'fieldset [contenteditable]',
    'textarea',
    '[role="textbox"]',
    'div[class*="input"]',
  ];

  // ═══════════════════════════════════════════════
  // Role Detection
  // ═══════════════════════════════════════════════

  /**
   * Determine if a message element is from a human or assistant.
   * Uses multiple strategies.
   */
  function detectRole(el, index) {
    // Strategy 1: Check data attributes
    const testId = el.getAttribute('data-testid') || '';
    if (testId.includes('human') || testId.includes('user')) return 'human';
    if (testId.includes('assistant') || testId.includes('ai')) return 'assistant';

    // Strategy 2: Check classes
    const className = el.className || '';
    if (typeof className === 'string') {
      if (className.includes('human') || className.includes('user')) return 'human';
      if (className.includes('assistant') || className.includes('ai') || className.includes('claude')) return 'assistant';
    }

    // Strategy 3: Check for role labels in the element or siblings
    const textContent = el.textContent || '';
    const firstLine = textContent.substring(0, 100).toLowerCase();
    
    // Look for role indicators in the message header
    const header = el.querySelector('[class*="role"], [class*="name"], [class*="sender"]');
    if (header) {
      const headerText = header.textContent.toLowerCase();
      if (headerText.includes('you') || headerText.includes('human') || headerText.includes('user')) return 'human';
      if (headerText.includes('claude') || headerText.includes('assistant')) return 'assistant';
    }

    // Strategy 4: Check parent/ancestor attributes
    let parent = el.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      const parentClass = parent.className || '';
      if (typeof parentClass === 'string') {
        if (parentClass.includes('human') || parentClass.includes('user')) return 'human';
        if (parentClass.includes('assistant') || parentClass.includes('model')) return 'assistant';
      }
      parent = parent.parentElement;
    }

    // Strategy 5: Alternating pattern fallback
    // Claude conversations typically alternate: human, assistant, human, assistant
    return index % 2 === 0 ? 'human' : 'assistant';
  }

  // ═══════════════════════════════════════════════
  // Content Extraction
  // ═══════════════════════════════════════════════

  /**
   * Custom content extractor for Claude messages.
   * Handles artifacts, code blocks, and thinking blocks.
   */
  function extractContent(el) {
    // Clone to avoid DOM modification
    const clone = el.cloneNode(true);

    // Remove UI elements that aren't message content
    const removeSelectors = [
      'button',                        // Action buttons (copy, retry, etc.)
      '[class*="avatar"]',             // Avatar images
      '[class*="timestamp"]',          // Timestamps
      '[class*="feedback"]',           // Feedback buttons
      'svg',                           // Icons
      '.sr-only',                      // Screen reader only text
      '[class*="artifact-header"]',    // Artifact UI chrome
      '[class*="thinking-indicator"]', // Thinking animation
    ];
    removeSelectors.forEach(sel => {
      try { clone.querySelectorAll(sel).forEach(e => e.remove()); } catch (e) { /* skip */ }
    });

    // Extract text
    return AIExtractText.extractTextContent(clone);
  }

  // ═══════════════════════════════════════════════
  // Site Configuration
  // ═══════════════════════════════════════════════

  const siteConfig = {
    messageSelectors: MESSAGE_SELECTORS,
    roleDetector: detectRole,
    contentExtractor: extractContent,
    filterEmpty: true
  };

  // ═══════════════════════════════════════════════
  // Initialization
  // ═══════════════════════════════════════════════

  function onChatMutation(container) {
    console.log(`${LOG_PREFIX} Processing chat mutation...`);
    
    // Try to find the best message container
    let messageContainer = container;
    
    // Sometimes the observer container is the outer wrapper;
    // try to find a more specific message list inside it
    const innerContainers = [
      '[class*="conversation-content"]',
      '[class*="messages"]',
      '[role="log"]',
    ];
    for (const sel of innerContainers) {
      try {
        const inner = container.querySelector(sel);
        if (inner) {
          messageContainer = inner;
          break;
        }
      } catch (e) { /* skip */ }
    }

    const messages = AIExtractText.extractMessages(messageContainer, siteConfig);
    
    if (messages.length > 0) {
      AIExtractText.sendToBackground(SITE_ID, messages);
    }
  }

  // Start the observer
  async function init() {
    console.log(`${LOG_PREFIX} Initializing...`);

    try {
      await AIDomObserver.createChatObserver({
        containerSelectors: CONTAINER_SELECTORS,
        onMutation: onChatMutation,
        debounceMs: 400,  // Slightly longer debounce for Claude (streaming responses)
        watchAttributes: true
      });
      console.log(`${LOG_PREFIX} ✓ Observer started successfully`);
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to initialize:`, error);
    }
  }

  // Listen for handoff injection requests from the service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'INJECT_HANDOFF_TEXT') {
      console.log(`${LOG_PREFIX} Received handoff injection request`);
      injectText(message.text, message.autoSubmit);
      sendResponse({ success: true });
    }
    return true;
  });

  /**
   * Inject text into Claude's input box.
   */
  async function injectText(text, autoSubmit = false) {
    console.log(`${LOG_PREFIX} Injecting handoff text (${text.length} chars)...`);

    try {
      const inputEl = await AIDomObserver.waitForElement(INPUT_SELECTORS, 10000);
      console.log(`${LOG_PREFIX} Found input element:`, inputEl.tagName);

      // For contenteditable divs (ProseMirror)
      if (inputEl.getAttribute('contenteditable') === 'true') {
        inputEl.focus();
        inputEl.textContent = text;
        // Dispatch input event to trigger React state update
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      } 
      // For textareas
      else if (inputEl.tagName === 'TEXTAREA') {
        inputEl.focus();
        inputEl.value = text;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }

      if (autoSubmit) {
        setTimeout(() => {
          // Try to find and click the send button
          const sendBtnSelectors = [
            'button[aria-label*="Send"]',
            'button[aria-label*="send"]',
            'button[type="submit"]',
            'button[class*="send"]',
          ];
          for (const sel of sendBtnSelectors) {
            try {
              const btn = document.querySelector(sel);
              if (btn && !btn.disabled) {
                btn.click();
                console.log(`${LOG_PREFIX} Auto-submitted via ${sel}`);
                return;
              }
            } catch (e) { /* skip */ }
          }
          console.warn(`${LOG_PREFIX} Could not find send button for auto-submit`);
        }, 500);
      }
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to inject text:`, error);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
