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
  /**
   * Inject or update an on-page token usage widget below the chat input box.
   */
  function updateOnPageWidget(site, tokenCount) {
    // 1. Find input area element
    let inputEl = null;
    const inputSelectors = [
      '#prompt-textarea',
      '[contenteditable="true"]',
      'div.ProseMirror',
      'rich-textarea',
      'textarea',
      '[role="textbox"]'
    ];
    
    for (const sel of inputSelectors) {
      inputEl = document.querySelector(sel);
      if (inputEl) break;
    }
    
    if (!inputEl) return;
    
    // 2. Pierce shadow DOM boundaries to get to the light DOM host element
    let hostEl = inputEl;
    while (hostEl && hostEl.getRootNode() && hostEl.getRootNode().host) {
      hostEl = hostEl.getRootNode().host;
    }
    
    // 3. Find closest wrapper container and reference element to append the widget
    let wrapper = null;
    let referenceEl = null;
    
    if (site === 'claude') {
      const inputContainer = hostEl.closest('fieldset') || hostEl.closest('div[class*="input-container"]');
      if (inputContainer) {
        wrapper = inputContainer.parentElement;
        referenceEl = inputContainer.nextSibling;
      } else {
        wrapper = hostEl.parentElement;
      }
    } else if (site === 'chatgpt') {
      const form = hostEl.closest('form');
      if (form) {
        wrapper = form.parentElement;
        referenceEl = form.nextSibling;
      } else {
        wrapper = hostEl.parentElement;
      }
    } else if (site === 'gemini') {
      const inputContainer = hostEl.closest('rich-textarea') || hostEl.closest('div[class*="input-area"]') || hostEl;
      if (inputContainer) {
        wrapper = inputContainer.parentElement;
        referenceEl = inputContainer.nextSibling;
      } else {
        wrapper = hostEl.parentElement;
      }
    }
    
    if (!wrapper) return;
    
    // 3. Create widget if it doesn't exist
    // Query within the specific parent to avoid matching widgets in other places
    let widget = wrapper.querySelector(':scope > .ai-tracker-widget');
    if (!widget) {
      widget = document.createElement('div');
      widget.className = 'ai-tracker-widget';
      widget.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 6px 12px;
        margin: 8px auto 4px;
        font-size: 11px;
        font-family: inherit;
        color: currentColor;
        opacity: 0.85;
        width: 100%;
        max-width: 768px;
        box-sizing: border-box;
        transition: all 0.3s ease;
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.05);
        border-radius: 8px;
      `;
      
      widget.innerHTML = `
        <!-- Top Row: Conversation Tokens -->
        <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <span class="widget-icon">🟢</span>
            <span style="font-weight: 500;">Tokens: <strong class="widget-tokens" style="font-weight: 700;">0</strong> / <span class="widget-limit">0</span></span>
            <span class="widget-percent" style="font-weight: 600; padding: 1px 5px; border-radius: 4px; font-size: 10px;">0%</span>
          </div>
          <div style="width: 80px; height: 3px; background: rgba(120, 120, 120, 0.2); border-radius: 1.5px; overflow: hidden; margin-left: auto;">
            <div class="widget-bar" style="width: 0%; height: 100%; background: #22C55E; border-radius: 1.5px; transition: width 0.3s ease, background-color 0.3s;"></div>
          </div>
        </div>

        <!-- Bottom Row: Usage Quota (Session & Weekly side-by-side) -->
        <div class="widget-usage-row" style="display: flex; align-items: center; justify-content: space-between; width: 100%; font-size: 10px; opacity: 0.85; margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(120, 120, 120, 0.15);">
          <!-- Session (Left) -->
          <div style="display: flex; align-items: center; gap: 6px; flex: 1;">
            <span style="white-space: nowrap;">Session: <strong class="widget-session-pct">0%</strong> <span class="widget-session-reset" style="opacity: 0.6; font-size: 9px;"></span></span>
            <div style="flex: 1; max-width: 60px; height: 3px; background: rgba(120, 120, 120, 0.2); border-radius: 1.5px; overflow: hidden;">
              <div class="widget-session-bar" style="width: 0%; height: 100%; background: #8B5CF6; border-radius: 1.5px; transition: width 0.3s ease;"></div>
            </div>
          </div>

          <!-- Weekly (Right) -->
          <div style="display: flex; align-items: center; gap: 6px; flex: 1; justify-content: flex-end;">
            <div style="flex: 1; max-width: 60px; height: 3px; background: rgba(120, 120, 120, 0.2); border-radius: 1.5px; overflow: hidden; margin-left: auto;">
              <div class="widget-weekly-bar" style="width: 0%; height: 100%; background: #A78BFA; border-radius: 1.5px; transition: width 0.3s ease;"></div>
            </div>
            <span style="white-space: nowrap;">Weekly: <strong class="widget-weekly-pct">0%</strong> <span class="widget-weekly-reset" style="opacity: 0.6; font-size: 9px; margin-left: 4px;"></span></span>
          </div>
        </div>
      `;
      
      if (referenceEl) {
        wrapper.insertBefore(widget, referenceEl);
      } else {
        wrapper.appendChild(widget);
      }
    }
    
    // 4. Update widget values
    const limit = typeof AIModelLimits !== 'undefined'
      ? AIModelLimits.getLimit(site)
      : 128000;
      
    const percent = Math.min(Math.round((tokenCount / limit) * 100), 100);
    
    const tokensEl = widget.querySelector('.widget-tokens');
    const limitEl = widget.querySelector('.widget-limit');
    const percentEl = widget.querySelector('.widget-percent');
    const barEl = widget.querySelector('.widget-bar');
    const iconEl = widget.querySelector('.widget-icon');
    
    if (tokensEl) tokensEl.textContent = tokenCount.toLocaleString();
    if (limitEl) limitEl.textContent = (limit / 1000).toFixed(0) + 'K';
    if (percentEl) {
      percentEl.textContent = `${percent}%`;
      
      // Color-coding updates
      let badgeBg, badgeColor, barColor, icon;
      if (percent < 60) {
        badgeBg = 'rgba(34, 197, 94, 0.12)';
        badgeColor = '#22C55E';
        barColor = '#22C55E';
        icon = '🟢';
      } else if (percent < 85) {
        badgeBg = 'rgba(245, 158, 11, 0.12)';
        badgeColor = '#F59E0B';
        barColor = '#F59E0B';
        icon = '🟡';
      } else {
        badgeBg = 'rgba(239, 68, 68, 0.12)';
        badgeColor = '#EF4444';
        barColor = '#EF4444';
        icon = '🔴';
      }
      
      percentEl.style.backgroundColor = badgeBg;
      percentEl.style.color = badgeColor;
      if (barEl) {
        barEl.style.width = `${percent}%`;
        barEl.style.backgroundColor = barColor;
      }
      if (iconEl) iconEl.textContent = icon;
    }

    // 5. Query and update Session & Weekly usage stats
    chrome.runtime.sendMessage({
      type: 'GET_USAGE',
      modelId: site
    }, (response) => {
      if (chrome.runtime.lastError) {
        // Background script not loaded or listening yet
        return;
      }
      
      if (response && response.success && response.stats) {
        const stats = response.stats;
        
        const sessionBar = widget.querySelector('.widget-session-bar');
        const sessionPct = widget.querySelector('.widget-session-pct');
        const sessionReset = widget.querySelector('.widget-session-reset');
        
        const weeklyBar = widget.querySelector('.widget-weekly-bar');
        const weeklyPct = widget.querySelector('.widget-weekly-pct');
        const weeklyReset = widget.querySelector('.widget-weekly-reset');
        
        const formatResetText = (ms) => {
          if (!ms || ms <= 0) return '';
          const totalSecs = Math.floor(ms / 1000);
          const hours = Math.floor(totalSecs / 3600);
          const mins = Math.floor((totalSecs % 3600) / 60);
          const secs = totalSecs % 60;
          if (hours > 24) {
            return `· resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
          }
          if (hours > 0) {
            return `· resets in ${hours}h ${mins}m`;
          }
          if (mins > 0) {
            return `· resets in ${mins}m`;
          }
          return `· resets in ${secs}s`;
        };

        if (sessionBar) sessionBar.style.width = `${stats.sessionPercent}%`;
        if (sessionPct) sessionPct.textContent = `${stats.sessionPercent}%`;
        if (sessionReset) sessionReset.textContent = formatResetText(stats.sessionResetTime);

        if (weeklyBar) weeklyBar.style.width = `${stats.weeklyPercent}%`;
        if (weeklyPct) weeklyPct.textContent = `${stats.weeklyPercent}%`;
        if (weeklyReset) weeklyReset.textContent = formatResetText(stats.weeklyResetTime);
      }
    });
  }

  function sendToBackground(site, messages) {
    if (!messages) return;

    // Estimate tokens in content script
    const tokenCount = typeof AITokenizer !== 'undefined'
      ? AITokenizer.estimateTokensForMessages(messages)
      : 0;

    // Update on-page widget
    try {
      updateOnPageWidget(site, tokenCount);
    } catch (e) {
      console.warn(`${LOG_PREFIX} Error updating widget:`, e);
    }

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
