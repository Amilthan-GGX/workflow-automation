import type { IEventBus, DomainEvent } from '../../contracts/services/IEventBus.js';
import type { AppLogger } from '../../utils/logger.js';
import {
  EventType,
  type DownloadCompletedPayload,
  type DownloadFailedPayload,
} from '../../types/events.js';

const TELEGRAM_API = 'https://api.telegram.org';

export class TelegramEventBus implements IEventBus {
  private readonly token: string;
  private readonly chatId: string;
  private readonly logger: AppLogger;

  constructor(token: string, chatId: string, logger: AppLogger) {
    this.token = token;
    this.chatId = chatId;
    this.logger = logger.child({ service: 'TelegramEventBus' });
  }

  isAvailable(): boolean {
    return Boolean(this.token && this.chatId);
  }

  async publish(event: DomainEvent): Promise<void> {
    const text = formatMessage(event);
    if (!text) return;

    const url = `${TELEGRAM_API}/bot${this.token}/sendMessage`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: 'MarkdownV2',
          disable_web_page_preview: true,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn({ action: 'telegram:send_failed', status: res.status, body });
      } else {
        this.logger.info({ action: 'telegram:sent', eventType: event.type, runId: event.runId });
      }
    } catch (err) {
      this.logger.warn({ action: 'telegram:network_error', err: String(err) });
    }
  }
}

// ── Message formatter ──────────────────────────────────────────────────────────

function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return 'N/A';
  return String(s).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function formatMessage(event: DomainEvent): string | null {
  switch (event.type) {
    case EventType.DownloadCompleted: {
      const p = event.payload as unknown as DownloadCompletedPayload;
      const sizeMb = (p.sizeBytes / 1024 / 1024).toFixed(2);
      return [
        `📥 *Digitify Download Complete*`,
        `File: ${esc(p.filename)}`,
        `Size: ${esc(sizeMb)} MB`,
      ].join('\n');
    }

    case EventType.DownloadFailed: {
      const p = event.payload as unknown as DownloadFailedPayload;
      return [
        `❌ *Digitify Download Failed*`,
        `Run ID: \`${esc(event.runId)}\``,
        `Error: ${esc(p.error)}`,
      ].join('\n');
    }

    default:
      return null;
  }
}
