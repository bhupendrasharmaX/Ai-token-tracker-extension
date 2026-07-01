/**
 * AI Token Tracker & Switcher — Usage Tracker Module
 * 
 * Logs message tokens/counts locally, computes rolling 5-hour and 7-day totals,
 * calculates countdowns to quota replenishment, and integrates with the Anthropic API.
 */

const AIUsageTracker = (() => {
  'use strict';

  const LOG_PREFIX = '[AI-Tracker][Usage]';

  // Rolling windows in milliseconds
  const SESSION_WINDOW = 5 * 60 * 60 * 1000; // 5 hours
  const WEEKLY_WINDOW = 7 * 24 * 60 * 60 * 1000; // 7 days

  // Default usage limits if not overridden in settings
  const DEFAULT_USAGE_LIMITS = {
    claude: { session: 1000000, weekly: 10000000 },
    chatgpt: { session: 500000, weekly: 5000000 },
    gemini: { session: 5000000, weekly: 50000000 }
  };

  /**
   * Log a message event for a specific model.
   * 
   * @param {string} modelId - 'claude', 'chatgpt', 'gemini'
   * @param {number} tokens - token count of the interaction
   * @param {number} messages - number of messages added (usually 1 or 2)
   */
  async function logActivity(modelId, tokens, messages = 1) {
    if (!modelId) return;

    try {
      const stored = await chrome.storage.local.get('usageLogs');
      const usageLogs = stored.usageLogs || {};
      
      if (!usageLogs[modelId]) {
        usageLogs[modelId] = [];
      }

      // Add new log entry
      usageLogs[modelId].push({
        timestamp: Date.now(),
        tokens: Number(tokens) || 0,
        messages: Number(messages) || 1
      });

      // Prune logs older than 7 days
      const cutoff = Date.now() - WEEKLY_WINDOW;
      usageLogs[modelId] = usageLogs[modelId].filter(log => log.timestamp >= cutoff);

      await chrome.storage.local.set({ usageLogs });
      console.log(`${LOG_PREFIX} Logged activity for ${modelId}: +${tokens} tokens`);
    } catch (e) {
      console.error(`${LOG_PREFIX} Error logging activity:`, e);
    }
  }

  /**
   * Get total usage for a model within a rolling window.
   * 
   * @param {Array} logs - array of log entries for the model
   * @param {number} windowMs - window size in milliseconds
   * @returns {number} sum of tokens in the window
   */
  function calculateRollingUsage(logs, windowMs) {
    if (!logs || !Array.isArray(logs)) return 0;
    const cutoff = Date.now() - windowMs;
    return logs
      .filter(log => log.timestamp >= cutoff)
      .reduce((sum, log) => sum + (log.tokens || 0), 0);
  }

  /**
   * Calculate remaining time until the quota resets/replenishes.
   * (Finds when the oldest log within the window will drop off)
   * 
   * @param {Array} logs - array of log entries
   * @param {number} windowMs - window size in milliseconds
   * @returns {number} milliseconds remaining (0 if no active logs in window)
   */
  function calculateResetTime(logs, windowMs) {
    if (!logs || !Array.isArray(logs)) return 0;
    const cutoff = Date.now() - windowMs;
    const activeLogs = logs.filter(log => log.timestamp >= cutoff);
    
    if (activeLogs.length === 0) return 0;

    // The oldest log in the window is the first one
    const oldestLog = activeLogs[0];
    const expiryTime = oldestLog.timestamp + windowMs;
    return Math.max(0, expiryTime - Date.now());
  }

  /**
   * Fetch real limit data from Anthropic API using organization admin headers.
   * 
   * @param {string} apiKey - Anthropic developer key
   * @returns {Promise<{sessionLimit: number, sessionRemaining: number}>}
   */
  async function fetchClaudeApiUsage(apiKey) {
    if (!apiKey) {
      throw new Error('API key is empty');
    }

    console.log(`${LOG_PREFIX} Fetching Claude API limits...`);

    // Standard Anthropic message API request with tiny token count to trigger limit header response
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'dangerously-allow-javascript': 'true' // In extensions we need to allow browser context
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }]
        })
      });

      // Read limits from standard rate-limit headers
      const limitHeader = response.headers.get('anthropic-ratelimit-tokens-limit');
      const remainingHeader = response.headers.get('anthropic-ratelimit-tokens-remaining');
      const resetHeader = response.headers.get('anthropic-ratelimit-tokens-reset'); // in seconds

      if (limitHeader && remainingHeader) {
        return {
          sessionLimit: Number(limitHeader),
          sessionRemaining: Number(remainingHeader),
          sessionResetTime: (Number(resetHeader) || 0) * 1000,
          apiSuccess: true
        };
      }
      
      // If we got a 400 or other code, parse the body or throw
      const body = await response.json();
      if (body.error) {
        throw new Error(body.error.message || 'API request failed');
      }

      throw new Error('Limits headers not found in response');
    } catch (e) {
      console.warn(`${LOG_PREFIX} Anthropic API call failed (likely missing permissions or rate-limit headers):`, e.message);
      throw e;
    }
  }

  /**
   * Retrieve calculated usage stats for a model.
   * 
   * @param {string} modelId - 'claude', 'chatgpt', 'gemini'
   * @param {object} settings - extension settings containing API keys and limits
   * @returns {Promise<object>} stats object
   */
  async function getUsageStats(modelId, settings = {}) {
    const limits = settings.customLimits || {};
    
    // Pick appropriate limits (session is 5-hour, weekly is 7-day)
    const sessionLimit = limits[modelId] 
      ? limits[modelId] * 5  // Session limit is context window * 5 by default
      : (DEFAULT_USAGE_LIMITS[modelId]?.session || 500000);
      
    const weeklyLimit = limits[modelId]
      ? limits[modelId] * 50 // Weekly limit is context window * 50 by default
      : (DEFAULT_USAGE_LIMITS[modelId]?.weekly || 5000000);

    const stored = await chrome.storage.local.get('usageLogs');
    const logs = stored.usageLogs?.[modelId] || [];

    // Calculate rolling estimated usage
    const sessionTokens = calculateRollingUsage(logs, SESSION_WINDOW);
    const weeklyTokens = calculateRollingUsage(logs, WEEKLY_WINDOW);
    
    const sessionResetTime = calculateResetTime(logs, SESSION_WINDOW);
    const weeklyResetTime = calculateResetTime(logs, WEEKLY_WINDOW);

    const stats = {
      modelId,
      sessionTokens,
      sessionLimit,
      sessionPercent: Math.min(Math.round((sessionTokens / sessionLimit) * 100), 100),
      sessionResetTime,
      
      weeklyTokens,
      weeklyLimit,
      weeklyPercent: Math.min(Math.round((weeklyTokens / weeklyLimit) * 100), 100),
      weeklyResetTime,
      
      apiActive: false
    };

    // If Claude is configured to use the API key, try pulling real usage
    if (modelId === 'claude' && settings.claudeUsageMode === 'api' && settings.claudeApiKey) {
      try {
        const apiData = await fetchClaudeApiUsage(settings.claudeApiKey);
        stats.sessionLimit = apiData.sessionLimit;
        stats.sessionTokens = Math.max(0, apiData.sessionLimit - apiData.sessionRemaining);
        stats.sessionPercent = Math.min(Math.round((stats.sessionTokens / stats.sessionLimit) * 100), 100);
        stats.sessionResetTime = apiData.sessionResetTime;
        stats.apiActive = true;
      } catch (err) {
        console.warn(`${LOG_PREFIX} Falling back to local estimation due to API error:`, err.message);
      }
    }

    return stats;
  }

  /**
   * Calculate cache timer countdown.
   * 
   * @param {string} modelId - model identifier
   * @param {number} lastActivityTime - timestamp of last message sent
   * @param {number} customTtlSeconds - optional custom TTL override
   * @returns {number} remaining seconds (0 if expired or invalid)
   */
  function getCacheRemainingSeconds(modelId, lastActivityTime, customTtlSeconds = 300) {
    if (!lastActivityTime) return 0;
    
    // Claude has 5 minutes (300 seconds) prompt cache TTL.
    // For other models, use the custom placeholder TTL (default 300 seconds).
    const ttlMs = modelId === 'claude' 
      ? 5 * 60 * 1000 
      : (customTtlSeconds || 300) * 1000;

    const expiry = lastActivityTime + ttlMs;
    const remaining = expiry - Date.now();
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  return {
    logActivity,
    getUsageStats,
    getCacheRemainingSeconds,
    fetchClaudeApiUsage,
    SESSION_WINDOW,
    WEEKLY_WINDOW
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.AIUsageTracker = AIUsageTracker;
}
