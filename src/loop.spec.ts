import { importAndMock } from "../tests/import-and-mock.js";

const processLock = await importAndMock("./lib/process-lock.ts", () => {
   return {
       canLockProcessFor: jest.fn().mockReturnValue(true)
   }
});

const sleepMock = await importAndMock("./lib/sleep.ts", () => {
    return {
        sleepMs: jest.fn()
    };
});


const { loop } = await import("./loop.js");

describe("loop", () => {
    describe("when loop not set", () => {
        it("should execute runner and return immediately", async () => {
            // arrange
            const args = {};
            const runner = jest.fn().mockResolvedValue(0);

            // act
            const result = await loop(args, runner);

            // assert
            expect(result).toEqual(0);
            expect(runner).toHaveBeenCalledTimes(1);
            expect(sleepMock.sleepMs).not.toHaveBeenCalled();
        });
    });
    describe("when loop set", () => {
        describe("and lock cannot be acquired", () => {
            it("should not execute", async () => {
                // arrange
                const args = {
                    loop: "1",
                    rules: "test-env",
                    eval: "test-eval",
                    digest: "test-digest",
                }
                processLock.canLockProcessFor.mockReturnValue(false);
                const runner = jest.fn().mockResolvedValue(0);

                // act
                const result = await loop(args, runner);

                // assert
                expect(runner).not.toHaveBeenCalled();
                expect(processLock.canLockProcessFor).toHaveBeenCalledWith("test-env;test-eval;test-digest");
                expect(result).toEqual(-1);
            });
        });
        it("should loop until error", async () => {
            // arrange
            processLock.canLockProcessFor.mockReturnValue(true);
            const args = { loop: "1" };
            let count = 0;
            const runner = async () => {
                if (count++ === 0) {
                    return 0;
                }
                return -1;
            };

            // act
            const result = await loop(args, runner);

            // assert
            expect(result).toEqual(-1);
            expect(count).toEqual(2);
            expect(sleepMock.sleepMs).toHaveBeenCalledTimes(1);
            const timeToSleep = sleepMock.sleepMs.mock.calls[0][0];
            expect(timeToSleep).toBeGreaterThan(29000);
            expect(timeToSleep).toBeLessThanOrEqual(30000);
        });
    });
});
