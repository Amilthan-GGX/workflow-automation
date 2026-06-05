import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

import type { BrowserContext } from 'playwright';

import type { AppLogger } from '../../utils/logger.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import type { BrowserSession } from '../../modules/digitify/types.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest().subarray(0, KEY_LENGTH);
}

function encrypt(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex'),
  });
}

function decrypt(ciphertext: string, secret: string): string {
  const { iv, tag, data } = JSON.parse(ciphertext) as { iv: string; tag: string; data: string };
  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  return decipher.update(Buffer.from(data, 'hex')) + decipher.final('utf8');
}

export class SessionManager {
  private readonly sessionPath: string;
  private readonly secret: string | null;
  private readonly logger: AppLogger;

  constructor(sessionPath: string, logger: AppLogger) {
    this.sessionPath = sessionPath;
    this.secret = process.env['BROWSER_SESSION_SECRET'] ?? null;
    this.logger = logger;

    if (!this.secret) {
      this.logger.warn({
        action: 'session:no-secret',
        message: 'BROWSER_SESSION_SECRET not set — session stored unencrypted. Set in .env for production.',
      });
    }
  }

  async save(context: BrowserContext, email: string): Promise<Result<void, Error>> {
    try {
      const storageState = await context.storageState();
      const session: BrowserSession = {
        savedAt: new Date().toISOString(),
        email,
        storageState,
      };

      const raw = JSON.stringify(session, null, 2);
      const content = this.secret ? encrypt(raw, this.secret) : raw;

      await fs.mkdir(path.dirname(this.sessionPath), { recursive: true });
      await fs.writeFile(this.sessionPath, content, 'utf-8');

      this.logger.info({ action: 'session:saved', email, path: this.sessionPath });
      return ok(undefined);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }

  async load(): Promise<Result<BrowserSession, Error>> {
    try {
      const raw = await fs.readFile(this.sessionPath, 'utf-8');
      const content = this.secret ? decrypt(raw, this.secret) : raw;
      const session = JSON.parse(content) as BrowserSession;
      this.logger.info({ action: 'session:loaded', email: session.email, savedAt: session.savedAt });
      return ok(session);
    } catch (e) {
      return err(new Error(`Session file not found or unreadable: ${String(e)}`));
    }
  }

  async exists(): Promise<boolean> {
    try {
      await fs.access(this.sessionPath);
      return true;
    } catch {
      return false;
    }
  }

  async delete(): Promise<void> {
    try {
      await fs.unlink(this.sessionPath);
      this.logger.info({ action: 'session:deleted' });
    } catch {
      // already gone — fine
    }
  }
}
