import { sleepMs } from "./sleep";
import { log } from "../models/logger";

class Request {

    public timestamp: Date;
    private resolve: (res: any) => void;
    private reject: (err: Error) => void;
    private promise: Promise<any>;

    constructor(
        public request: () => Promise<any>,
        public onComplete: (r: Request) => void) {
        this.promise = new Promise<any>((res, rej) => {
            this.resolve = res;
            this.reject = rej;
        });
    }

    execute() {
        this.timestamp = new Date();
        // we need to consider that the request function might throw synchronously
        try {
            Promise.resolve(this.request())
                .then(res => {
                    this.onComplete(this);
                    this.resolve(res);
                })
                .catch(err => {
                    this.onComplete(this);
                    this.reject(err instanceof Error ? err : new Error(String(err)));
                });
        } catch (err) {
            this.onComplete(this);
            this.reject(err instanceof Error ? err : new Error(String(err)));
        }
    }

    async waitUntilDone(): Promise<any> {
        return await this.promise;
    }
}

export class RateLimiter {

    private maxRatePerSecond: number;
    private maxConcurrent: number;
    private requestQueue: Request[] = [];
    private executing: Request[] = [];
    private executed: Request[] = [];

    constructor(maxRatePerSecond: number, maxConcurrent: number) {
        if (maxRatePerSecond <= 0) {
            throw new Error("maxRatePerSecond must be greater than 0");
        }
        if (maxConcurrent <= 0) {
            throw new Error("maxConcurrent must be greater than 0");
        }
        this.maxRatePerSecond = maxRatePerSecond;
        this.maxConcurrent = maxConcurrent;
    }

    async execute<T>(request: () => Promise<T>): Promise<T> {
        const r = new Request(
            request,
            this.onComplete.bind(this)
        );
        this.requestQueue.push(r);
        void this.processRequests();
        return await r.waitUntilDone();
    }

    onComplete(request: Request) {
        this.executed.push(request);
        this.removeRequestFrom(request, this.executing);
        this.cleanExecutedHistory();
        // check-in and see if we can process more requests right now
        void this.processRequests(false);
    }

    async processRequests(poll: boolean = true) {
        while (this.requestQueue.length > 0) {
            if (this.canExecuteNow) {
                this.log("request allowed");
                const request = this.requestQueue.shift();
                if (!request) {
                    return;
                }
                // execute request in background
                this.executing.push(request);
                request.execute();
                continue;
            }
            if (!poll) {
                // if we don't intend to poll (avoid multiple timers), just exit
                return;
            }
            await sleepMs(this.pollTime);
        }
    }

    public removeRequestFrom(request: Request, list: Request[]) {
        const index = list.indexOf(request);
        if (index < 0) {
            return;
        }
        list.splice(index, 1);
    }

    public get canExecuteNow(): boolean {
        const hasConcurrentCapacity = this.executing.length < this.maxConcurrent;
        if (!hasConcurrentCapacity) {
            this.log("limited - max concurrent reached", { maxConcurrent: this.maxConcurrent, executing: this.executing.length });
            return false;
        }
        const oneSecondAgo = new Date(Date.now() - 1000);
        const executedInLastSecond = [...this.executing, ...this.executed]
            .map(x => x.timestamp)
            .filter(x => x >= oneSecondAgo)
            .length;
        const rateLimitPerSecondHasCapacity = executedInLastSecond < this.maxRatePerSecond;
        if (!rateLimitPerSecondHasCapacity) {
            this.log("limited - max per second reached", {
                maxRatePerSecond: this.maxRatePerSecond,
                executedInLastSecond
            });
        }
        return rateLimitPerSecondHasCapacity;
    }

    public get pollTime(): number {
        // divide by 2 (nyquist)
        return Math.ceil(1000 / this.maxRatePerSecond) / 2;
    }

    private cleanExecutedHistory() {
        const oneSecondAgo = new Date(Date.now() - 1000);
        const remaining = this.executed.filter(x => x.timestamp >= oneSecondAgo);
        this.executed = remaining;
    }

    private log(msg: string, data?: any) {
        log("[rate limiter] " + msg, data);
    }
}
