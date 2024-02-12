import { sleepMs } from "./sleep";

interface IRequest {
    request: () => Promise<any>;
    resolve: (res: any) => void;
    reject: (err: Error) => void;
}

// Rate limiter that assumes requests take less than 1 minute to execute
export class RateLimiter {

    private maxRatePerSecond: number;
    private maxConcurrent: number;
    private requestQueue: IRequest[] = [];
    private executing: IRequest[] = [];
    private rateLimiter = new Map<number, number>();

    constructor(maxRatePerSecond, maxConcurrent) {
        this.maxRatePerSecond = maxRatePerSecond;
        this.maxConcurrent = maxConcurrent;
    }

    async execute<T>(request: () => Promise<T>): Promise<T> {
        let resolve, reject;
        const promise = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        this.requestQueue.push({
            request: async () => {
                await this.waitUntilCanExecute();
                return await request();
            },
            resolve,
            reject
        });
        this.processRequests();
        return await promise;
    }

    processRequests() {
        this.clearOutOldRateLimitEntries();
        const requests = this.requestQueue.splice(0, this.maxConcurrent - this.executing.length);
        if (requests.length === 0) {
            return;
        }
        this.executing.push(...requests);
        requests.map(x => x.request()
            .then((res) => {
                x.resolve(res);
                this.executing.splice(this.executing.indexOf(x), 1);
                this.processRequests();
            })
            .catch((err: Error) => {
                x.reject(err);
                this.executing.splice(this.executing.indexOf(x), 1);
                this.processRequests();
            }));
    }

    private async waitUntilCanExecute() {
        while (true) {
            const currentSecond = new Date().getSeconds();
            const countInCurrentSecond = this.rateLimiter.get(currentSecond) ?? 0;
            if (countInCurrentSecond < this.maxRatePerSecond) {
                this.rateLimiter.set(currentSecond, countInCurrentSecond + 1);
                break;
            }
            await sleepMs(10);
        }
    }

    private clearOutOldRateLimitEntries() {
        const currentSecond = new Date().getSeconds();
        const oldSeconds = Array.from(this.rateLimiter.keys()).filter(x => x !== currentSecond);
        oldSeconds.forEach(x => this.rateLimiter.delete(x));
    }
}
