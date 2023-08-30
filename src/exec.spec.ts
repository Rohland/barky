import mockConsole from "jest-mock-console";

const evaluateMock = jest.fn()
jest.doMock("./evaluation", () => {
    return {
        evaluate: evaluateMock
    };
});
import { configureMonitorLogsWithAlertConfiguration, execute } from "./exec";
import { MonitorFailureResult, WebResult } from "./models/result";
import { deleteDbIfExists, destroy, initConnection } from "./models/db";
import { AlertConfiguration } from "./models/alert_configuration";
import { DigestConfiguration } from "./models/digest";


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
                evaluateMock.mockResolvedValue([]);

                // act
                await execute(config, "test");

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
                            "alert-policies": {
                                monitor: {
                                    channels: ["console"]
                                }
                            },
                            channels: []
                        }
                    };
                    const alert = {
                        "exception-policy": "monitor"
                    };
                    const result = new MonitorFailureResult("web", "www.codeo.co.za", "Runtime Error", { alert });
                    evaluateMock.mockResolvedValue([result]);

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
                                        channels: ["console"]
                                    }
                                },
                                channels: []
                            }
                        };
                        const alert = {
                            "exception-policy": "abc"
                        };
                        const result = new MonitorFailureResult("web", "www.codeo.co.za", "Runtime Error", { alert });
                        evaluateMock.mockResolvedValue([result]);

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
                        evaluateMock.mockResolvedValue([result]);

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
                                        channels: ["console"]
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
                        evaluateMock.mockResolvedValue([fail]);
                        await execute(config, "test");
                        const ok = new WebResult(new Date(), "health-check", "www.codeo.co.za", true, "200", "OK", 0, { alert });
                        evaluateMock.mockResolvedValue([ok]);

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
                        channels: ["console"]
                    };
                    const result = new WebResult(new Date(), "health-check", "www.codeo.co.za", false, "400", "FAIL", 0, { alert });
                    evaluateMock.mockResolvedValue([result]);

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
                                channels: []
                            }
                        };
                        const alert = {
                            channels: ["console"]
                        };
                        const fail = new WebResult(new Date(), "health-check", "www.codeo.co.za", false, "400", "FAIL", 0, { alert });
                        evaluateMock.mockResolvedValue([fail]);
                        await execute(config, "test");
                        const ok = new WebResult(new Date(), "health-check", "www.codeo.co.za", true, "200", "OK", 0, { alert });
                        evaluateMock.mockResolvedValue([ok]);

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
