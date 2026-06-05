import type { AppConfig } from '../config/schema.js';
import type { AppLogger } from '../utils/logger.js';
import type { IEventBus } from '../contracts/services/IEventBus.js';

export interface WorkflowContext {
  readonly runId: string;
  readonly correlationId: string;
  readonly logger: AppLogger;
  readonly config: AppConfig;
  readonly eventBus: IEventBus;
  readonly startedAt: Date;
}
