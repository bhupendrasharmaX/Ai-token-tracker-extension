/**
 * AI Token Tracker & Switcher — ChatGPT Content Script
 * 
 * Watches the ChatGPT (chat.openai.com / chatgpt.com) interface
 * for new messages, extracts conversation text, and sends token
 * counts to the service worker.
 */

(() => {
  'use strict';

  const LOG_PREFIX = '[AI-Tracker][ChatGPT]';
  const SITE_ID = 'chatgpt';

  console.log(`${LOG_PREFIX} Content script loaded on ${window.location.href}`);

  // ═══════════════════════════════════════════════
  // ChatGPT-specific DOM selectors (multi-strategy)
  // ═══════════════════════════════════════════════

  const CONTAINER_SELECTORS = [
    'main',
    '[role="presentation"]',
    '[role="main"]',
    'div.flex.flex-col.items-center',
    'div[class*="thread"]',
    'div[class*="conversation"]',
    '#__next main',
  ];

  const MESSAGE_SELECTORS = [
    '[data-message-author-role]',               // Most reliable — role is in the attribute
    '[data-testid*="conversation-turn"]',       // Test ID pattern
    'article',                                   // Semantic articles
    '[data-testid*="message"]',                 // Message test ID
    'div[class*="agent-turn"], div[class*="user-turn"]',
    'div[class*="group"][class*="text"]',        // Text group blocks
  ];

  const INPUT_SELECTORS = [
    '#prompt-textarea',                          // Known stable ID
    'textarea[data-id="root"]',
    'textarea',
    '[contenteditable="true"]',
    'div[id="prompt-textarea"]',
    '[role="textbox"]',
  ];

  // ═══════════════════════════════════════════════
  // Role Detection
  // ═══════════════════════════════════════════════

  function detectRole(el, index) {
    // Strategy 1: data-message-author-role (most reliable for ChatGPT)
    const role = el.getAttribute('data-message-author-role');
    if (role === 'user') return 'human';
    if (role === 'assistant') return 'assistant';

    // Strategy 2: Check for data-message-author-role on children
    const childWithRole = el.querySelector('[data-message-author-role]');
    if (childWithRole) {
      const childRole = childWithRole.getAttribute('data-message-author-role');
      if (childRole === 'user') return 'human';
      if (childRole === 'assistant') return 'assistant';
    }

    // Strategy 3: Check data-testid
    const testId = (el.getAttribute('data-testid') || '').toLowerCase();
    if (testId.includes('user')) return 'human';
    if (testId.includes('assistant') || testId.includes('agent')) return 'assistant';

    // Strategy 4: Class-based detection
    const className = (el.className || '').toString().toLowerCase();
    if (className.includes('user')) return 'human';
    if (className.includes('agent') || className.includes('assistant')) return 'assistant';

    // Strategy 5: Look for avatar or role name in the message
    const avatarEl = el.querySelector('img[alt], [class*="avatar"]');
    if (avatarEl) {
      const alt = (avatarEl.getAttribute('alt') || '').toLowerCase();
      if (alt.includes('user') || alt.includes('you')) return 'human';
      if (alt.includes('chatgpt') || alt.includes('gpt')) return 'assistant';
    }

    // Strategy 6: Alternating pattern fallback
    return index % 2 === 0 ? 'human' : 'assistant';
  }

  // ═══════════════════════════════════════════════
  // Content Extraction
  // ═══════════════════════════════════════════════

  function extractContent(el) {
    const clone = el.cloneNode(true);

    // Remove ChatGPT-specific UI elements
    const removeSelectors = [
      'button',
      '[class*="avatar"]',
      '[class*="actions"]',
      '[class*="feedback"]',
      'svg',
      '.sr-only',
      '[class*="share"]',
      '[class*="copy"]',
      'nav',
      'header',
    ];
    removeSelectors.forEach(sel => {
      try { clone.querySelectorAll(sel).forEach(e => e.remove()); } catch (e) { /* skip */ }
    });

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

    let messageContainer = container;
    const innerContainers = [
      '[class*="thread"]',
      '[role="log"]',
      '[class*="messages"]',
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
    AIExtractText.sendToBackground(SITE_ID, messages);
  }

  async function init() {
    console.log(`${LOG_PREFIX} Initializing...`);

    try {
      await AIDomObserver.createChatObserver({
        containerSelectors: CONTAINER_SELECTORS,
        onMutation: onChatMutation,
        debounceMs: 350,
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
   * Inject text into ChatGPT's input box.
   */
  async function injectText(text, autoSubmit = false) {
    console.log(`${LOG_PREFIX} Injecting handoff text (${text.length} chars)...`);

    try {
      const inputEl = await AIDomObserver.waitForElement(INPUT_SELECTORS, 10000);
      console.log(`${LOG_PREFIX} Found input element:`, inputEl.tagName, inputEl.id);

      if (inputEl.tagName === 'TEXTAREA') {
        inputEl.focus();
        // Use native setter to bypass React's synthetic event system
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        ).set;
        nativeInputValueSetter.call(inputEl, text);
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (inputEl.getAttribute('contenteditable') === 'true') {
        inputEl.focus();
        inputEl.textContent = text;
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Adjust textarea height
      if (inputEl.tagName === 'TEXTAREA') {
        inputEl.style.height = 'auto';
        inputEl.style.height = inputEl.scrollHeight + 'px';
      }

      if (autoSubmit) {
        setTimeout(() => {
          const sendBtnSelectors = [
            'button[data-testid="send-button"]',
            'button[aria-label*="Send"]',
            'button[aria-label*="send"]',
            'form button[type="submit"]',
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
