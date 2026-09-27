export function sendIfClaimed<T>(claim: () => Promise<T | null | undefined>, send: (intent: T) => Promise<unknown>): Promise<boolean>
