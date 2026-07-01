# AI Token Tracker & Switcher

A Chrome Extension (Manifest V3) that tracks token usage across **Claude**, **ChatGPT**, and **Gemini** conversations. When a conversation nears the model's context limit, it automatically extracts the full conversation, opens the next model in a new tab, injects the context, and lets you continue seamlessly.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-8B5CF6)
![License](https://img.shields.io/badge/License-MIT-22C55E)

## Features

- 🔢 **Live Token Counting** — Real-time token estimation for every conversation
- 🔄 **Auto-Switch** — Automatically transfers context when nearing the limit
- 📊 **Visual Progress Ring** — Beautiful circular progress showing % of context used
- 🎯 **Manual Switch** — One-click handoff to any supported model
- ⚙️ **Configurable** — Edit limits, threshold %, model order, and handoff mode
- 🎨 **Premium Dark UI** — Glassmorphism popup with smooth animations
- 💾 **Persistent State** — Survives tab reloads via chrome.storage.local
- ⏱️ **Active Cache Timer** — Live countdown in the popup for prompt caching (Claude's 5-minute Prompt Cache TTL, plus configurable placeholders for ChatGPT/Gemini).
- 📊 **Rolling Usage Bars** — Tracks session (5-hour) and weekly (7-day) token consumption locally. Supports real-time API key integration for Claude developer limits!
- 🔍 **Debug Logging** — Console logs prefixed with `[AI-Tracker]` for easy filtering

## Supported Models

| Model | Provider | Default Context Window | URL |
|-------|----------|----------------------|-----|
| 🟣 Claude | Anthropic | 200,000 tokens | claude.ai |
| 🟢 ChatGPT | OpenAI | 128,000 tokens | chatgpt.com |
| 🔵 Gemini | Google | 1,000,000 tokens | gemini.google.com |

## Installation

1. **Clone or download** this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `ai-token-tracker-extension` folder
6. The extension icon should appear in your toolbar

## Architecture

```
ai-token-tracker-extension/
├── manifest.json                    # MV3 manifest
├── background/
│   └── service-worker.js            # State management, handoff orchestration
├── content-scripts/
│   ├── claude.js                    # Claude.ai DOM observer & extractor
│   ├── chatgpt.js                   # ChatGPT DOM observer & extractor
│   ├── gemini.js                    # Gemini DOM observer & extractor
│   └── common/
│       ├── dom-observer.js          # Reusable MutationObserver factory
│       └── extract-text.js          # Generic message extraction utility
├── lib/
│   ├── tokenizer.js                 # Character-based token estimator
│   ├── model-limits.js              # Model config (limits, URLs, etc.)
│   ├── handoff.js                   # Conversation transfer builder
│   └── usage-tracker.js             # Log rolling usage & Anthropic limits API
├── popup/
│   ├── popup.html                   # Extension popup UI
│   ├── popup.css                    # Dark glassmorphism styles
│   └── popup.js                     # Popup logic & live updates
├── options/
│   ├── options.html                 # Full-page settings
│   └── options.js                   # Settings load/save
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

### Data Flow

```
Content Script (per site)
  │  MutationObserver watches chat container
  │  Extracts messages (role + content)
  │  Estimates token count
  ▼
chrome.runtime.sendMessage({ type: 'CONVERSATION_UPDATE', ... })
  │
  ▼
Service Worker (background)
  │  Maintains per-tab state
  │  Computes % of limit used
  │  Updates badge color (green → yellow → red)
  │  Persists to chrome.storage.local
  │
  ├─── If % ≥ threshold ──→ Trigger auto-handoff
  │                           │  Build condensed text
  │                           │  Open target model tab
  │                           │  Inject text into input
  │
  └─── On popup request ──→ Send state to popup UI
```

## Configuration

### Options Page

Access via the extension popup (gear icon) or right-click → Options:

- **Model Context Limits** — Adjust the token limit per model
- **Switch Threshold** — Set the % at which auto-switch triggers (50–99%)
- **Model Rotation Order** — Reorder with up/down buttons
- **Handoff Mode** — Full transcript or last N messages
- **Auto-Submit** — Toggle automatic submission after injection

### Default Settings

| Setting | Default |
|---------|---------|
| Threshold | 90% |
| Rotation | Claude → ChatGPT → Gemini |
| Auto-Submit | Off |
| Handoff Mode | Full transcript |

## Token Counting

This extension uses a **character-based heuristic** for token estimation:

```
tokens ≈ characters / 4
```

This is based on OpenAI's rule of thumb that ~4 characters ≈ 1 token for English text. Each message also adds ~4 tokens of overhead for role markers and delimiters.

**Why not exact tokenization?** Exact BPE tokenization (via `gpt-tokenizer` or `tiktoken`) requires either a build pipeline (webpack/rollup) or loading a ~2MB WASM file. The heuristic approach keeps the extension lightweight and dependency-free.

## Debugging

All console logs are prefixed for easy filtering:

```
[AI-Tracker][Claude]     — Claude content script
[AI-Tracker][ChatGPT]    — ChatGPT content script
[AI-Tracker][Gemini]     — Gemini content script
[AI-Tracker][Observer]   — DOM observer events
[AI-Tracker][Extract]    — Message extraction
[AI-Tracker][Tokenizer]  — Token counting
[AI-Tracker][SW]         — Service worker / background
[AI-Tracker][Handoff]    — Handoff operations
[AI-Tracker][Popup]      — Popup UI
[AI-Tracker][Options]    — Options page
```

**To view content script logs:** Open DevTools on the AI site page (F12) → Console  
**To view service worker logs:** Go to `chrome://extensions` → click "Service Worker" link

## Known Limitations

1. **DOM Selectors May Break** — All three sites use obfuscated, frequently-changing class names. The extension uses multi-strategy fallback selectors but may need updates when sites redesign.

2. **Token Estimation is Approximate** — The ~4 chars/token heuristic is ±10–20% accurate for English text. Non-English text or code may have different ratios.

3. **Handoff Text May Be Long** — Full transcript mode can produce very large inputs. Use "Last N Messages" mode if the target model has a smaller context window.

4. **Auto-Submit Requires Caution** — The auto-submit feature interacts with dynamic UI elements that may change. Disabled by default for safety.

5. **Shadow DOM on Gemini** — Gemini uses web components with shadow roots. The extension includes shadow DOM piercing but coverage may vary.

## Contributing

1. Fork this repository
2. Create a feature branch
3. Test on all three AI sites
4. Submit a pull request

## License

MIT License — see [LICENSE](LICENSE) for details.
