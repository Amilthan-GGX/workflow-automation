import type { DomainEvent } from '../contracts/services/IEventBus.js';

export const EventType = {
  DownloadCompleted: 'download.completed',
  DownloadFailed: 'download.failed',
} as const;

export type EventTypeLiteral = (typeof EventType)[keyof typeof EventType];

export interface DownloadCompletedPayload {
  filename: string;
  sizeBytes: number;
}

export interface DownloadFailedPayload {
  error: string;
}

export function makeDownloadCompletedEvent(runId: string, filename: string, sizeBytes: number): DomainEvent {
  return {
    type: EventType.DownloadCompleted,
    runId,
    occurredAt: new Date().toISOString(),
    payload: { filename, sizeBytes } satisfies DownloadCompletedPayload,
  };
}

export function makeDownloadFailedEvent(runId: string, error: string): DomainEvent {
  return {
    type: EventType.DownloadFailed,
    runId,
    occurredAt: new Date().toISOString(),
    payload: { error } satisfies DownloadFailedPayload,
  };
}
