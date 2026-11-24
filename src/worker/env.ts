// Bindings and variables. The deploy asks for no secrets: setup generates ENCRYPTION_KEY and
// saves it to the Worker through the API (services/setup.ts). The *_API_BASE overrides exist only
// for local development and tests, which point every external API at a mock server.
export interface Env {
  DB: D1Database;
  // Optional: Cloudflare Workers AI binding for the AI features. When it is absent, AI calls
  // fall back to the OpenAI-compatible provider configured in settings (DeepSeek by default).
  AI?: Ai;
  ENCRYPTION_KEY?: string;
  // Set only while rotating the key: old credentials still decrypt until re-encrypted.
  ENCRYPTION_KEY_PREVIOUS?: string;
  CF_API_TOKEN?: string;
  CF_API_BASE?: string;
  RESEND_API_BASE?: string;
  BREVO_API_BASE?: string;
  MAILJET_API_BASE?: string;
  GITHUB_API_BASE?: string;
  WORKER_NAME?: string;
}

declare global {
  const __APP_VERSION__: string;
}
