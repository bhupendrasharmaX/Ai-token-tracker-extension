/**
 * AI Token Tracker & Switcher — Popup Script
 * 
 * Queries the active tab, fetches conversation state from the
 * service worker, and updates the popup UI with live data.
 */

(() => {
  'use strict';

  const LOG_PREFIX = '[AI-Tracker][Popup]';

  // ═══════════════════════════════════════════════
  // DOM Elements
  // ═══════════════════════════════════════════════

  const els = {
    noSitePanel: document.getElementById('no-site-panel'),
    statusPanel: document.getElementById('status-panel'),
    switchPanel: document.getElementById('switch-panel'),
    // Site badge
    siteBadge: document.getElementById('site-badge'),
    siteIcon: document.getElementById('site-icon'),
    siteName: document.getElementById('site-name'),
    siteStatus: document.getElementById('site-status'),
    // Progress
    progressFill: document.getElementById('progress-fill'),
    progressPercent: document.getElementById('progress-percent'),
    gradStop1: document.getElementById('grad-stop-1'),
    gradStop2: document.getElementById('grad-stop-2'),
    // Stats
    tokenCount: document.getElementById('token-count'),
    tokenLimit: document.getElementById('token-limit'),
    msgCount: document.getElementById('msg-count'),
    thresholdVal: document.getElementById('threshold-val'),
    // Switch
    targetModel: document.getElementById('target-model'),
    switchBtn: document.getElementById('switch-btn'),
    switchHint: document.getElementById('switch-hint'),
    // Navigation
    settingsBtn: document.getElementById('settings-btn'),
    optionsLink: document.getElementById('options-link'),
  };

  // Model config (should match model-limits.js)
  const MODELS = {
    claude: { name: 'Claude', icon: '🟣', color: '#D97706', contextWindow: 200000 },
    chatgpt: { name: 'ChatGPT', icon: '🟢', color: '#10A37F', contextWindow: 128000 },
    gemini: { name: 'Gemini', icon: '🔵', color: '#4285F4', contextWindow: 1000000 }
  };

  // URL patterns for site detection
  const URL_PATTERNS = {
    claude: ['claude.ai'],
    chatgpt: ['chat.openai.com', 'chatgpt.com'],
    gemini: ['gemini.google.com']
  };

  let currentState = null;
  let currentSite = null;
  let settings = null;
  let pollInterval = null;
  let cacheCountdownInterval = null;

  // ═══════════════════════════════════════════════
  // Initialization
  // ═══════════════════════════════════════════════

  async function init() {
    console.log(`${LOG_PREFIX} Popup opened`);

    // Load settings first
    await loadSettings();

    // Setup event listeners
    setupEventListeners();

    // Get active tab and fetch state
    await refresh();

    // Start polling for live updates
    pollInterval = setInterval(refresh, 2000);
  }

  async function loadSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      settings = response?.settings || { threshold: 90 };
      els.thresholdVal.textContent = `${settings.threshold}%`;
    } catch (e) {
      console.warn(`${LOG_PREFIX} Could not load settings:`, e);
      settings = { threshold: 90 };
    }
  }

  // ═══════════════════════════════════════════════
  // Event Listeners
  // ═══════════════════════════════════════════════

  function setupEventListeners() {
    // Settings button
    els.settingsBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Options link
    els.optionsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });

    // Target model dropdown
    els.targetModel.addEventListener('change', () => {
      els.switchBtn.disabled = !els.targetModel.value;
    });

    // Switch button
    els.switchBtn.addEventListener('click', handleSwitch);
  }

  // ═══════════════════════════════════════════════
  // Data Refresh
  // ═══════════════════════════════════════════════

  async function refresh() {
    try {
      // Get active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) {
        showNoSite();
        return;
      }

      // Detect site from URL
      currentSite = detectSite(tab.url);
      if (!currentSite) {
        showNoSite();
        return;
      }

      // Get state from background
      const response = await chrome.runtime.sendMessage({
        type: 'GET_STATE',
        tabId: tab.id
      });

      currentState = response?.state || null;

      if (currentState) {
        showStatus(currentState);
      } else {
        // Site detected but no conversation data yet
        showStatus({
          site: currentSite,
          tokenCount: 0,
          messageCount: 0,
          percent: 0,
          limit: MODELS[currentSite]?.contextWindow || 0,
          modelInfo: MODELS[currentSite]
        });
      }

    } catch (e) {
      console.warn(`${LOG_PREFIX} Refresh error:`, e);
    }
  }

  // ═══════════════════════════════════════════════
  // Site Detection
  // ═══════════════════════════════════════════════

  function detectSite(url) {
    if (!url) return null;
    for (const [site, patterns] of Object.entries(URL_PATTERNS)) {
      for (const pattern of patterns) {
        if (url.includes(pattern)) return site;
      }
    }
    return null;
  }

  // ═══════════════════════════════════════════════
  // UI Updates
  // ═══════════════════════════════════════════════

  function showNoSite() {
    els.noSitePanel.style.display = 'block';
    els.statusPanel.style.display = 'none';
    els.switchPanel.style.display = 'none';
  }

  function showStatus(state) {
    els.noSitePanel.style.display = 'none';
    els.statusPanel.style.display = 'block';
    els.switchPanel.style.display = 'block';

    const model = MODELS[state.site] || { name: 'Unknown', icon: '❓', contextWindow: 0 };
    const percent = state.percent || 0;
    const tokenCount = state.tokenCount || 0;
    const limit = state.limit || model.contextWindow || 0;
    const msgCount = state.messageCount || 0;

    // Update site badge
    els.siteIcon.textContent = model.icon;
    els.siteName.textContent = model.name;
    els.siteStatus.textContent = tokenCount > 0 ? '● Live' : '● Idle';
    els.siteStatus.className = `site-status ${tokenCount > 0 ? 'live' : 'idle'}`;

    // Update progress ring
    updateProgressRing(percent);

    // Update stats with animation
    animateValue(els.tokenCount, tokenCount);
    animateValue(els.tokenLimit, limit);
    animateValue(els.msgCount, msgCount);

    // Update threshold
    els.thresholdVal.textContent = `${settings?.threshold || 90}%`;

    // Populate target model dropdown (excluding current)
    populateModelDropdown(state.site);

    // Update usage and cache details
    updateUsageAndCacheUI(state.site);
  }

  function updateProgressRing(percent) {
    const circumference = 2 * Math.PI * 60; // r=60
    const offset = circumference - (percent / 100) * circumference;
    els.progressFill.style.strokeDasharray = circumference;
    els.progressFill.style.strokeDashoffset = offset;

    // Update percentage text
    els.progressPercent.textContent = `${percent}%`;

    // Color coding
    let color1, color2, statusClass;
    if (percent < 60) {
      color1 = '#22C55E';
      color2 = '#16A34A';
      statusClass = 'status-green';
    } else if (percent < 85) {
      color1 = '#F59E0B';
      color2 = '#D97706';
      statusClass = 'status-yellow';
    } else {
      color1 = '#EF4444';
      color2 = '#DC2626';
      statusClass = 'status-red';
    }

    els.gradStop1.setAttribute('stop-color', color1);
    els.gradStop2.setAttribute('stop-color', color2);

    // Update progress center color
    const progressCenter = els.progressPercent.parentElement;
    progressCenter.className = `progress-center ${statusClass}`;
  }

  function animateValue(element, newValue) {
    const formatted = typeof newValue === 'number'
      ? newValue.toLocaleString()
      : newValue;

    if (element.textContent !== formatted) {
      element.textContent = formatted;
      element.classList.add('updating');
      setTimeout(() => element.classList.remove('updating'), 300);
    }
  }

  function populateModelDropdown(currentSiteId) {
    const currentValue = els.targetModel.value;
    els.targetModel.innerHTML = '<option value="" disabled selected>Select target model…</option>';

    for (const [id, model] of Object.entries(MODELS)) {
      if (id === currentSiteId) continue;
      const option = document.createElement('option');
      option.value = id;
      option.textContent = `${model.icon} ${model.name} (${(model.contextWindow / 1000).toFixed(0)}K)`;
      els.targetModel.appendChild(option);
    }

    // Restore previous selection if still valid
    if (currentValue && currentValue !== currentSiteId) {
      els.targetModel.value = currentValue;
      els.switchBtn.disabled = false;
    } else {
      els.switchBtn.disabled = true;
    }
  }

  // ═══════════════════════════════════════════════
  // Switch Handler
  // ═══════════════════════════════════════════════

  async function handleSwitch() {
    const targetModelId = els.targetModel.value;
    if (!targetModelId) return;

    console.log(`${LOG_PREFIX} Manual switch to ${targetModelId}`);

    // Visual feedback
    els.switchBtn.disabled = true;
    els.switchBtn.textContent = 'Switching…';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      await chrome.runtime.sendMessage({
        type: 'MANUAL_SWITCH',
        targetModel: targetModelId,
        tabId: tab?.id
      });

      els.switchHint.textContent = `✓ Switching to ${MODELS[targetModelId]?.name}...`;
      els.switchHint.style.color = '#22C55E';

      // Close popup after a short delay
      setTimeout(() => window.close(), 1500);

    } catch (e) {
      console.error(`${LOG_PREFIX} Switch error:`, e);
      els.switchHint.textContent = `✗ Switch failed: ${e.message}`;
      els.switchHint.style.color = '#EF4444';
      els.switchBtn.disabled = false;
      els.switchBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="17 1 21 5 17 9"></polyline>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
          <polyline points="7 23 3 19 7 15"></polyline>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
        </svg>
        Switch Now
        <span class="btn-ripple"></span>
      `;
    }
  }

  // ═══════════════════════════════════════════════
  // Usage and Cache Indicators
  // ═══════════════════════════════════════════════

  async function updateUsageAndCacheUI(modelId) {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_USAGE',
        modelId: modelId
      });

      if (response && response.success) {
        const { stats, cacheRemaining } = response;
        
        // 1. Update Cache Timer Countdown
        clearInterval(cacheCountdownInterval);
        const cacheEl = document.getElementById('cache-indicator');
        const cacheTextEl = document.getElementById('cache-timer-text');
        
        if (cacheRemaining > 0) {
          cacheEl.style.display = 'flex';
          cacheEl.classList.remove('expired');
          
          let secondsLeft = cacheRemaining;
          const updateDisplay = () => {
            if (secondsLeft <= 0) {
              cacheEl.classList.add('expired');
              cacheTextEl.textContent = 'Cache Expired';
              clearInterval(cacheCountdownInterval);
              return;
            }
            const mins = Math.floor(secondsLeft / 60);
            const secs = secondsLeft % 60;
            cacheTextEl.textContent = `Cache Status: Active (${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')})`;
            secondsLeft--;
          };
          updateDisplay();
          cacheCountdownInterval = setInterval(updateDisplay, 1000);
        } else {
          cacheEl.style.display = 'flex';
          cacheEl.classList.add('expired');
          cacheTextEl.textContent = 'Not Cached';
        }

        // 2. Update Usage Progress Bars & Reset Countdowns
        const sessionFill = document.getElementById('session-usage-fill');
        const sessionReset = document.getElementById('session-reset-display');
        const sessionTokens = document.getElementById('session-tokens-display');
        const sessionPct = document.getElementById('session-pct-display');
        
        const weeklyFill = document.getElementById('weekly-usage-fill');
        const weeklyReset = document.getElementById('weekly-reset-display');
        const weeklyTokens = document.getElementById('weekly-tokens-display');
        const weeklyPct = document.getElementById('weekly-pct-display');

        // Session
        const sTokens = stats.sessionTokens || 0;
        const sLimit = stats.sessionLimit || 1;
        const sPct = Math.min(100, Math.round((sTokens / sLimit) * 100));
        
        sessionFill.style.width = `${sPct}%`;
        sessionPct.textContent = `${sPct}%`;
        sessionTokens.textContent = `${sTokens.toLocaleString()} / ${sLimit.toLocaleString()} tokens${stats.apiActive ? ' (API)' : ''}`;
        
        if (stats.sessionResetTime > 0) {
          sessionReset.textContent = `resets in ${formatTimeMs(stats.sessionResetTime)}`;
        } else {
          sessionReset.textContent = 'resets in 0s';
        }

        // Weekly
        const wTokens = stats.weeklyTokens || 0;
        const wLimit = stats.weeklyLimit || 1;
        const wPct = Math.min(100, Math.round((wTokens / wLimit) * 100));
        
        weeklyFill.style.width = `${wPct}%`;
        weeklyPct.textContent = `${wPct}%`;
        weeklyTokens.textContent = `${wTokens.toLocaleString()} / ${wLimit.toLocaleString()} tokens`;
        
        if (stats.weeklyResetTime > 0) {
          weeklyReset.textContent = `resets in ${formatTimeMs(stats.weeklyResetTime)}`;
        } else {
          weeklyReset.textContent = 'resets in 0s';
        }
      }
    } catch (err) {
      console.warn(`${LOG_PREFIX} Error loading usage stats:`, err);
    }
  }

  function formatTimeMs(ms) {
    const totalSecs = Math.floor(ms / 1000);
    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remHours = hours % 24;
      return `${days}d ${remHours}h`;
    }
    
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  }

  // ═══════════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════════

  window.addEventListener('unload', () => {
    if (pollInterval) clearInterval(pollInterval);
    if (cacheCountdownInterval) clearInterval(cacheCountdownInterval);
  });

  // Start
  init();
})();
