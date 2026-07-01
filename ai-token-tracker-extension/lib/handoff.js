/**
 * AI Token Tracker & Switcher — Handoff Module
 * 
 * Builds condensed continuation text and manages the handoff
 * to the next AI model in the rotation.
 */

const AIHandoff = (() => {
  'use strict';

  const LOG_PREFIX = '[AI-Tracker][Handoff]';

  /**
   * Build the handoff text — a condensed continuation prompt
   * containing the conversation context.
   * 
   * @param {Array<{role: string, content: string}>} messages - All conversation messages.
   * @param {string} sourceModel - The model we're switching FROM.
   * @param {object} options - { mode: 'full'|'lastN', lastN: number }
   * @returns {string} Formatted handoff text.
   */
  function buildHandoffText(messages, sourceModel, options = {}) {
    const mode = options.mode || 'full';
    const lastN = options.lastN || 10;

    let selectedMessages = messages;
    if (mode === 'lastN' && messages.length > lastN) {
      selectedMessages = messages.slice(-lastN);
    }

    const totalTokens = typeof AITokenizer !== 'undefined'
      ? AITokenizer.estimateTokensForMessages(selectedMessages)
      : Math.ceil(selectedMessages.reduce((sum, m) => sum + (m.content || '').length, 0) / 4);

    const header = [
      `═══════════════════════════════════════════════════`,
      `  CONVERSATION CONTINUED FROM ${(sourceModel || 'unknown').toUpperCase()}`,
      `  ${selectedMessages.length} messages | ~${totalTokens.toLocaleString()} tokens`,
      `  ${mode === 'lastN' ? `(Last ${lastN} of ${messages.length} messages)` : '(Full transcript)'}`,
      `═══════════════════════════════════════════════════`,
      ''
    ].join('\n');

    const body = selectedMessages.map(msg => {
      const role = msg.role === 'human' ? 'Human' : 'Assistant';
      return `[${role}]:\n${msg.content}\n`;
    }).join('\n---\n\n');

    const footer = [
      '',
      `═══════════════════════════════════════════════════`,
      `  Please continue this conversation naturally.`,
      `  Maintain the same context, tone, and any ongoing tasks.`,
      `═══════════════════════════════════════════════════`
    ].join('\n');

    const fullText = header + body + footer;
    console.log(`${LOG_PREFIX} Built handoff text: ${fullText.length} chars, ~${totalTokens} tokens`);
    return fullText;
  }

  /**
   * Get the next model in the rotation order.
   * @param {string} currentModelId - Current model ID.
   * @param {string[]} [modelOrder] - Custom model order.
   * @returns {string} Next model ID.
   */
  function getNextModel(currentModelId, modelOrder) {
    const order = modelOrder || (typeof AIModelLimits !== 'undefined'
      ? AIModelLimits.DEFAULT_MODEL_ORDER
      : ['claude', 'chatgpt', 'gemini']);

    const currentIndex = order.indexOf(currentModelId);
    if (currentIndex === -1) return order[0];
    return order[(currentIndex + 1) % order.length];
  }

  /**
   * Inject text into the target model's input box.
   * This function runs inside the target page via chrome.scripting.executeScript.
   * 
   * @param {string} text - The handoff text to inject.
   * @param {string} targetModelId - The target model identifier.
   * @param {boolean} autoSubmit - Whether to auto-click the send button.
   */
  function getInjectionScript(text, targetModelId, autoSubmit) {
    // This returns a function to be serialized and injected
    return {
      text, targetModelId, autoSubmit,
      // The actual injection logic runs via executeScript in service-worker
    };
  }

  return {
    buildHandoffText,
    getNextModel,
    getInjectionScript
  };
})();

if (typeof globalThis !== 'undefined') {
  globalThis.AIHandoff = AIHandoff;
}
