/**
 * AI Token Tracker & Switcher — Background Service Worker
 * 
 * Maintains per-tab/per-conversation state, computes token usage
 * percentages, triggers handoff when threshold is exceeded,
 * and manages badge display.
 */

// Import shared libraries (relative to background script folder)
importScripts(
  '../lib/tokenizer.js',
  '../lib/model-limits.js',
  '../lib/handoff.js'
);

const LOG_PREFIX = '[AI-Tracker][SW]';

// ═══════════════════════════════════════════════
// State Management
// ═══════════════════════════════════════════════

/**
 * In-memory conversation state, keyed by tabId.
 * Persisted to chrome.storage.local on every update.
 */
const conversationState = new Map();

/**
 * User settings (loaded from storage on startup).
 */
let settings = {
  threshold: AIModelLimits.DEFAULT_THRESHOLD,
  modelOrder: [...AIModelLimits.DEFAULT_MODEL_ORDER],
  autoSubmit: false,
  handoffMode: 'full',   // 'full' or 'lastN'
  lastN: 10,
  customLimits: {},       // { modelId: number }
  enabled: true
};

// ═══════════════════════════════════════════════
// Initialization
// ═══════════════════════════════════════════════

async function initialize() {
  console.log(`${LOG_PREFIX} Service worker starting...`);

  // Load settings from storage
  try {
    const stored = await chrome.storage.local.get(['settings', 'conversationStates']);
    if (stored.settings) {
      settings = { ...settings, ...stored.settings };
      console.log(`${LOG_PREFIX} Loaded settings:`, settings);
    }
    // Restore conversation states from previous session
    if (stored.conversationStates) {
      for (const [tabId, state] of Object.entries(stored.conversationStates)) {
        conversationState.set(parseInt(tabId), state);
      }
      console.log(`${LOG_PREFIX} Restored ${conversationState.size} conversation states`);
    }
  } catch (e) {
    console.warn(`${LOG_PREFIX} Error loading settings:`, e);
  }
}

initialize();

// ═══════════════════════════════════════════════
// Message Handlers
// ═══════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(`${LOG_PREFIX} Received message:`, message.type, `from tab ${sender.tab?.id}`);

  switch (message.type) {
    case 'CONVERSATION_UPDATE':
      handleConversationUpdate(message, sender.tab);
      sendResponse({ received: true });
      break;

    case 'GET_STATE':
      handleGetState(message, sendResponse);
      return true; // Keep channel open for async response

    case 'MANUAL_SWITCH':
      handleManualSwitch(message, sender.tab);
      sendResponse({ received: true });
      break;

    case 'GET_SETTINGS':
      sendResponse({ settings });
      break;

    case 'UPDATE_SETTINGS':
      handleUpdateSettings(message.settings);
      sendResponse({ success: true });
      break;

    case 'GET_ALL_STATES':
      sendResponse({
        states: Object.fromEntries(conversationState)
      });
      break;

    default:
      sendResponse({ error: 'Unknown message type' });
  }

  return false;
});

// ═══════════════════════════════════════════════
// Conversation Update Handler
// ═══════════════════════════════════════════════

function handleConversationUpdate(message, tab) {
  if (!tab?.id) {
    console.warn(`${LOG_PREFIX} No tab ID in message`);
    return;
  }

  const { site, messages, tokenCount, messageCount, timestamp } = message;
  const tabId = tab.id;

  // Get the model's context limit
  const limit = AIModelLimits.getLimit(site, settings.customLimits);
  const percent = AITokenizer.getPercentUsed(tokenCount, limit);

  // Update state
  const state = {
    tabId,
    site,
    url: tab.url,
    messages,
    tokenCount,
    messageCount,
    limit,
    percent,
    lastUpdated: timestamp || Date.now(),
    modelInfo: AIModelLimits.getModel(site)
  };

  conversationState.set(tabId, state);

  console.log(
    `${LOG_PREFIX} Tab ${tabId} [${site}]: ${tokenCount.toLocaleString()} tokens ` +
    `(${percent}% of ${limit.toLocaleString()} limit) | ${messageCount} messages`
  );

  // Update badge
  updateBadge(tabId, percent);

  // Persist to storage
  persistState();

  // Check threshold
  if (settings.enabled && percent >= settings.threshold) {
    console.log(`${LOG_PREFIX} ⚠️ Threshold reached (${percent}% >= ${settings.threshold}%)! Triggering handoff...`);
    triggerAutoHandoff(tabId, state);
  }
}

// ═══════════════════════════════════════════════
// State Query Handler
// ═══════════════════════════════════════════════

async function handleGetState(message, sendResponse) {
  const tabId = message.tabId;

  if (tabId && conversationState.has(tabId)) {
    sendResponse({ state: conversationState.get(tabId) });
  } else if (tabId) {
    // Try to detect site from URL
    try {
      const tab = await chrome.tabs.get(tabId);
      const site = AIModelLimits.detectModel(tab.url);
      sendResponse({
        state: {
          tabId,
          site,
          url: tab.url,
          tokenCount: 0,
          messageCount: 0,
          percent: 0,
          limit: site ? AIModelLimits.getLimit(site, settings.customLimits) : 0,
          modelInfo: site ? AIModelLimits.getModel(site) : null,
          messages: [],
          lastUpdated: Date.now()
        }
      });
    } catch (e) {
      sendResponse({ state: null, error: e.message });
    }
  } else {
    sendResponse({ state: null });
  }
}

// ═══════════════════════════════════════════════
// Manual Switch Handler
// ═══════════════════════════════════════════════

async function handleManualSwitch(message, sourceTab) {
  const { targetModel } = message;
  const tabId = sourceTab?.id || message.tabId;

  console.log(`${LOG_PREFIX} Manual switch requested to ${targetModel} from tab ${tabId}`);

  const state = conversationState.get(tabId);
  if (!state || !state.messages || state.messages.length === 0) {
    console.warn(`${LOG_PREFIX} No conversation data for tab ${tabId}`);
    return;
  }

  await executeHandoff(state, targetModel);
}

// ═══════════════════════════════════════════════
// Auto Handoff
// ═══════════════════════════════════════════════

/**
 * Track which tabs have already triggered auto-handoff
 * to prevent repeated triggers.
 */
const handoffTriggered = new Set();

async function triggerAutoHandoff(tabId, state) {
  // Prevent duplicate triggers
  if (handoffTriggered.has(tabId)) {
    console.log(`${LOG_PREFIX} Handoff already triggered for tab ${tabId}, skipping`);
    return;
  }
  handoffTriggered.add(tabId);

  const nextModelId = AIHandoff.getNextModel(state.site, settings.modelOrder);
  console.log(`${LOG_PREFIX} Auto-handoff: ${state.site} → ${nextModelId}`);

  await executeHandoff(state, nextModelId);
}

// ═══════════════════════════════════════════════
// Handoff Execution
// ═══════════════════════════════════════════════

async function executeHandoff(state, targetModelId) {
  const targetModel = AIModelLimits.getModel(targetModelId);
  if (!targetModel) {
    console.error(`${LOG_PREFIX} Unknown target model: ${targetModelId}`);
    return;
  }

  // Build handoff text
  const handoffText = AIHandoff.buildHandoffText(
    state.messages,
    state.site,
    {
      mode: settings.handoffMode,
      lastN: settings.lastN
    }
  );

  console.log(`${LOG_PREFIX} Opening ${targetModel.name} at ${targetModel.url}...`);

  try {
    // Open new tab with the target model
    const newTab = await chrome.tabs.create({
      url: targetModel.url,
      active: true
    });

    console.log(`${LOG_PREFIX} New tab created: ${newTab.id}`);

    // Wait for the page to load, then inject the text
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === newTab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);

        // Wait a bit for the SPA to render
        setTimeout(async () => {
          try {
            await chrome.tabs.sendMessage(newTab.id, {
              type: 'INJECT_HANDOFF_TEXT',
              text: handoffText,
              autoSubmit: settings.autoSubmit
            });
            console.log(`${LOG_PREFIX} ✓ Handoff text injected into ${targetModel.name}`);
          } catch (e) {
            console.warn(`${LOG_PREFIX} Content script not ready, retrying...`);
            // Retry after another delay
            setTimeout(async () => {
              try {
                await chrome.tabs.sendMessage(newTab.id, {
                  type: 'INJECT_HANDOFF_TEXT',
                  text: handoffText,
                  autoSubmit: settings.autoSubmit
                });
                console.log(`${LOG_PREFIX} ✓ Handoff text injected on retry`);
              } catch (e2) {
                console.error(`${LOG_PREFIX} Failed to inject handoff text:`, e2);
              }
            }, 3000);
          }
        }, 2500);
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    // Safety timeout to remove listener
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
    }, 30000);

  } catch (error) {
    console.error(`${LOG_PREFIX} Handoff execution failed:`, error);
  }
}

// ═══════════════════════════════════════════════
// Badge Management
// ═══════════════════════════════════════════════

function updateBadge(tabId, percent) {
  // Color coding
  let color;
  if (percent < 60) {
    color = '#22C55E';      // Green
  } else if (percent < 85) {
    color = '#F59E0B';      // Yellow/Amber
  } else {
    color = '#EF4444';      // Red
  }

  const text = percent > 0 ? `${percent}%` : '';

  try {
    chrome.action.setBadgeText({ text, tabId });
    chrome.action.setBadgeBackgroundColor({ color, tabId });
    chrome.action.setBadgeTextColor({ color: '#FFFFFF', tabId });
  } catch (e) {
    // Badge API may not be available in all contexts
    console.warn(`${LOG_PREFIX} Badge update failed:`, e.message);
  }
}

// ═══════════════════════════════════════════════
// Settings Management
// ═══════════════════════════════════════════════

function handleUpdateSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  chrome.storage.local.set({ settings });
  console.log(`${LOG_PREFIX} Settings updated:`, settings);

  // Clear handoff triggers when settings change
  handoffTriggered.clear();
}

// ═══════════════════════════════════════════════
// Persistence
// ═══════════════════════════════════════════════

let persistTimer = null;

function persistState() {
  // Debounce persistence
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const statesObj = {};
    for (const [tabId, state] of conversationState) {
      // Don't persist full messages to storage (too large)
      statesObj[tabId] = {
        ...state,
        messages: [] // Clear messages for storage — they'll be re-extracted
      };
    }
    chrome.storage.local.set({ conversationStates: statesObj });
  }, 2000);
}

// ═══════════════════════════════════════════════
// Tab Cleanup
// ═══════════════════════════════════════════════

chrome.tabs.onRemoved.addListener((tabId) => {
  if (conversationState.has(tabId)) {
    console.log(`${LOG_PREFIX} Tab ${tabId} closed, cleaning up state`);
    conversationState.delete(tabId);
    handoffTriggered.delete(tabId);
    persistState();
  }
});

// Also watch for URL changes (new conversation on same tab)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && conversationState.has(tabId)) {
    const currentSite = conversationState.get(tabId).site;
    const newSite = AIModelLimits.detectModel(changeInfo.url);

    // If the site changed or URL significantly changed, reset state
    if (currentSite !== newSite) {
      console.log(`${LOG_PREFIX} Tab ${tabId} navigated away from ${currentSite}`);
      conversationState.delete(tabId);
      handoffTriggered.delete(tabId);
      updateBadge(tabId, 0);
      persistState();
    }
  }
});

console.log(`${LOG_PREFIX} ✓ Service worker initialized`);
