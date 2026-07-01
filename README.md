# AI Token Tracker & Switcher 🚀

A Chrome Extension (Manifest V3) that tracks token usage across **Claude**, **ChatGPT**, and **Gemini** conversations. When your chat nears a model's context limit, the extension automatically extracts the conversation, opens the next configured model in a new tab, injects the context, and lets you continue your conversation seamlessly.

Additionally, it injects a **live on-page token widget** directly below the chat input box so you can monitor your context usage at a glance without opening the extension popup!

---

## 🌟 Features

- 📊 **Real-Time On-Page Widget** — Live token counts directly below the input box on Claude, ChatGPT, and Gemini.
- 🎨 **Adaptive Styling** — Widget automatically adapts to both **Dark Mode** and **Light Mode** by inheriting the parent site's fonts and colors.
- 🔄 **Smart Auto-Handoff** — Automatically opens the next model in a new tab and transfers context when usage reaches your set threshold (e.g., 90%).
- 🟢🟡🔴 **Color-Coded Badges** — Visual indicators change colors (Green/Yellow/Red) based on usage intensity.
- ⚙️ **Fully Customizable Options** — Change context limits, threshold percentage, target model rotation order, and handoff modes (Full Transcript vs. Last N Messages).
- 💾 **Persistent Session Memory** — Keeps track of conversation progress even if the tab is reloaded or the browser service worker restarts.

---

## 📂 Project Structure

This repository is structured with the main Chrome extension located in the `ai-token-tracker-extension` subfolder:

```
Ai-token-tracker-extension/ (Repository Root)
├── ai-token-tracker-extension/      # ◄ SELECT THIS FOLDER IN CHROME
│    ├── manifest.json                # MV3 configuration
│    ├── background/                  # Background worker (state, tabs, handoffs)
│    │    └── service-worker.js
│    ├── content-scripts/             # DOM Scraping & Widget Injection
│    │    ├── claude.js
│    │    ├── chatgpt.js
│    │    ├── gemini.js
│    │    └── common/
│    │         ├── dom-observer.js    # Resilient MutationObserver
│    │         └── extract-text.js    # Text parser & on-page UI widget
│    ├── lib/                         # Core libraries
│    │    ├── tokenizer.js            # Heuristic token counting (~4 chars/token)
│    │    ├── model-limits.js         # Limits configuration
│    │    └── handoff.js              # Prompt generator
│    ├── popup/                       # Browser action popup UI
│    │    ├── popup.html
│    │    ├── popup.css
│    │    └── popup.js
│    ├── options/                     # Extension settings page
│    │    ├── options.html
│    │    └── options.js
│    └── icons/                       # Brand assets & logos
├── .gitignore                        # Git exclusion rules
└── README.md                         # This file
```

---

## 🛠️ Step-by-Step Installation Guide

To load and use this extension in your browser:

### 1. Download the Code
- **Option A (Git)**: Clone the repository to your computer:
  ```bash
  git clone https://github.com/bhupendrasharmaX/Ai-token-tracker-extension.git
  ```
- **Option B (ZIP)**: Click the green **Code** button at the top right of this GitHub page, select **Download ZIP**, and extract it on your computer.

### 2. Install in Google Chrome (or any Chromium browser)
1. Open Google Chrome.
2. Navigate to the extensions page by typing **`chrome://extensions/`** in the URL bar.
3. In the top-right corner, toggle the **Developer mode** switch to **ON**.
4. Click the **Load unpacked** button in the top-left corner.
5. In the file picker, select the **`ai-token-tracker-extension`** subfolder (the folder that contains the `manifest.json` file inside the downloaded/cloned directory).
6. Click **Select Folder**.

### 3. Pin the Extension
1. Click the **puzzle piece icon** (Extensions) on the top-right toolbar of Chrome.
2. Click the **Pin (thumbtack icon)** next to **AI Token Tracker & Switcher** to keep it visible on your browser bar.

---

## 📖 How to Use

1. **Open a Chat**: Navigate to [Claude](https://claude.ai), [ChatGPT](https://chatgpt.com), or [Gemini](https://gemini.google.com/app).
2. **Start Typing**: As you interact, you will see a clean borderless widget appear **directly below the chat input box** showing your current token usage.
3. **Open Popup**: Click the extension icon in your toolbar to see a beautiful visual progress ring and stats grid.
4. **Configure Settings**: Click the **Gear icon** in the top-right of the popup to access settings where you can:
   - Edit token limits for each model.
   - Adjust the auto-switch threshold percentage.
   - Rearrange the rotation order of models.
   - Enable **Auto-Submit** to submit prompts immediately after handoff injection.

---

## 💡 Tech & Token Counting
This extension uses a **character-based heuristic** to estimate token counts locally in the browser (`1 token ≈ 4 characters` for English text). This makes the extension incredibly lightweight and fast with zero dependencies or external network API calls.

## 📝 License
This project is licensed under the MIT License.
