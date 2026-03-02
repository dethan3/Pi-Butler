export type AuthProvider = "openai_codex";

export interface OAuthCredential {
  provider: AuthProvider;
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface AuthStatus {
  channel: string;
  userId: string;
  connected: boolean;
  provider?: AuthProvider;
  expiresAt?: number;
  updatedAt?: number;
}
