/*
 A simple rolling-hour cap on calls to the AI service. Unlike the RateLimiter this rejects rather
 than queues - someone waiting on a reply in Slack is better told "not now" than left hanging.
 */
export class CallBudget {

    private readonly _calls: number[] = [];

    constructor(private readonly maxPerHour: number) {
    }

    public tryConsume(now: number = Date.now()): boolean {
        const cutoff = now - 60 * 60 * 1000;
        while (this._calls.length > 0 && this._calls[0] < cutoff) {
            this._calls.shift();
        }
        if (this._calls.length >= this.maxPerHour) {
            return false;
        }
        this._calls.push(now);
        return true;
    }

    public get used(): number {
        return this._calls.length;
    }
}
