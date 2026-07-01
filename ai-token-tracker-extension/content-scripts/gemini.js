/**
 * AI Token Tracker & Switcher — Gemini Content Script
 * 
 * Watches the Gemini (gemini.google.com) interface for new messages,
 * extracts conversation text, and sends token counts to the service worker.
 */

(() => {
  'use strict';

  const LOG_PREFIX = '[AI-Tracker][Gemini]';
  const SITE_ID = 'gemini';

  console.log(`${LOG_PREFIX} Content script loaded on ${window.location.href}`);

  // ═══════════════════════════════════════════════
  // Gemini-specific DOM selectors (multi-strategy)
  // ═══════════════════════════════════════════════

  const CONTAINER_SELECTORS = [
    'main',
    '[role="main"]',
    '.conversation-container',
    'div[class*="conversation"]',
    'div[class*="chat-container"]',
    'c-wiz',                                   // Google's component wrapper
    'div[class*="response-container"]',
  ];

  const MESSAGE_SELECTORS = [
    'message-content',                          // Custom element (Gemini uses web components)
    '.model-response-text',
    '.user-query',
    '[class*="message-content"]',
    '[class*="query-content"]',
    '[class*="response-content"]',
    '.conversation-turn',
    'model-response',                           // Custom element
    'user-query',                               // Custom element
    '[data-content-type]',
    'div[class*="turn"]',
  ];

  const INPUT_SELECTORS = [
    'rich-textarea',                            // Gemini's custom textarea component
    '.ql-editor',                               // Quill editor (used internally)
    '[contenteditable="true"]',
    'textarea',
    '[role="textbox"]',
    'input[type="text"]',
    'div[class*="input-area"] [contenteditable]',
  ];

  // ═══════════════════════════════════════════════
  // Role Detection
  // ═══════════════════════════════════════════════

  function detectRole(el, index) {
    const tagName = el.tagName?.toLowerCase() || '';

    // Strategy 1: Custom element tag names (Gemini uses web components)
    if (tagName === 'user-query' || tagName.includes('user')) return 'human';
    if (tagName === 'model-response' || tagName.includes('model') || tagName.includes('response')) return 'assistant';

    // Strategy 2: Data attributes
    const contentType = el.getAttribute('data-content-type') || '';
    if (contentType.includes('user') || contentType.includes('query')) return 'human';
    if (contentType.includes('model') || contentType.includes('response')) return 'assistant';

    // Strategy 3: Class-based detection
    const className = (el.className || '').toString().toLowerCase();
    if (className.includes('user') || className.includes('query') || className.includes('human')) return 'human';
    if (className.includes('model') || className.includes('response') || className.includes('assistant')) return 'assistant';

    // Strategy 4: Check parent classes
    let parent = el.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      const parentTag = parent.tagName?.toLowerCase() || '';
      if (parentTag.includes('user') || parentTag.includes('query')) return 'human';
      if (parentTag.includes('model') || parentTag.includes('response')) return 'assistant';
      
      const parentClass = (parent.className || '').toString().toLowerCase();
      if (parentClass.includes('user') || parentClass.includes('query')) return 'human';
      if (parentClass.includes('model') || parentClass.includes('response')) return 'assistant';
      
      parent = parent.parentElement;
    }

    // Strategy 5: Alternating pattern
    return index % 2 === 0 ? 'human' : 'assistant';
  }

  // ═══════════════════════════════════════════════
  // Content Extraction
  // ═══════════════════════════════════════════════

  function extractContent(el) {
    const clone = el.cloneNode(true);

    // Handle Shadow DOM — Gemini may use it
    // Try to get content from shadow root if present
    if (el.shadowRoot) {
      return el.shadowRoot.textContent?.trim() || el.textContent?.trim() || '';
    }

    // Remove Gemini-specific UI elements
    const removeSelectors = [
      'button',
      'svg',
      '[class*="avatar"]',
      '[class*="icon"]',
      '[class*="action"]',
      '[class*="feedback"]',
      '[class*="copy"]',
      '[class*="share"]',
      'mat-icon',                  // Material Design icon component
      '.sr-only',
    ];
    removeSelectors.forEach(sel => {
      try { clone.querySelectorAll(sel).forEach(e => e.remove()); } catch (e) { /* skip */ }
    });

    return AIExtractText.extractTextContent(clone);
  }

  // ═══════════════════════════════════════════════
  // Shadow DOM Helper
  // ═══════════════════════════════════════════════

  /**
   * Deep query selector that pierces shadow DOM boundaries.
   * Gemini uses web components with shadow roots.
   */
  function deepQuerySelectorAll(root, selector) {
    const results = [];

    // Check the root itself
    try {
      root.querySelectorAll(selector).forEach(el => results.push(el));
    } catch (e) { /* skip */ }

    // Check shadow roots of all children
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        try {
          el.shadowRoot.querySelectorAll(selector).forEach(sEl => results.push(sEl));
        } catch (e) { /* skip */ }
        // Recurse into shadow root
        const deepResults = deepQuerySelectorAll(el.shadowRoot, selector);
        results.push(...deepResults);
      }
    }

    return results;
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

    // For Gemini, also try shadow DOM traversal
    let messages = AIExtractText.extractMessages(container, siteConfig);

    // If no messages found via standard extraction, try shadow DOM
    if (messages.length === 0) {
      console.log(`${LOG_PREFIX} Standard extraction found 0 messages, trying shadow DOM...`);
      
      for (const sel of MESSAGE_SELECTORS) {
        const deepElements = deepQuerySelectorAll(container, sel);
        if (deepElements.length > 0) {
          console.log(`${LOG_PREFIX} Found ${deepElements.length} messages via shadow DOM: ${sel}`);
          messages = deepElements.map((el, index) => ({
            role: detectRole(el, index),
            content: extractContent(el),
            index
          })).filter(m => m.content && m.content.trim().length > 0);
          break;
        }
      }
    }

    if (messages.length > 0) {
      AIExtractText.sendToBackground(SITE_ID, messages);
    }
  }

  async function init() {
    console.log(`${LOG_PREFIX} Initializing...`);

    try {
      await AIDomObserver.createChatObserver({
        containerSelectors: CONTAINER_SELECTORS,
        onMutation: onChatMutation,
        debounceMs: 400,
        watchAttributes: true
      });
      console.log(`${LOG_PREFIX} ✓ Observer started successfully`);
    } catch (error) {
      console.error(`${LOG_PREFIX} Failed to initialize:`, error);
    }
  }

  // Listen for handoff injection requests
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'INJECT_HANDOFF_TEXT') {
      console.log(`${LOG_PREFIX} Received handoff injection request`);
      injectText(message.text, message.autoSubmit);
      sendResponse({ success: true });
    }
    return true;
  });

  /**
   * Inject text into Gemini's input box.
   * Handles both custom web components and standard elements.
   */
  async function injectText(text, autoSubmit = false) {
    console.log(`${LOG_PREFIX} Injecting handoff text (${text.length} chars)...`);

    try {
      let inputEl = null;

      // First try standard selectors
      try {
        inputEl = await AIDomObserver.waitForElement(INPUT_SELECTORS, 5000);
      } catch (e) {
        console.log(`${LOG_PREFIX} Standard input not found, trying shadow DOM...`);
      }

      // Try shadow DOM if standard didn't work
      if (!inputEl) {
        for (const sel of INPUT_SELECTORS) {
          const deepResults = deepQuerySelectorAll(document.body, sel);
          if (deepResults.length > 0) {
            inputEl = deepResults[0];
            break;
          }
        }
      }

      if (!inputEl) {
        console.error(`${LOG_PREFIX} Could not find input element`);
        return;
      }

      console.log(`${LOG_PREFIX} Found input element:`, inputEl.tagName);

      // Handle different input types
      if (inputEl.getAttribute('contenteditable') === 'true') {
        inputEl.focus();
        inputEl.textContent = text;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (inputEl.tagName === 'TEXTAREA' || inputEl.tagName === 'INPUT') {
        inputEl.focus();
        inputEl.value = text;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // For custom web components, try setting innerHTML or innerText
        inputEl.focus();
        inputEl.innerText = text;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }

      if (autoSubmit) {
        setTimeout(() => {
          const sendBtnSelectors = [
            'button[aria-label*="Send"]',
            'button[aria-label*="send"]',
            'button[aria-label*="Submit"]',
            'button[class*="send"]',
            '.send-button',
            'button[mat-icon-button]',
          ];
          for (const sel of sendBtnSelectors) {
            try {
              const btns = deepQuerySelectorAll(document.body, sel);
              for (const btn of btns) {
                if (!btn.disabled) {
                  btn.click();
                  console.log(`${LOG_PREFIX} Auto-submitted via ${sel}`);
                  return;
                }
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
