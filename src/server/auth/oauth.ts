import { createHash, randomBytes } from "node:crypto";
import { URL } from "node:url";
import { TokenStore } from "./token-store.js";
import type { AuthProvider, OAuthCredential } from "./types.js";
import { AppError } from "../errors.js";

interface PendingOAuthState {
  channel: string;
  userId: string;
  provider: AuthProvider;
  redirectUri: string;
  codeVerifier: string;
  createdAt: number;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;

function base64UrlSha256(input: string): string {
  const digest = createHash("sha256").update(input).digest("base64");
  return digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export class OAuthService {
  private pendingStates = new Map<string, PendingOAuthState>();

  constructor(private readonly tokenStore: TokenStore) {}

  startOAuth(channel: string, userId: string, provider: AuthProvider, redirectUri?: string) {
    if (provider !== "openai_codex") {
      throw new AppError(`Unsupported OAuth provider: ${provider}`, 400, "unsupported_provider");
    }

    const authUrlBase = process.env.OAUTH_OPENAI_AUTH_URL;
    const clientId = process.env.OAUTH_OPENAI_CLIENT_ID;
    const configuredRedirectUri = process.env.OAUTH_OPENAI_REDIRECT_URI;
    const finalRedirectUri = redirectUri ?? configuredRedirectUri;

    if (!authUrlBase || !clientId || !finalRedirectUri) {
      throw new AppError(
        "OAuth is not configured. Set OAUTH_OPENAI_AUTH_URL, OAUTH_OPENAI_CLIENT_ID and OAUTH_OPENAI_REDIRECT_URI.",
        503,
        "oauth_not_configured",
      );
    }

    const state = randomBytes(24).toString("hex");
    const codeVerifier = randomBytes(32).toString("hex");
    const codeChallenge = base64UrlSha256(codeVerifier);
    const scope = process.env.OAUTH_OPENAI_SCOPE ?? "openid profile offline_access";

    this.pendingStates.set(state, {
      channel,
      userId,
      provider,
      redirectUri: finalRedirectUri,
      codeVerifier,
      createdAt: Date.now(),
    });

    const authUrl = new URL(authUrlBase);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", finalRedirectUri);
    authUrl.searchParams.set("scope", scope);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    return {
      provider,
      state,
      authUrl: authUrl.toString(),
      expiresInMs: STATE_TTL_MS,
    };
  }

  async completeOAuth(code: string, state: string) {
    const pending = this.pendingStates.get(state);
    if (!pending) {
      throw new AppError("Invalid OAuth state", 401, "oauth_invalid_state");
    }

    if (Date.now() - pending.createdAt > STATE_TTL_MS) {
      this.pendingStates.delete(state);
      throw new AppError("OAuth state expired", 401, "oauth_state_expired");
    }

    const tokenUrl = process.env.OAUTH_OPENAI_TOKEN_URL;
    const clientId = process.env.OAUTH_OPENAI_CLIENT_ID;
    const clientSecret = process.env.OAUTH_OPENAI_CLIENT_SECRET;

    if (!tokenUrl || !clientId || !clientSecret) {
      throw new AppError(
        "OAuth token exchange is not configured. Set OAUTH_OPENAI_TOKEN_URL, OAUTH_OPENAI_CLIENT_ID, OAUTH_OPENAI_CLIENT_SECRET.",
        503,
        "oauth_not_configured",
      );
    }

    const form = new URLSearchParams();
    form.set("grant_type", "authorization_code");
    form.set("code", code);
    form.set("client_id", clientId);
    form.set("client_secret", clientSecret);
    form.set("redirect_uri", pending.redirectUri);
    form.set("code_verifier", pending.codeVerifier);

    const resp = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new AppError(`OAuth token exchange failed: ${resp.status} ${body}`, 502, "oauth_token_exchange_failed");
    }

    const token = (await resp.json()) as OAuthTokenResponse;
    if (!token.access_token) {
      throw new AppError(
        "OAuth token exchange succeeded but no access_token returned",
        502,
        "oauth_invalid_token_response",
      );
    }

    const expiresAt = token.expires_in ? Date.now() + token.expires_in * 1000 : undefined;
    this.tokenStore.upsert(pending.channel, pending.userId, {
      provider: pending.provider,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenType: token.token_type,
      scope: token.scope,
      expiresAt,
    });

    this.pendingStates.delete(state);

    return {
      ok: true,
      channel: pending.channel,
      userId: pending.userId,
      provider: pending.provider,
      expiresAt,
    };
  }

  async getCredential(channel: string, userId: string): Promise<OAuthCredential | null> {
    const credential = this.tokenStore.get(channel, userId);
    if (!credential) {
      return null;
    }

    if (credential.provider !== "openai_codex") {
      return credential;
    }

    const shouldRefresh =
      credential.expiresAt !== undefined &&
      credential.refreshToken &&
      Date.now() >= credential.expiresAt - 30_000;

    if (!shouldRefresh) {
      return credential;
    }

    const refreshed = await this.refreshOpenAiCredential(channel, userId, credential);
    if (refreshed) {
      return refreshed;
    }

    if (credential.expiresAt !== undefined && Date.now() >= credential.expiresAt) {
      this.tokenStore.delete(channel, userId);
      return null;
    }

    return credential;
  }

  private async refreshOpenAiCredential(
    channel: string,
    userId: string,
    credential: OAuthCredential,
  ): Promise<OAuthCredential | null> {
    const tokenUrl = process.env.OAUTH_OPENAI_TOKEN_URL;
    const clientId = process.env.OAUTH_OPENAI_CLIENT_ID;
    const clientSecret = process.env.OAUTH_OPENAI_CLIENT_SECRET;

    if (!tokenUrl || !clientId || !clientSecret || !credential.refreshToken) {
      return null;
    }

    const form = new URLSearchParams();
    form.set("grant_type", "refresh_token");
    form.set("refresh_token", credential.refreshToken);
    form.set("client_id", clientId);
    form.set("client_secret", clientSecret);

    const resp = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });

    if (!resp.ok) {
      return null;
    }

    const token = (await resp.json()) as OAuthTokenResponse;
    if (!token.access_token) {
      return null;
    }

    const expiresAt = token.expires_in ? Date.now() + token.expires_in * 1000 : credential.expiresAt;
    return this.tokenStore.upsert(channel, userId, {
      provider: credential.provider,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? credential.refreshToken,
      tokenType: token.token_type ?? credential.tokenType,
      scope: token.scope ?? credential.scope,
      expiresAt,
    });
  }

  getStatus(channel: string, userId: string) {
    return this.tokenStore.getStatus(channel, userId);
  }

  disconnect(channel: string, userId: string): boolean {
    return this.tokenStore.delete(channel, userId);
  }
}
