# pi-9router

A [pi](https://pi.dev) coding-agent extension that registers [9router](https://github.com/decolua/9router) — an OpenAI-compatible AI routing proxy — as a native provider with dynamic model discovery.

Built entirely on pi's native provider primitives: no custom commands, tools, or config files.

## Features

- **Native provider** via `createProvider` — uses pi's own OpenAI Chat Completions streaming
- **Dynamic model discovery** via `GET /v1/models`, persisted in pi's `models-store.json` and restored when offline
- **Built-in `/login 9router`** for the API key (stored in `~/.pi/agent/auth.json`)
- **`models.json` `modelOverrides`** are honored (reasoning, input types, context window, etc.)

## Install

```bash
# From git
pi install git:github.com/<you>/pi-9router@v1

# From npm
pi install npm:pi-9router

# Local / development
git clone https://github.com/<you>/pi-9router
pi install /path/to/pi-9router
```

## Configure

### Endpoint

Add your 9router base URL to `~/.pi/agent/models.json`:

```json
{
  "providers": {
    "9router": {
      "baseUrl": "http://your-router:20128/v1"
    }
  }
}
```

Defaults to `http://localhost:20128/v1` when unset. Include the `/v1` suffix (a bare `host:port` is auto-normalized).

### API key

Pick one:

1. `/login 9router` — interactive secret prompt (recommended)
2. `export NINE_ROUTER_API_KEY=...` — for scripts/CI
3. `"apiKey": "$NINE_ROUTER_API_KEY"` in `models.json` (pi-native interpolation)

### Optional: model overrides

9router's `/v1/models` does not reliably expose per-model reasoning/image capabilities. Set them per model in `models.json`:

```json
{
  "providers": {
    "9router": {
      "baseUrl": "http://your-router:20128/v1",
      "modelOverrides": {
        "erica-medium": {
          "reasoning": true,
          "input": ["text", "image"],
          "contextWindow": 1000000,
          "maxTokens": 65536
        }
      }
    }
  }
}
```

## Usage

- Models are discovered automatically at interactive startup, after `/login 9router`, and in RPC mode
- Select a model: `/model 9router/<model-id>`
- Requests go through 9router's OpenAI-compatible `/v1/chat/completions`

## License

MIT
