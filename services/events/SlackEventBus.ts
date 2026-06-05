import type { IEventBus, DomainEvent } from '../../contracts/services/IEventBus.js';
import type { AppLogger } from '../../utils/logger.js';
import {
  EventType,
  type DownloadCompletedPayload,
  type DownloadFailedPayload,
} from '../../types/events.js';

export class SlackEventBus implements IEventBus {
  private readonly webhookUrl: string;
  private readonly logger: AppLogger;

  constructor(webhookUrl: string, logger: AppLogger) {
    this.webhookUrl = webhookUrl;
    this.logger = logger.child({ service: 'SlackEventBus' });
  }

  isAvailable(): boolean {
    return Boolean(this.webhookUrl);
  }

  async publish(event: DomainEvent): Promise<void> {
    const body = buildPayload(event);
    if (!body) return;

    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.warn({ action: 'slack:send_failed', status: res.status, text });
      } else {
        this.logger.info({ action: 'slack:sent', eventType: event.type, runId: event.runId });
      }
    } catch (err) {
      this.logger.warn({ action: 'slack:network_error', err: String(err) });
    }
  }
}

// ── Slack Block Kit payload builder ───────────────────────────────────────────

type SlackBlock = Record<string, unknown>;

interface SlackPayload {
  text: string;
  blocks?: SlackBlock[];
}

function section(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text } };
}

function buildPayload(event: DomainEvent): SlackPayload | null {
  switch (event.type) {
    case EventType.DownloadCompleted: {
      const p = event.payload as unknown as DownloadCompletedPayload;
      const sizeMb = (p.sizeBytes / 1024 / 1024).toFixed(2);
      return {
        text: `:inbox_tray: Digitify download complete: ${p.filename}`,
        blocks: [
          section(`:inbox_tray: *Digitify Download Complete*\nFile: \`${p.filename}\` (${sizeMb} MB)`),
        ],
      };
    }

    case EventType.DownloadFailed: {
      const p = event.payload as unknown as DownloadFailedPayload;
      return {
        text: ':x: Digitify download failed',
        blocks: [
          section(`:x: *Digitify Download Failed*\nRun ID: \`${event.runId}\`\nError: \`${p.error}\``),
        ],
      };
    }

    default:
      return null;
  }
}
