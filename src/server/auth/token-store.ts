import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AuthStatus, OAuthCredential } from "./types.js";

interface CredentialFile {
  credentials: Record<string, OAuthCredential>;
}

const DEFAULT_AUTH_DIR = join(homedir(), ".pi-butler", "auth");

export class TokenStore {
  private readonly filePath: string;

  constructor(authDir: string = DEFAULT_AUTH_DIR) {
    this.filePath = join(authDir, "credentials.json");
  }

  private ensureDir(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private load(): CredentialFile {
    this.ensureDir();
    if (!existsSync(this.filePath)) {
      return { credentials: {} };
    }

    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as CredentialFile;
      return parsed.credentials ? parsed : { credentials: {} };
    } catch {
      return { credentials: {} };
    }
  }

  private save(data: CredentialFile): void {
    this.ensureDir();
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  private key(channel: string, userId: string): string {
    return `${channel}:${userId}`;
  }

  get(channel: string, userId: string): OAuthCredential | null {
    const data = this.load();
    return data.credentials[this.key(channel, userId)] ?? null;
  }

  upsert(channel: string, userId: string, credential: Omit<OAuthCredential, "createdAt" | "updatedAt">): OAuthCredential {
    const data = this.load();
    const key = this.key(channel, userId);
    const now = Date.now();
    const prev = data.credentials[key];

    const next: OAuthCredential = {
      ...credential,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };

    data.credentials[key] = next;
    this.save(data);
    return next;
  }

  delete(channel: string, userId: string): boolean {
    const data = this.load();
    const key = this.key(channel, userId);
    if (!data.credentials[key]) return false;
    delete data.credentials[key];
    this.save(data);
    return true;
  }

  getStatus(channel: string, userId: string): AuthStatus {
    const cred = this.get(channel, userId);
    if (!cred) {
      return { channel, userId, connected: false };
    }

    return {
      channel,
      userId,
      connected: true,
      provider: cred.provider,
      expiresAt: cred.expiresAt,
      updatedAt: cred.updatedAt,
    };
  }
}
