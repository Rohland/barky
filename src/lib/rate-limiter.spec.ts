import { RateLimiter } from "./rate-limiter";

describe('rate-limiter', () => {
    describe('execute', () => {
        describe("when executed with success", () => {
            it("should return result", async () => {
                // arrange
                const request = jest.fn().mockResolvedValue("result");
                const sut = getSut();

                // act
                const result = await sut.execute(request);

                // assert
                expect(result).toEqual("result");
                expect(request).toHaveBeenCalledTimes(1);
            });
        });
        describe("when failure", () => {
            it("should throw error", async () => {
                // arrange
                const request = jest.fn().mockRejectedValue(new Error("error"));
                const sut = getSut();

                // act
                let error;
                try {
                    await sut.execute(request);
                } catch (err) {
                    error = err;
                }

                // assert
                expect(error).toEqual(new Error("error"));
                expect(request).toHaveBeenCalledTimes(1);
            });
        });
        describe("when request takes some time", () => {
            it("should wait", async () => {
                // arrange
                const sut = getSut();
                const request = jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve("result"), 100)));

                // act
                const start = performance.now();
                const result = await sut.execute(request);
                const end = performance.now();

                // assert
                expect(result).toEqual("result");
                expect(end - start).toBeGreaterThanOrEqual(95);
                expect(request).toHaveBeenCalledTimes(1);
            });
        });
        describe("when multiple requests sent", () => {
            it("should queue them only execute x in parallel", async () => {
                const maxPerSec = 100;
                const maxConcurrent = 1;
                const sut = getSut(maxPerSec, maxConcurrent);
                const count = 3;
                const requests = [];
                for (let i = 0; i < count; i++) {
                    const req = jest.fn().mockImplementation(() => new Promise(resolve => {
                        setTimeout(() => resolve(`result${i}`), 500)
                    }));
                    requests.push(req);
                }

                // act
                const start = performance.now();
                const result = await Promise.all(requests.map(x => sut.execute(x)));
                const end = performance.now();

                // assert
                expect(result).toEqual(requests.map((_x, i) => `result${i}`));
                expect(end - start).toBeGreaterThanOrEqual(1499); // account for a bit of jitter
                requests.forEach(x => expect(x).toHaveBeenCalledTimes(1));
            });
            it("should queue them and only execute x per second", async () => {
                // arrange
                const maxPerSec = 5;
                const sut = getSut(maxPerSec);
                const count = 20;
                const requests = [];
                const countPerSecond = new Map<number, number>();
                for (let i = 0; i < count; i++) {
                    const req = jest.fn().mockImplementation(() => new Promise(resolve => {
                        const time = Math.round(performance.now() / 1000);
                        const count = countPerSecond.get(time) ?? 0;
                        countPerSecond.set(time, count + 1);
                        setTimeout(() => resolve(`result${i}`), 100)
                    }));
                    requests.push(req);
                }

                // act
                const start = performance.now();
                const result = await Promise.all(requests.map(x => sut.execute(x)));
                const end = performance.now();

                // assert
                expect(result).toEqual(requests.map((_x, i) => `result${i}`));
                expect(end - start).toBeGreaterThanOrEqual(4000);
                expect(end - start).toBeLessThanOrEqual(5000);
                requests.forEach(x => expect(x).toHaveBeenCalledTimes(1));
                countPerSecond.forEach((value, _) => {
                    expect(value).toBeLessThanOrEqual(maxPerSec);
                });
            }, 10_000);
            it("should burst queue once rate limited time completes", async () => {
                // arrange
                const maxPerSec = 4;
                const maxConcurrent = 4;
                const sut = getSut(maxPerSec, maxConcurrent);
                const count = 8;
                const requests = [];
                const countPerSecond = new Map<number, number>();
                for (let i = 0; i < count; i++) {
                    const req = jest.fn().mockImplementation(() => new Promise(resolve => {
                        const time = Math.round(performance.now() / 1000);
                        const count = countPerSecond.get(time) ?? 0;
                        countPerSecond.set(time, count + 1);
                        const taskTime = i < 4 ? 1000 : 0;
                        setTimeout(() => resolve(`result${i}`), taskTime);
                    }));
                    requests.push(req);
                }

                // act
                const start = performance.now();
                const result = await Promise.all(requests.map(x => sut.execute(x)));
                const end = performance.now();

                // assert
                expect(result).toEqual(requests.map((_x, i) => `result${i}`));
                expect(end - start).toBeGreaterThanOrEqual(2000);
                expect(end - start).toBeLessThanOrEqual(2250);
                requests.forEach(x => expect(x).toHaveBeenCalledTimes(1));
                countPerSecond.forEach((value, _) => {
                    expect(value).toBeLessThanOrEqual(maxPerSec);
                });
            });
        });
    });

    function getSut(perSecond = null, concurrent = null) {
        return new RateLimiter(perSecond ?? 5, concurrent ?? 3);
    }
});
