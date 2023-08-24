const sleepMock = jest.fn();
const canLockProcessForMock = jest.fn().mockReturnValue(true);
jest.doMock("./lib/sleep", () => {
    return {
        sleepMs: sleepMock
    }
});
jest.doMock("./lib/process-lock", () => {
    return {
        canLockProcessFor: canLockProcessForMock
    }
});
import { loop } from "./loop";

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
            expect(sleepMock).not.toHaveBeenCalled();
        });
    });
    describe("when loop set", () => {
        describe("and lock cannot be acquired", () => {
            it("should not execute", async () => {
                // arrange
                const args = {
                    loop: "1",
                    env: "test-env",
                    eval: "test-eval",
                    digest: "test-digest",
                }
                canLockProcessForMock.mockReturnValue(false);
                const runner = jest.fn().mockResolvedValue(0);

                // act
                const result = await loop(args, runner);

                // assert
                expect(runner).not.toHaveBeenCalled();
                expect(canLockProcessForMock).toHaveBeenCalledWith("test-env;test-eval;test-digest");
                expect(result).toEqual(-1);
            });
        });
        it("should loop until error", async () => {
            // arrange
            canLockProcessForMock.mockReturnValue(true);
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
            expect(sleepMock).toHaveBeenCalledTimes(1);
            const timeToSleep = sleepMock.mock.calls[0][0];
            expect(timeToSleep).toBeGreaterThan(29000);
            expect(timeToSleep).toBeLessThanOrEqual(30000);
        });
    });
});
