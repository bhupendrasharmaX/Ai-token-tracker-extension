/**
 * AI Token Tracker & Switcher — Model Limits Configuration
 * 
 * Editable config object with context limits, URLs, and display info
 * for each supported AI model.
 */

const AIModelLimits = (() => {
  'use strict';

  /**
   * Default model configurations.
   * contextWindow = maximum tokens the model can handle in a single conversation.
   */
  const MODEL_LIMITS = {
    claude: {
      id: 'claude',
      name: 'Claude',
      provider: 'Anthropic',
      contextWindow: 200000,
      url: 'https://claude.ai/new',
      urlPatterns: ['claude.ai'],
      icon: '🟣',
      color: '#D97706'
    },
    chatgpt: {
      id: 'chatgpt',
      name: 'ChatGPT',
      provider: 'OpenAI',
      contextWindow: 128000,
      url: 'https://chatgpt.com/',
      urlPatterns: ['chat.openai.com', 'chatgpt.com'],
      icon: '🟢',
      color: '#10A37F'
    },
    gemini: {
      id: 'gemini',
      name: 'Gemini',
      provider: 'Google',
      contextWindow: 1000000,
      url: 'https://gemini.google.com/app',
      urlPatterns: ['gemini.google.com'],
      icon: '🔵',
      color: '#4285F4'
    }
  };

  /** Default threshold percentage to trigger auto-switch */
  const DEFAULT_THRESHOLD = 90;

  /** Default model rotation order */
  const DEFAULT_MODEL_ORDER = ['claude', 'chatgpt', 'gemini'];

  /**
   * Detect which model site the current URL belongs to.
   * @param {string} url - The page URL.
   * @returns {string|null} Model ID or null if not a supported site.
   */
  function detectModel(url) {
    if (!url) return null;
    for (const [id, config] of Object.entries(MODEL_LIMITS)) {
      for (const pattern of config.urlPatterns) {
        if (url.includes(pattern)) return id;
      }
    }
    return null;
  }

  /**
   * Get model config by ID.
   * @param {string} modelId 
   * @returns {object|null}
   */
  function getModel(modelId) {
    return MODEL_LIMITS[modelId] || null;
  }

  /**
   * Get the context window limit for a model.
   * Falls back to user-configured limits from storage.
   * @param {string} modelId 
   * @param {object} [userLimits] - Optional user-configured limits.
   * @returns {number}
   */
  function getLimit(modelId, userLimits) {
    if (userLimits && userLimits[modelId]) {
      return userLimits[modelId];
    }
    const model = MODEL_LIMITS[modelId];
    return model ? model.contextWindow : 128000;
  }

  /**
   * Get all model IDs.
   * @returns {string[]}
   */
  function getAllModelIds() {
    return Object.keys(MODEL_LIMITS);
  }

  /**
   * Get all models as an array.
   * @returns {object[]}
   */
  function getAllModels() {
    return Object.values(MODEL_LIMITS);
  }

  return {
    MODEL_LIMITS,
    DEFAULT_THRESHOLD,
    DEFAULT_MODEL_ORDER,
    detectModel,
    getModel,
    getLimit,
    getAllModelIds,
    getAllModels
  };
})();

// Export for ES module usage (service worker)
if (typeof globalThis !== 'undefined') {
  globalThis.AIModelLimits = AIModelLimits;
}
