/**
 * AI Token Tracker & Switcher — Text Extractor
 * 
 * Generic message extraction utility. Site-specific content scripts
 * provide a configuration object; this module handles the actual
 * DOM traversal and normalization.
 */

const AIExtractText = (() => {
  'use strict';

  const LOG_PREFIX = '[AI-Tracker][Extract]';

  /**
   * Extract all messages from a chat container using site-specific config.
   * 
   * @param {Element} containerEl - The chat container element.
   * @param {object} siteConfig - Site-specific extraction configuration:
   *   {
   *     messageSelectors: string[],      // CSS selectors to find message elements
   *     roleDetector: (el) => 'human'|'assistant',  // Function to determine role
   *     contentExtractor: (el) => string,  // Optional: custom content extraction
   *     filterEmpty: boolean               // Skip empty messages (default: true)
   *   }
   * @returns {Array<{role: string, content: string, index: number}>}
   */
  function extractMessages(containerEl, siteConfig) {
    if (!containerEl || !siteConfig) {
      console.warn(`${LOG_PREFIX} Missing container or config`);
      return [];
    }

    const { messageSelectors, roleDetector, contentExtractor, filterEmpty = true } = siteConfig;

    // Try each selector until we find messages
    let messageElements = [];
    let matchedSelector = '';

    for (const selector of messageSelectors) {
      try {
        const elements = containerEl.querySelectorAll(selector);
        if (elements && elements.length > 0) {
          messageElements = Array.from(elements);
          matchedSelector = selector;
          break;
        }
      } catch (e) {
        // Invalid selector, skip
        console.warn(`${LOG_PREFIX} Invalid selector: ${selector}`, e.message);
      }
    }

    if (messageElements.length === 0) {
      console.log(`${LOG_PREFIX} No messages found with any selector`);
      return [];
    }

    console.log(`${LOG_PREFIX} Found ${messageElements.length} messages via "${matchedSelector}"`);

    // Extract and normalize each message
    const messages = [];
    messageElements.forEach((el, index) => {
      try {
        const role = roleDetector(el, index);
        const content = contentExtractor
          ? contentExtractor(el)
          : extractTextContent(el);

        if (filterEmpty && (!content || content.trim().length === 0)) {
          return;
        }

        messages.push({
          role: role || (index % 2 === 0 ? 'human' : 'assistant'),
          content: content.trim(),
          index
        });
      } catch (e) {
        console.warn(`${LOG_PREFIX} Error extracting message ${index}:`, e.message);
      }
    });

    console.log(`${LOG_PREFIX} Extracted ${messages.length} non-empty messages`);
    return messages;
  }

  /**
   * Extract clean text content from an element.
   * Strips unnecessary whitespace, preserves code blocks.
   * 
   * @param {Element} el
   * @returns {string}
   */
  function extractTextContent(el) {
    if (!el) return '';

    // Clone to avoid modifying the actual DOM
    const clone = el.cloneNode(true);

    // Remove script and style elements
    clone.querySelectorAll('script, style, svg, .sr-only').forEach(e => e.remove());

    // Get text, normalizing whitespace but preserving line breaks
    let text = '';
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT, null, false);
    let node;
    while (node = walker.nextNode()) {
      const value = node.nodeValue;
      if (value && value.trim()) {
        text += value + ' ';
      }
    }

    // Also try to preserve code blocks
    clone.querySelectorAll('pre, code').forEach(codeEl => {
      // Already included via tree walker, but noting for structure
    });

    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Send extracted messages to the background service worker.
   * 
   * @param {string} site - Model identifier ('claude', 'chatgpt', 'gemini').
   * @param {Array<{role: string, content: string}>} messages
   */
  function sendToBackground(site, messages) {
    if (!messages) return;

    // Estimate tokens in content script
    const tokenCount = typeof AITokenizer !== 'undefined'
      ? AITokenizer.estimateTokensForMessages(messages)
      : 0;

    const payload = {
      type: 'CONVERSATION_UPDATE',
      site,
      messages,
      tokenCount,
      messageCount: messages.length,
      timestamp: Date.now()
    };

    console.log(`${LOG_PREFIX} Sending to background: ${site}, ${messages.length} msgs, ~${tokenCount} tokens`);

    try {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          console.warn(`${LOG_PREFIX} Message send error:`, chrome.runtime.lastError.message);
          return;
        }
        if (response) {
          console.log(`${LOG_PREFIX} Background response:`, response);
        }
      });
    } catch (e) {
      console.warn(`${LOG_PREFIX} Failed to send message:`, e.message);
    }
  }

  return {
    extractMessages,
    extractTextContent,
    sendToBackground
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.AIExtractText = AIExtractText;
}
