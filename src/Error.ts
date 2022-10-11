/**
 * Error signalling some irreversible error has occurred in the state machine.
 */
export class CriticalError extends Error {
    constructor(message?: string) {
        super(message);
        this.name = 'CriticalError';
    }
}

/**
 * Error signalling some component in state machine timed out.
 */
export class TimeoutError extends Error {
    constructor(message?: string) {
        super(message);
        this.name = 'TimeoutError';
    }
}
