export class Timer {
    private doneTime: number;

    constructor(start: number, timeout: number) {
        this.doneTime = Math.max(0, start - timeout);
    }

    public elapsed(now: number) : boolean {
        return this.doneTime >= now;
    }
}