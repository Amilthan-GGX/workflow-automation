/** No Loading Memo uploaded in POD (disabled eye / no files). */
export class MemoMissingError extends Error {
  constructor(message = 'Memo missing') {
    super(message);
    this.name = 'MemoMissingError';
  }
}

export function isMemoMissingError(e: Error): boolean {
  return e instanceof MemoMissingError || e.name === 'MemoMissingError';
}
