import mockConsole from "jest-mock-console";
import { importAndMock } from "../tests/import-and-mock.js";

const evaluateMock = await importAndMock("./evaluation.ts", () => {
    return {
        evaluate: jest.fn()
    };
});

const { configureMonitorLogsWithAlertConfiguration, execute } = await import("./exec.js");
import { MonitorFailureResult, WebResult } from "./models/result.js";
import { deleteDbIfExists, destroy, initConnection } from "./models/db.js";
import { AlertConfiguration } from "./models/alert_configuration.js";
import { DigestConfiguration } from "./models/digest.js";

describe("exec", () => {

    describe("configureMonitorLogsWithAlertConfiguration", () => {
        describe("with no alert configuration", () => {
            describe.each([
                [{}],
                [{ "alert-policies": null }],
                [{ "alert-policies": undefined }],
                [{ "alert-policies": {} }]
            ])(`with digest config %j`, (digest) => {
                it("should result in no config for alert", async () => {
                    // arrange
                    const results = [new MonitorFailureResult("web", "www.codeo.co.za", "Runtime Error", null)];
                    // act
                    configureMonitorLogsWithAlertConfiguration(results, new DigestConfiguration(digest));
                    // assert
                    expect(results[0].alert).toEqual(null);
                });
            });
        });
        describe("with alert configured", () => {
            describe("with monitor exception policy", () => {
                it("should set alert for monitor results only", async () => {
                    // arrange
                    const alert = {
                        "exception-policy": "monitor",
                        channels: ["console"]
                    };
                    const results = [
                        new WebResult(new Date(), "health-check", "web", 200, 200, 200, 0, null),
                        new MonitorFailureResult("web", "www.codeo.co.za", "Runtime Error", { alert })
                    ];
                    const digest = {
                        "alert-policies": {
                            "monitor": {
                                channels: ["console"],
                                rules: []
                            }
                        }
                    };
                    // act
                    configureMonitorLogsWithAlertConfiguration(results, new DigestConfiguration(digest));

                    // assert
                    expect(results[0].alert).toEqual(null);
                    expect(results[1].alert).toEqual(new AlertConfiguration(digest["alert-policies"].monitor));
                });
                describe("but if not provided", () => {
                    describe("and digest configured", () => {
                        it("should throw", async () => {
                            // arrange
                            const alert = {
                                "exception-policy": "monitor",
                                channels: ["console"]
                            };
                            const results = [
                                new WebResult(new Date(), "health-check", "web", 200, 200, 200, 0, null),
                                new MonitorFailureResult("web", "www.codeo.co.za", "Runtime Error", { alert })
                            ];
                            const digest = {
                                "alert-policies": {}
                            };
                            // act
                            expect(() => configureMonitorLogsWithAlertConfiguration(results, new DigestConfiguration(digest)))
                                .toThrow("alert exception policy 'monitor' not found in digest config");
                        });
                    });
                    describe("and digest not configured", () => {
                        it("should not configure", async () => {
                            // arrange
                            const alert = {
                                "exception-policy": "monitor",
                                channels: ["console"]
                            };
                            const results = [
                                new WebResult(new Date(), "health-check", "web", 200, 200, 200, 0, null),
                                new MonitorFailureResult("web", "www.codeo.co.za", "Runtime Error", { alert })
                            ];

                            // act
                            configureMonitorLogsWithAlertConfiguration(results, new DigestConfiguration(null));

                            // assert
                            expect(results[0].alert).toEqual(null);
                        });
                    });
                });
                describe("with no exception policy defined", () => {
                    it("should leave the default specified", async () => {
                        // arrange
                        const appAlertConfig = {
                            channels: ["sms"],
                            rules: []
                        };
                        const results = [
                            new WebResult(new Date(), "health-check", "web", 200, 200, 200, 0, null),
                            new MonitorFailureResult("web", "www.codeo.co.za", "Runtime Error", { alert: appAlertConfig })
                        ];
                        const digest = {
                            monitor: {
                                alert: {
                                    channels: ["console"],
                                    rules: []
                                }
                            }
                        };
                        // act
                        configureMonitorLogsWithAlertConfiguration(results, new DigestConfiguration(digest));

                        // assert
                        expect(results[0].alert).toEqual(null);
                        expect(results[1].alert).toMatchObject(appAlertConfig);
                    });
                });
            });
        });
    });

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
                        channels: []
                    }
                };
                evaluateMock.evaluate.mockResolvedValue([]);

                // act
                await execute(config, "test");

                // assert
                expect(evaluateMock.evaluate).toHaveBeenCalledTimes(1);
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
                            "alert-policies": {
                                monitor: {
                                    channels: ["console"],
                                    rules: [{ count: 1 }]
                                }
                            },
                            channels: []
                        }
                    };
                    const alert = {
                        "exception-policy": "monitor"
                    };
                    const result = new MonitorFailureResult("web", "www.codeo.co.za", "Runtime Error", { alert });
                    evaluateMock.evaluate.mockResolvedValue([result]);

                    // act
                    await execute(config, "test");

                    // assert
                    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(result.toString()));
                    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("🚨Outage started at "));
                    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("1 health check affected"));
                });
                describe("but if configured with policy that does not exist", () => {
                    it("should throw", async () => {
                        // arrange
                        const config = {
                            fileName: testDb,
                            digest: {
                                "alert-policies": {
                                    monitor: {
                                        channels: ["console"],
                                        rules: [{ count: 1 }]
                                    }
                                },
                                channels: []
                            }
                        };
                        const alert = {
                            "exception-policy": "abc"
                        };
                        const result = new MonitorFailureResult("web", "www.codeo.co.za", "Runtime Error", { alert });
                        evaluateMock.evaluate.mockResolvedValue([result]);

                        // act and assert
                        await expect(async () => await execute(config, "test")).rejects.toThrow("alert exception policy 'abc' not found in digest config");
                    });
                });
                describe("and with consecutive count specified and not reached", () => {
                    it("should not trigger outage", async () => {
                        // arrange
                        const config = {
                            fileName: testDb,
                            digest: {
                                "alert-policies": {
                                    monitor: {
                                        channels: ["console"],
                                        rules: [{ count: 2 }]
                                    }
                                },
                                channels: []
                            }
                        };
                        const alert = {
                            "exception-policy": "monitor"
                        };
                        const result = new MonitorFailureResult("web", "www.codeo.co.za", "Runtime Error", { alert });
                        evaluateMock.evaluate.mockResolvedValue([result]);

                        // act
                        await execute(config, "test");

                        // assert
                        expect(console.log).toHaveBeenCalledWith(expect.stringContaining(result.toString()));
                        expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("🚨Outage started at "));
                        expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("1 health check affected"));
                    });
                });
                describe("and then resolved", () => {
                    it("should emit resolution", async () => {
                        const config = {
                            fileName: testDb,
                            digest: {
                                "alert-policies": {
                                    monitor: {
                                        channels: ["console"],
                                        rules: [{ count: 1 }]
                                    }
                                },
                                channels: []
                            }
                        };
                        const alert = {
                            channels: ["console"],
                            "exception-policy": "monitor"
                        };
                        const fail = new MonitorFailureResult("web", "www.codeo.co.za", "Runtime Error", { alert });
                        evaluateMock.evaluate.mockResolvedValue([fail]);
                        await execute(config, "test");
                        const ok = new WebResult(new Date(), "health-check", "www.codeo.co.za", true, "200", "OK", 0, { alert });
                        evaluateMock.evaluate.mockResolvedValue([ok]);

                        // act
                        await execute(config, "test");

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
                            channels: []
                        }
                    };
                    const alert = {
                        channels: ["console"],
                        rules: [{ count: 1 }]
                    };
                    const result = new WebResult(new Date(), "health-check", "www.codeo.co.za", false, "400", "FAIL", 0, { alert });
                    evaluateMock.evaluate.mockResolvedValue([result]);

                    // act
                    await execute(config, "test");

                    // assert
                    expect(console.log).toHaveBeenCalledWith(expect.stringContaining(result.toString()));
                    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("🚨Outage started at "));
                    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("1 health check affected"));
                });
                describe("and then resolved", () => {
                    it("should emit resolution", async () => {
                        const config = {
                            fileName: testDb,
                            digest: {
                                channels: [],
                                rules: [{ count: 1 }]
                            }
                        };
                        const alert = {
                            channels: ["console"],
                            rules: [{ count: 1 }]
                        };
                        const fail = new WebResult(new Date(), "health-check", "www.codeo.co.za", false, "400", "FAIL", 0, { alert });
                        evaluateMock.evaluate.mockResolvedValue([fail]);
                        await execute(config, "test");
                        const ok = new WebResult(new Date(), "health-check", "www.codeo.co.za", true, "200", "OK", 0, { alert });
                        evaluateMock.evaluate.mockResolvedValue([ok]);

                        // act
                        await execute(config, "test");

                        // assert
                        expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Outage ended at"));
                    });
                });
            });
        });
    });
});
