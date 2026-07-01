/**
 * AI Token Tracker & Switcher — Options Page Script
 * 
 * Loads/saves settings from chrome.storage.local,
 * handles model order reordering, and provides validation.
 */

(() => {
  'use strict';

  const LOG_PREFIX = '[AI-Tracker][Options]';

  // ═══════════════════════════════════════════════
  // Defaults
  // ═══════════════════════════════════════════════

  const DEFAULTS = {
    threshold: 90,
    modelOrder: ['claude', 'chatgpt', 'gemini'],
    autoSubmit: false,
    handoffMode: 'full',
    lastN: 10,
    customLimits: {
      claude: 200000,
      chatgpt: 128000,
      gemini: 1000000
    },
    enabled: true,
    claudeApiKey: '',
    claudeUsageMode: 'estimated',
    placeholderCacheTtl: 300
  };

  const MODEL_INFO = {
    claude: { name: 'Claude', icon: '🟣', color: '#D97706' },
    chatgpt: { name: 'ChatGPT', icon: '🟢', color: '#10A37F' },
    gemini: { name: 'Gemini', icon: '🔵', color: '#4285F4' }
  };

  let currentSettings = { ...DEFAULTS };

  // ═══════════════════════════════════════════════
  // DOM Elements
  // ═══════════════════════════════════════════════

  const els = {
    limitClaude: document.getElementById('limit-claude'),
    limitChatgpt: document.getElementById('limit-chatgpt'),
    limitGemini: document.getElementById('limit-gemini'),
    threshold: document.getElementById('threshold'),
    thresholdDisplay: document.getElementById('threshold-display'),
    modelOrderList: document.getElementById('model-order-list'),
    modeFull: document.getElementById('mode-full'),
    modeLastN: document.getElementById('mode-lastN'),
    lastNValue: document.getElementById('lastN-value'),
    autoSubmit: document.getElementById('auto-submit'),
    claudeUsageMode: document.getElementById('claude-usage-mode'),
    claudeApiKey: document.getElementById('claude-api-key'),
    apiKeyGroup: document.getElementById('api-key-group'),
    cacheTtl: document.getElementById('cache-ttl'),
    saveBtn: document.getElementById('save-btn'),
    resetBtn: document.getElementById('reset-btn'),
    toast: document.getElementById('toast'),
  };

  // ═══════════════════════════════════════════════
  // Initialization
  // ═══════════════════════════════════════════════

  async function init() {
    console.log(`${LOG_PREFIX} Options page loaded`);

    // Load settings
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (response?.settings) {
        currentSettings = { ...DEFAULTS, ...response.settings };
      }
    } catch (e) {
      console.warn(`${LOG_PREFIX} Could not load settings, using defaults:`, e);
    }

    // Populate UI
    populateUI();

    // Setup listeners
    setupListeners();
  }

  function populateUI() {
    // Model limits
    els.limitClaude.value = currentSettings.customLimits?.claude || DEFAULTS.customLimits.claude;
    els.limitChatgpt.value = currentSettings.customLimits?.chatgpt || DEFAULTS.customLimits.chatgpt;
    els.limitGemini.value = currentSettings.customLimits?.gemini || DEFAULTS.customLimits.gemini;

    // Threshold
    els.threshold.value = currentSettings.threshold;
    els.thresholdDisplay.textContent = `${currentSettings.threshold}%`;

    // Model order
    renderModelOrder(currentSettings.modelOrder || DEFAULTS.modelOrder);

    // Handoff mode
    if (currentSettings.handoffMode === 'lastN') {
      els.modeLastN.checked = true;
      els.lastNValue.disabled = false;
    } else {
      els.modeFull.checked = true;
      els.lastNValue.disabled = true;
    }
    els.lastNValue.value = currentSettings.lastN || DEFAULTS.lastN;

    // Auto-submit
    els.autoSubmit.checked = currentSettings.autoSubmit || false;

    // Claude API settings
    els.claudeUsageMode.value = currentSettings.claudeUsageMode || DEFAULTS.claudeUsageMode;
    els.claudeApiKey.value = currentSettings.claudeApiKey || '';
    
    // Toggle api key visibility
    if (els.claudeUsageMode.value === 'api') {
      els.apiKeyGroup.style.display = 'block';
    } else {
      els.apiKeyGroup.style.display = 'none';
    }

    // Cache TTL
    els.cacheTtl.value = (currentSettings.placeholderCacheTtl || DEFAULTS.placeholderCacheTtl) / 60;
  }

  // ═══════════════════════════════════════════════
  // Event Listeners
  // ═══════════════════════════════════════════════

  function setupListeners() {
    // Threshold slider
    els.threshold.addEventListener('input', (e) => {
      els.thresholdDisplay.textContent = `${e.target.value}%`;
    });

    // Handoff mode radio
    els.modeFull.addEventListener('change', () => {
      els.lastNValue.disabled = true;
    });

    els.modeLastN.addEventListener('change', () => {
      els.lastNValue.disabled = false;
      els.lastNValue.focus();
    });

    // Toggle API Key input display on Claude Usage Mode change
    els.claudeUsageMode.addEventListener('change', () => {
      if (els.claudeUsageMode.value === 'api') {
        els.apiKeyGroup.style.display = 'block';
        els.claudeApiKey.focus();
      } else {
        els.apiKeyGroup.style.display = 'none';
      }
    });

    // Save
    els.saveBtn.addEventListener('click', saveSettings);

    // Reset
    els.resetBtn.addEventListener('click', resetToDefaults);
  }

  // ═══════════════════════════════════════════════
  // Model Order Rendering
  // ═══════════════════════════════════════════════

  function renderModelOrder(order) {
    els.modelOrderList.innerHTML = '';

    order.forEach((modelId, index) => {
      const model = MODEL_INFO[modelId];
      if (!model) return;

      const item = document.createElement('div');
      item.className = 'order-item';
      item.dataset.modelId = modelId;

      item.innerHTML = `
        <span class="order-num">${index + 1}</span>
        <span class="model-dot" style="background:${model.color}; width:10px; height:10px; border-radius:50%; flex-shrink:0;"></span>
        <span class="order-name">${model.icon} ${model.name}</span>
        <div class="order-btns">
          <button class="order-btn move-up" ${index === 0 ? 'disabled' : ''} title="Move up">↑</button>
          <button class="order-btn move-down" ${index === order.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
        </div>
      `;

      // Move up
      item.querySelector('.move-up').addEventListener('click', () => {
        if (index > 0) {
          const newOrder = getCurrentOrder();
          [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
          renderModelOrder(newOrder);
        }
      });

      // Move down
      item.querySelector('.move-down').addEventListener('click', () => {
        const currentOrder = getCurrentOrder();
        if (index < currentOrder.length - 1) {
          [currentOrder[index], currentOrder[index + 1]] = [currentOrder[index + 1], currentOrder[index]];
          renderModelOrder(currentOrder);
        }
      });

      els.modelOrderList.appendChild(item);
    });
  }

  function getCurrentOrder() {
    const items = els.modelOrderList.querySelectorAll('.order-item');
    return Array.from(items).map(item => item.dataset.modelId);
  }

  // ═══════════════════════════════════════════════
  // Save Settings
  // ═══════════════════════════════════════════════

  async function saveSettings() {
    // Validate
    const limitClaude = parseInt(els.limitClaude.value);
    const limitChatgpt = parseInt(els.limitChatgpt.value);
    const limitGemini = parseInt(els.limitGemini.value);
    const threshold = parseInt(els.threshold.value);
    const lastN = parseInt(els.lastNValue.value);
    const cacheTtl = parseInt(els.cacheTtl.value);

    if (isNaN(limitClaude) || limitClaude < 1000) {
      showToast('Claude limit must be at least 1,000 tokens.', true);
      return;
    }
    if (isNaN(limitChatgpt) || limitChatgpt < 1000) {
      showToast('ChatGPT limit must be at least 1,000 tokens.', true);
      return;
    }
    if (isNaN(limitGemini) || limitGemini < 1000) {
      showToast('Gemini limit must be at least 1,000 tokens.', true);
      return;
    }
    if (threshold < 50 || threshold > 99) {
      showToast('Threshold must be between 50% and 99%.', true);
      return;
    }
    if (els.modeLastN.checked && (isNaN(lastN) || lastN < 2)) {
      showToast('Last N must be at least 2 messages.', true);
      return;
    }
    if (isNaN(cacheTtl) || cacheTtl < 1 || cacheTtl > 1440) {
      showToast('Cache TTL must be between 1 and 1440 minutes (24 hours).', true);
      return;
    }

    const newSettings = {
      threshold,
      modelOrder: getCurrentOrder(),
      autoSubmit: els.autoSubmit.checked,
      handoffMode: els.modeLastN.checked ? 'lastN' : 'full',
      lastN,
      customLimits: {
        claude: limitClaude,
        chatgpt: limitChatgpt,
        gemini: limitGemini
      },
      enabled: true,
      claudeUsageMode: els.claudeUsageMode.value,
      claudeApiKey: els.claudeApiKey.value.trim(),
      placeholderCacheTtl: cacheTtl * 60
    };

    console.log(`${LOG_PREFIX} Saving settings:`, newSettings);

    try {
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        settings: newSettings
      });
      currentSettings = newSettings;
      showToast('Settings saved successfully!');
    } catch (e) {
      console.error(`${LOG_PREFIX} Save error:`, e);
      showToast('Failed to save settings.', true);
    }
  }

  // ═══════════════════════════════════════════════
  // Reset Defaults
  // ═══════════════════════════════════════════════

  function resetToDefaults() {
    currentSettings = { ...DEFAULTS };
    populateUI();
    showToast('Reset to defaults. Click Save to apply.');
  }

  // ═══════════════════════════════════════════════
  // Toast Notification
  // ═══════════════════════════════════════════════

  function showToast(message, isError = false) {
    els.toast.textContent = message;
    els.toast.className = `toast show ${isError ? 'error' : ''}`;

    setTimeout(() => {
      els.toast.className = 'toast';
    }, 3000);
  }

  // Start
  init();
})();
