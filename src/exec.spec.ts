import mockConsole from "jest-mock-console";

const evaluateMock = jest.fn()
jest.doMock("./evaluation", () => {
    return {
        evaluate: evaluateMock
    };
});
import { execute } from "./exec";
import { MonitorFailureResult, WebResult } from "./models/result";
import { deleteDbIfExists, destroy, initConnection } from "./models/db";

describe("integration tests", () => {
    let _restoreConsole;
    beforeEach(() => _restoreConsole = mockConsole());
    afterEach(() => _restoreConsole());
    const testDb = "exec";
    beforeEach(async () => {
        deleteDbIfExists(testDb);
        await initConnection(testDb);
    });
    afterEach(async () => {
        await destroy();
        deleteDbIfExists(testDb);
    });

    describe("with no results simple alert configuration", () => {
        it("should emit no logs and trigger no alerts", async () => {
            // arrange
            const config = {
                fileName: testDb,
                digest: {
                    channels: [
                    ]
                }
            };
            evaluateMock.mockResolvedValue([]);

            // act
            await execute(config, "test", () => {});

            // assert
            expect(evaluateMock).toHaveBeenCalledTimes(1);
            expect(console.log).not.toHaveBeenCalled();
        });
    });
    describe("with results", () => {
        describe("with monitor failure", () => {
            it("should emit logs", async () => {
                // arrange
                const config = {
                    fileName: testDb,
                    digest: {
                        monitor: {
                            alert: {
                                channels: ["console"]
                            }
                        },
                        channels: [
                        ]
                    }
                };
                const alert = null;
                const result = new MonitorFailureResult("web", "www.codeo.co.za", "Runtime Error", alert);
                evaluateMock.mockResolvedValue([result]);

                // act
                await execute(config, "test", () => {});

                // assert
                expect(console.log).toHaveBeenCalledWith(result.toString());
                expect(console.log).toHaveBeenCalledWith(expect.stringContaining("🚨Outage started at "));
                expect(console.log).toHaveBeenCalledWith(expect.stringContaining("1 health check affected"));
            });
            describe("and then resolved", () => {
                it("should emit resolution", async () => {
                    const config = {
                        fileName: testDb,
                        digest: {
                            channels: [
                            ]
                        }
                    };
                    const alert = {
                        channels: ["console"]
                    };
                    const fail = new MonitorFailureResult("web", "www.codeo.co.za", "Runtime Error", alert);
                    evaluateMock.mockResolvedValue([fail]);
                    await execute(config, "test", () => {});
                    const ok = new WebResult(new Date(), "health-check", "www.codeo.co.za", true, "200", "OK", 0, alert);
                    evaluateMock.mockResolvedValue([ok]);

                    // act
                    await execute(config, "test", () => {});

                    // assert
                    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Outage ended at"));
                });
            });
        });
        describe("with failure with simple alert config", () => {
            it("should emit logs and trigger alert", async () => {
                // arrange
                const config = {
                    fileName: testDb,
                    digest: {
                        channels: [
                        ]
                    }
                };
                const alert = {
                    channels: ["console"]
                };
                const result = new WebResult(new Date(), "health-check", "www.codeo.co.za", false, "400", "FAIL", 0, alert);
                evaluateMock.mockResolvedValue([result]);

                // act
                await execute(config, "test", () => {});

                // assert
                expect(console.log).toHaveBeenCalledWith(result.toString());
                expect(console.log).toHaveBeenCalledWith(expect.stringContaining("🚨Outage started at "));
                expect(console.log).toHaveBeenCalledWith(expect.stringContaining("1 health check affected"));
            });
            describe("and then resolved", () => {
                it("should emit resolution", async () => {
                    const config = {
                        fileName: testDb,
                        digest: {
                            channels: [
                            ]
                        }
                    };
                    const alert = {
                        channels: ["console"]
                    };
                    const fail = new WebResult(new Date(), "health-check", "www.codeo.co.za", false, "400", "FAIL", 0, alert);
                    evaluateMock.mockResolvedValue([fail]);
                    await execute(config, "test", () => {});
                    const ok = new WebResult(new Date(), "health-check", "www.codeo.co.za", true, "200", "OK", 0, alert);
                    evaluateMock.mockResolvedValue([ok]);

                    // act
                    await execute(config, "test", () => {});

                    // assert
                    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Outage ended at"));
                });
            });
        });
    });
});
