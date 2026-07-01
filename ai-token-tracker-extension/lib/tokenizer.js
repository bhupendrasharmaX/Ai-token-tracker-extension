/**
 * AI Token Tracker & Switcher — Tokenizer
 * 
 * Character-based heuristic token estimator.
 * ~4 characters ≈ 1 token for English text (matches OpenAI's general rule of thumb).
 * No external dependencies — runs in content scripts and service worker.
 */

// Make available globally for content scripts (non-module context)
// and as importable for service worker (module context)

const AITokenizer = (() => {
  'use strict';

  const CHARS_PER_TOKEN = 4;
  const OVERHEAD_PER_MESSAGE = 4; // role markers, delimiters
  const LOG_PREFIX = '[AI-Tracker][Tokenizer]';

  /**
   * Estimate token count for a single string.
   * @param {string} text - The text to estimate tokens for.
   * @returns {number} Estimated token count.
   */
  function estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    const count = Math.ceil(text.length / CHARS_PER_TOKEN);
    return count;
  }

  /**
   * Estimate total tokens for an array of messages.
   * Each message gets overhead for role markers.
   * @param {Array<{role: string, content: string}>} messages
   * @returns {number} Total estimated token count.
   */
  function estimateTokensForMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return 0;

    let total = 0;
    for (const msg of messages) {
      const contentTokens = estimateTokens(msg.content || '');
      const roleTokens = estimateTokens(msg.role || '');
      total += contentTokens + roleTokens + OVERHEAD_PER_MESSAGE;
    }

    console.log(`${LOG_PREFIX} Estimated ${total} tokens for ${messages.length} messages`);
    return total;
  }

  /**
   * Check if a token count is within a given limit.
   * @param {number} tokenCount - Current token count.
   * @param {number} limit - The context window limit.
   * @returns {{ within: boolean, percent: number }}
   */
  function isWithinLimit(tokenCount, limit) {
    if (!limit || limit <= 0) return { within: true, percent: 0 };
    const percent = Math.round((tokenCount / limit) * 100);
    return {
      within: percent < 100,
      percent: Math.min(percent, 100)
    };
  }

  /**
   * Get the percentage of limit used.
   * @param {number} tokenCount
   * @param {number} limit
   * @returns {number} Percentage (0–100).
   */
  function getPercentUsed(tokenCount, limit) {
    if (!limit || limit <= 0) return 0;
    return Math.min(Math.round((tokenCount / limit) * 100), 100);
  }

  return {
    estimateTokens,
    estimateTokensForMessages,
    isWithinLimit,
    getPercentUsed,
    CHARS_PER_TOKEN,
    OVERHEAD_PER_MESSAGE
  };
})();

// Export for ES module usage (service worker)
if (typeof globalThis !== 'undefined') {
  globalThis.AITokenizer = AITokenizer;
}
