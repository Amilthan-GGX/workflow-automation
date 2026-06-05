import type { EventTypeLiteral } from '../../types/events.js';

export interface DomainEvent {
  type: EventTypeLiteral;
  runId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface IEventBus {
  isAvailable(): boolean;
  publish(event: DomainEvent): Promise<void>;
}
