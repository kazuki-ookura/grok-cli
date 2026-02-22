# 🚀 Grok CLI (The Maintenance Fork)

> **"The original repo was broken. I needed it. So I fixed it." — Kazuki Okura**

[![NPM Version](https://img.shields.io/npm/v/@kazuki-ookura/grok-cli.svg)](https://www.npmjs.com/package/@kazuki-ookura/grok-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This is the **community-led, high-performance maintenance fork** of the original Grok CLI. Since the upstream repository (`superagent-ai/grok-cli`) is no longer maintained and failed to work with the latest xAI API changes, I have completely overhauled it to support the **modern xAI Responses API**.

## 🌟 Why this fork?

- **✅ Fixed & Alive**: The original OpenAI SDK-based implementation is broken for latest models. This fork uses the latest `/v1/responses` API.
- **🔍 Native Search**: First-class support for `web_search` and `x_search` tools.
- **🧠 Grok-3 & 4-1 Ready**: Optimized for the latest `grok-4-1-fast-reasoning` and `grok-3` models.
- **⚡ Performance**: Lightweight implementation with axios for maximum reliability.

---

## 🚀 Quick Start

### Global Installation
Install the fixed version directly from my personal NPM scope:

```bash
# Using Bun (Recommended)
bun add -g @kazuki-ookura/grok-cli

# Using NPM
npm install -g @kazuki-ookura/grok-cli
```

### Installation from Source (for Developers)
If you want to contribute or use the latest source code:

```bash
git clone https://github.com/kazuki-ookura/grok-cli.git
cd grok-cli
bun install
bun run build
bun link # To use 'grok' command globally from source
```

### Usage
```bash
# Start interactive mode
grok

# Single prompt (Headless mode)
grok -p "Explain quantum computing in one sentence"
```

---

## ✨ Features

- **🤖 Conversational AI**: Natural language interface powered by the latest Grok models.
- **🔍 Intelligent Search**: Uses xAI's native web and X (Twitter) search capabilities.
- **📝 Smart File Operations**: AI automatically views, creates, and edits files.
- **⚡ Bash Integration**: Execute shell commands through natural conversation.
- **🚀 Morph Fast Apply**: Optional high-speed code editing at 4,500+ tokens/sec.
- **🔌 MCP Tools**: Full Model Context Protocol support (Linear, GitHub, etc.).

---

## 🛠 Setup

1. Get your API key from [x.ai](https://x.ai).
2. Set it up:
   ```bash
   export GROK_API_KEY=your_key_here
   ```

---

## 📈 Status & Future

The original project at `superagent-ai/grok-cli` appears to be abandoned. I've taken the initiative to keep this project alive because it's a fantastic tool for developers. Expect regular updates as the Grok API evolves.

**Join the movement: If you find this useful, leave a star on GitHub!**

---

## 📄 License

MIT License - Feel free to use, modify, and distribute.

Developed and maintained with ❤️ by [Kazuki Okura](https://github.com/kazuki-ookura).
