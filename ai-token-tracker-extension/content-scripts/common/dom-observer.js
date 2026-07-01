/**
 * AI Token Tracker & Switcher — DOM Observer
 * 
 * Reusable MutationObserver factory with debouncing, auto-reconnect,
 * and element waiting utilities for SPA chat interfaces.
 */

const AIDomObserver = (() => {
  'use strict';

  const LOG_PREFIX = '[AI-Tracker][Observer]';
  let _observer = null;
  let _debounceTimer = null;
  let _reconnectTimer = null;
  let _isObserving = false;

  /**
   * Wait for a DOM element to appear.
   * Retries with exponential backoff up to the timeout.
   * 
   * @param {string|string[]} selectors - CSS selector(s) to try (first match wins).
   * @param {number} [timeout=15000] - Max wait time in ms.
   * @param {Element} [root=document] - Root element to search within.
   * @returns {Promise<Element>} The found element.
   */
  function waitForElement(selectors, timeout = 15000, root = document) {
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];
    
    return new Promise((resolve, reject) => {
      // Try immediately first
      for (const sel of selectorList) {
        try {
          const el = root.querySelector(sel);
          if (el) {
            console.log(`${LOG_PREFIX} Found element immediately: ${sel}`);
            return resolve(el);
          }
        } catch (e) {
          // Invalid selector, skip
        }
      }

      const startTime = Date.now();
      
      // Watch for the element to appear
      const observer = new MutationObserver(() => {
        for (const sel of selectorList) {
          try {
            const el = root.querySelector(sel);
            if (el) {
              observer.disconnect();
              console.log(`${LOG_PREFIX} Found element via observer: ${sel}`);
              return resolve(el);
            }
          } catch (e) {
            // Invalid selector, skip
          }
        }

        if (Date.now() - startTime > timeout) {
          observer.disconnect();
          console.warn(`${LOG_PREFIX} Timeout waiting for elements: ${selectorList.join(', ')}`);
          reject(new Error(`Element not found within ${timeout}ms: ${selectorList.join(', ')}`));
        }
      });

      observer.observe(root.documentElement || root, {
        childList: true,
        subtree: true
      });

      // Safety timeout
      setTimeout(() => {
        observer.disconnect();
        // One last try
        for (const sel of selectorList) {
          try {
            const el = root.querySelector(sel);
            if (el) return resolve(el);
          } catch (e) { /* skip */ }
        }
        reject(new Error(`Element not found within ${timeout}ms: ${selectorList.join(', ')}`));
      }, timeout);
    });
  }

  /**
   * Create and start a MutationObserver on a chat container.
   * Includes debouncing and auto-reconnect for SPA navigation.
   * 
   * @param {object} config
   * @param {string|string[]} config.containerSelectors - Selectors to find the chat container.
   * @param {Function} config.onMutation - Callback when meaningful changes detected.
   * @param {number} [config.debounceMs=300] - Debounce interval.
   * @param {boolean} [config.watchAttributes=false] - Also watch attribute changes.
   * @returns {Promise<MutationObserver>}
   */
  async function createChatObserver(config) {
    const {
      containerSelectors,
      onMutation,
      debounceMs = 300,
      watchAttributes = false
    } = config;

    const selectors = Array.isArray(containerSelectors)
      ? containerSelectors
      : [containerSelectors];

    console.log(`${LOG_PREFIX} Searching for chat container...`, selectors);

    let container;
    try {
      container = await waitForElement(selectors, 20000);
    } catch (e) {
      console.warn(`${LOG_PREFIX} Could not find chat container. Will retry...`);
      scheduleReconnect(config);
      return null;
    }

    console.log(`${LOG_PREFIX} Found chat container:`, container.tagName, container.className?.substring?.(0, 50));

    // Disconnect previous observer if any
    if (_observer) {
      _observer.disconnect();
      _isObserving = false;
    }

    _observer = new MutationObserver((mutations) => {
      // Check if any mutation is meaningful (added/removed nodes with text)
      const hasMeaningfulChange = mutations.some(m => {
        if (m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)) {
          return true;
        }
        if (m.type === 'characterData') return true;
        return false;
      });

      if (!hasMeaningfulChange) return;

      // Debounce
      if (_debounceTimer) clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(() => {
        console.log(`${LOG_PREFIX} Meaningful DOM change detected, extracting...`);
        onMutation(container);
      }, debounceMs);
    });

    const observerConfig = {
      childList: true,
      subtree: true,
      characterData: true
    };
    if (watchAttributes) {
      observerConfig.attributes = true;
      observerConfig.attributeFilter = ['class', 'data-message-id', 'data-testid'];
    }

    _observer.observe(container, observerConfig);
    _isObserving = true;
    console.log(`${LOG_PREFIX} MutationObserver active on chat container`);

    // Also do an initial extraction
    setTimeout(() => onMutation(container), 500);

    // Watch for container replacement (SPA navigation)
    monitorContainerExists(container, config);

    return _observer;
  }

  /**
   * Monitor if the container is still in the DOM.
   * If it's removed (SPA navigation), reconnect.
   */
  function monitorContainerExists(container, config) {
    const checkInterval = setInterval(() => {
      if (!document.body.contains(container)) {
        console.log(`${LOG_PREFIX} Chat container removed from DOM (SPA navigation?). Reconnecting...`);
        clearInterval(checkInterval);
        if (_observer) {
          _observer.disconnect();
          _isObserving = false;
        }
        // Wait a bit for the new page to render, then reconnect
        setTimeout(() => createChatObserver(config), 1500);
      }
    }, 3000);
  }

  /**
   * Schedule a reconnect attempt.
   */
  function scheduleReconnect(config, delay = 5000) {
    if (_reconnectTimer) clearTimeout(_reconnectTimer);
    _reconnectTimer = setTimeout(() => {
      console.log(`${LOG_PREFIX} Attempting reconnect...`);
      createChatObserver(config);
    }, delay);
  }

  /**
   * Disconnect the observer and clean up.
   */
  function disconnect() {
    if (_observer) {
      _observer.disconnect();
      _observer = null;
      _isObserving = false;
    }
    if (_debounceTimer) clearTimeout(_debounceTimer);
    if (_reconnectTimer) clearTimeout(_reconnectTimer);
    console.log(`${LOG_PREFIX} Observer disconnected and cleaned up`);
  }

  /**
   * Check if observer is currently active.
   */
  function isActive() {
    return _isObserving;
  }

  return {
    waitForElement,
    createChatObserver,
    disconnect,
    isActive
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.AIDomObserver = AIDomObserver;
}
