import type { IEventBus, DomainEvent } from '../../contracts/services/IEventBus.js';

/** No-op event bus used when events are disabled. Replace with TelegramEventBus / SlackEventBus later. */
export class NullEventBus implements IEventBus {
  isAvailable(): boolean {
    return false;
  }

  async publish(_event: DomainEvent): Promise<void> {
    // intentionally empty — events disabled
  }
}
