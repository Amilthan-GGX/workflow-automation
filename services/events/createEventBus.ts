import type { IEventBus } from '../../contracts/services/IEventBus.js';
import type { AppConfig } from '../../config/schema.js';
import type { AppLogger } from '../../utils/logger.js';
import { NullEventBus } from './NullEventBus.js';
import { TelegramEventBus } from './TelegramEventBus.js';
import { SlackEventBus } from './SlackEventBus.js';

/** Multi-cast bus that fans out to multiple active destinations. */
class CompositeEventBus implements IEventBus {
  constructor(private readonly buses: IEventBus[]) {}

  isAvailable(): boolean {
    return this.buses.some((b) => b.isAvailable());
  }

  async publish(event: Parameters<IEventBus['publish']>[0]): Promise<void> {
    await Promise.all(this.buses.map((b) => b.publish(event)));
  }
}

/**
 * Returns a ready IEventBus based on config.events.*
 * - events.enabled=false → NullEventBus
 * - Multiple destinations configured → CompositeEventBus
 */
export function createEventBus(config: AppConfig, logger: AppLogger): IEventBus {
  if (!config.events.enabled) {
    return new NullEventBus();
  }

  const buses: IEventBus[] = [];

  if (config.events.telegramBotToken && config.events.telegramChatId) {
    buses.push(new TelegramEventBus(config.events.telegramBotToken, config.events.telegramChatId, logger));
    logger.info({ action: 'events:telegram_enabled' });
  }

  if (config.events.slackWebhookUrl) {
    buses.push(new SlackEventBus(config.events.slackWebhookUrl, logger));
    logger.info({ action: 'events:slack_enabled' });
  }

  if (buses.length === 0) {
    logger.warn({ action: 'events:enabled_but_no_destinations', hint: 'Set TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID or SLACK_WEBHOOK_URL' });
    return new NullEventBus();
  }

  return buses.length === 1 ? buses[0]! : new CompositeEventBus(buses);
}
