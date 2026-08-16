/**
 * pi-9router — native 9router provider for pi
 *
 * Registers 9router (an OpenAI-compatible routing proxy) as a native provider
 * using pi's built-in provider primitives only:
 *
 *   - auth.apiKey  -> /login 9router (interactive secret prompt, stored in auth.json)
 *   - fetchModels   -> dynamic discovery via GET {baseUrl}/models, persisted in
 *                      pi's models-store.json and restored when offline
 *   - openAICompletionsApi -> standard OpenAI Chat Completions streaming
 *
 * Endpoint configuration lives in pi's own models.json:
 *
 *   ~/.pi/agent/models.json
 *   {
 *     "providers": {
 *       "9router": {
 *         "baseUrl": "http://host:20128/v1",
 *         "modelOverrides": { ... }
 *       }
 *     }
 *   }
 *
 * API key: /login 9router, or the NINE_ROUTER_API_KEY environment variable.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createProvider, openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { Model, RefreshModelsContext } from "@earendil-works/pi-ai";

const PROVIDER_ID = "9router";
const DEFAULT_BASE_URL = "http://localhost:20128/v1";
const API_KEY_ENV = "NINE_ROUTER_API_KEY";
const FALLBACK_CONTEXT_WINDOW = 128000;
const FALLBACK_MAX_TOKENS = 4096;

/** Appended to 9router's system prompt to push deeper reasoning. */
const REASONING_SUFFIX = [
	"Before answering, think as hard and as deeply as possible:",
	"- Reason through the problem step by step.",
	"- Enumerate the possible approaches, weigh the trade-offs of each, then decide.",
	"- Critically review your own answer for correctness, edge cases, and unstated assumptions before finalizing.",
].join("\n");

/** Path to pi's global models.json (honors a relocated agent dir). */
function modelsJsonPath(): string {
	return join(
		process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
		"models.json",
	);
}

/** Ensure the OpenAI-compatible base URL ends with /v1. */
function normalizeBaseUrl(url: string): string {
	const trimmed = url.trim().replace(/\/+$/, "");
	return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

/** Resolve the 9router endpoint from models.json, falling back to localhost. */
function resolveBaseUrl(): string {
	try {
		const parsed = JSON.parse(readFileSync(modelsJsonPath(), "utf8")) as {
			providers?: Record<string, { baseUrl?: unknown }>;
		};
		const raw = parsed.providers?.[PROVIDER_ID]?.baseUrl;
		if (typeof raw === "string" && raw.trim()) {
			return normalizeBaseUrl(raw);
		}
	} catch {
		// models.json missing or unreadable — use the default.
	}
	return DEFAULT_BASE_URL;
}

interface RouterModel {
	[key: string]: unknown;
}

function toTokenCount(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	if (typeof value !== "string") return undefined;
	const normalized = value.replace(/,/g, "").trim();
	const n = Number(normalized);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

const CONTEXT_KEYS = [
	"contextWindow",
	"context_window",
	"context_length",
	"contextLength",
	"max_context_length",
	"max_context_window",
	"maxModelLen",
	"max_model_len",
];

const MAX_TOKENS_KEYS = [
	"maxTokens",
	"max_tokens",
	"max_output_tokens",
	"maxOutputTokens",
	"max_completion_tokens",
	"maxCompletionTokens",
];

function firstTokenCount(entry: RouterModel, keys: string[]): number | undefined {
	for (const key of keys) {
		const count = toTokenCount(entry[key]);
		if (count !== undefined) return count;
	}
	return undefined;
}

function mapModel(entry: RouterModel, baseUrl: string): Model<"openai-completions"> {
	const id = typeof entry.id === "string" ? entry.id : "";
	const name = typeof entry.name === "string" && entry.name.trim() ? entry.name : id;
	const contextWindow = firstTokenCount(entry, CONTEXT_KEYS) ?? FALLBACK_CONTEXT_WINDOW;
	const maxTokens = Math.min(
		firstTokenCount(entry, MAX_TOKENS_KEYS) ?? FALLBACK_MAX_TOKENS,
		contextWindow,
	);

	return {
		id,
		name,
		api: "openai-completions",
		provider: PROVIDER_ID,
		baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens,
		compat: {
			// 9router's translators read max_tokens and expect a "system" role.
			maxTokensField: "max_tokens",
			supportsDeveloperRole: false,
		},
	};
}

async function fetchModels(context: RefreshModelsContext): Promise<readonly Model<"openai-completions">[]> {
	const baseUrl = resolveBaseUrl();
	const headers: Record<string, string> = { Accept: "application/json" };

	const credential = context.credential;
	const key = credential && credential.type === "api_key" ? credential.key : undefined;
	if (key) {
		headers.Authorization = `Bearer ${key}`;
	}

	const response = await fetch(`${baseUrl}/models`, {
		headers,
		signal: context.signal,
	});

	if (!response.ok) {
		const body = await response.text().catch(() => "");
		throw new Error(`9router discovery failed: HTTP ${response.status}${body ? ` — ${body}` : ""}`);
	}

	const payload = (await response.json()) as { data?: RouterModel[] };
	const entries = Array.isArray(payload.data) ? payload.data : [];

	return entries
		.filter((entry) => typeof entry.id === "string" && entry.id.trim())
		.map((entry) => mapModel(entry, baseUrl));
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider(
		createProvider<"openai-completions">({
			id: PROVIDER_ID,
			name: "9router",
			baseUrl: DEFAULT_BASE_URL,

			auth: {
				apiKey: {
					name: "9router API key",
					async login(interaction) {
						const key = await interaction.prompt({
							type: "secret",
							message: "Enter your 9router API key (from the 9router dashboard)",
						});
						return { type: "api_key", key };
					},
					async resolve({ ctx, credential }) {
						if (credential?.key) {
							return { auth: { apiKey: credential.key }, source: "stored API key" };
						}
						const envKey = await ctx.env(API_KEY_ENV);
						if (envKey) {
							return { auth: { apiKey: envKey }, source: API_KEY_ENV };
						}
						return undefined;
					},
				},
			},

			models: [],
			fetchModels,
			api: openAICompletionsApi(),
		}),
	);

	// Inject deeper-reasoning instructions into 9router's system prompt.
	pi.on("before_agent_start", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER_ID) return;
		if (event.systemPrompt.includes(REASONING_SUFFIX)) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${REASONING_SUFFIX}` };
	});
}
