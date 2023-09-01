import {
    DigestContext, DigestState,
    evaluateNewResult, generateDigest,
    generateResultsToEvaluate
} from "./digest";
import { Result, SkippedResult } from "../models/result";
import { MonitorLog } from "../models/log";
import { Snapshot } from "../models/snapshot";
import {
    deleteDbIfExists,
    destroy,
    getLogs,
    getSnapshots,
    initConnection,
    persistResults,
    persistSnapshots
} from "../models/db";
import { AlertConfiguration } from "../models/alert_configuration";
import mockConsole from "jest-mock-console";

describe("digest", () => {

    const testDb = "digesterdb";
    let _restoreConsole;

    beforeEach(async () => {
        _restoreConsole = mockConsole();
        deleteDbIfExists(testDb);
        await initConnection(testDb);
    });
    afterEach(async () => {
        _restoreConsole();
        await destroy();
        deleteDbIfExists(testDb);
    });

    function generateLog(id: number, date: Date = null): MonitorLog {
        return new MonitorLog({
            id: id,
            type: "web",
            label: "health",
            identifier: "www.codeo.co.za",
            date: date || new Date(),
        });
    }

    describe("evaluateNewResult", () => {
        describe("when result is failure", () => {
            describe("but no matching rules", () => {
                it("should treat as simple count rule", async () => {
                    // arrange
                    const logs = [generateLog(1), generateLog(2)] as MonitorLog[];
                    const context = new DigestContext([], logs);
                    const result = new Result(
                        new Date("2023-01-01"),
                        "web",
                        "health",
                        "www.codeo.co.za",
                        false,
                        "OK",
                        100,
                        false, {
                            alert: {
                                channels: ["test-channel"],
                                rules: []
                            }
                        });

                    // act
                    evaluateNewResult(result, context);

                    // assert
                    expect(context.logIdsToDelete).toEqual([1]);
                    expect(context.snapshots).toEqual([
                        {
                            type: result.type,
                            label: result.label,
                            identifier: result.identifier,
                            last_result: result.resultMsg,
                            success: false,
                            date: result.date,
                            alert: result.alert,
                            alert_config: result.alert.getConfig()
                        }
                    ]);
                });
            });
            describe("and type is consecutive", () => {
                describe("but does not breach rule", () => {
                    it("should keep previous logs and append no new snapshot", async () => {
                        // arrange
                        const logs = [generateLog(1), generateLog(2)] as MonitorLog[];
                        const context = new DigestContext([], logs);
                        const result = new Result(
                            new Date("2023-01-01"),
                            "web",
                            "health",
                            "www.codeo.co.za",
                            false,
                            "OK",
                            100,
                            false, {
                                alert: {
                                    channels: ["test-channel"],
                                    rules: [{ count: 3 }]
                                }
                            });

                        // act
                        evaluateNewResult(result, context);

                        // assert
                        expect(context.logIdsToDelete).toEqual([]);
                        expect(context.snapshots).toEqual([]);
                    });
                });
                describe("and breaches rule", () => {
                    it("should keep previous x logs and append new snapshot", async () => {
                        // arrange
                        const logs = [generateLog(1), generateLog(2), generateLog(3), generateLog(4)];
                        const context = new DigestContext([], logs);
                        const result = new Result(
                            new Date("2023-01-01"),
                            "web",
                            "health",
                            "www.codeo.co.za",
                            false,
                            "OK",
                            100,
                            false, {
                                alert: {
                                    channels: ["test-channel"],
                                    rules: [{ count: 2 }]
                                }
                            });

                        // act
                        evaluateNewResult(result, context);

                        // assert
                        expect(context.logIdsToDelete).toEqual([1, 2]);
                        expect(context.snapshots).toEqual([
                            {
                                type: result.type,
                                label: result.label,
                                identifier: result.identifier,
                                last_result: result.resultMsg,
                                success: false,
                                date: result.date,
                                alert: result.alert,
                                alert_config: result.alert.getConfig()
                            }
                        ]);
                    });
                    describe("if there was a previous snapshot", () => {
                        it("should retain previous snapshot date", async () => {
                            // arrange
                            const snapshot = new Snapshot({
                                id: 1,
                                type: "web",
                                label: "health",
                                identifier: "www.codeo.co.za",
                                last_result: "last_failure",
                                success: false,
                                date: new Date(),
                                alert_config: null
                            });
                            const logs = [generateLog(1), generateLog(2), generateLog(3), generateLog(4)];
                            const context = new DigestContext([snapshot], logs);
                            const result = new Result(
                                new Date("2023-01-01"),
                                "web",
                                "health",
                                "www.codeo.co.za",
                                false,
                                "OK",
                                100,
                                false, {
                                    alert: {
                                        channels: ["test-channel"],
                                        rules: [
                                            {
                                                count: 2
                                            }
                                        ]
                                    }
                                });

                            // act
                            evaluateNewResult(result, context);

                            // assert
                            expect(context.logIdsToDelete).toEqual([1, 2]);
                            expect(context.snapshots).toEqual([
                                {
                                    type: result.type,
                                    label: result.label,
                                    identifier: result.identifier,
                                    last_result: result.resultMsg,
                                    success: false,
                                    date: snapshot.date,
                                    alert: result.alert,
                                    alert_config: result.alert.getConfig()
                                }
                            ]);
                        });
                    });
                });
            });
            describe("and type is 'any in window' and window rule is not breached", () => {
                it("should delete logs older than window period", async () => {
                    // arrange
                    const logs = [
                        generateLog(1, new Date("2023-01-01")),
                        generateLog(2, new Date("2023-01-01")),
                        generateLog(3),
                    ] as MonitorLog[];
                    const context = new DigestContext([], logs);
                    const result = new Result(
                        new Date(),
                        "web",
                        "health",
                        "www.codeo.co.za",
                        false,
                        "FAIL",
                        100,
                        false,
                        {
                            alert: {
                                channels: ["test-channel"],
                                rules: [
                                    {
                                        any: 2,
                                        window: "-10m"
                                    }
                                ]
                            }
                        });

                    // act
                    evaluateNewResult(result, context);

                    // assert
                    expect(context.logIdsToDelete).toEqual([1, 2]);
                    expect(context.snapshots).toEqual([]);
                });
            });
            describe("and type is 'any in window' and window period is failure", () => {
                it("should delete logs older than window period and return snapshot", async () => {
                    // arrange
                    const snapshot = new Snapshot({
                        id: 1,
                        type: "web",
                        label: "health",
                        identifier: "www.codeo.co.za",
                        last_result: "last_failure",
                        success: false,
                        date: new Date(),
                        alert_config: null
                    });
                    const logs = [
                        generateLog(1, new Date("2023-01-01")),
                        generateLog(2, new Date("2023-01-01")),
                        generateLog(3),
                        generateLog(4)
                    ] as MonitorLog[];
                    const context = new DigestContext([snapshot], logs);
                    const result = new Result(
                        new Date(),
                        "web",
                        "health",
                        "www.codeo.co.za",
                        false,
                        "FAIL",
                        100,
                        false, {
                            alert: {
                                channels: ["test-channel"],
                                rules: [
                                    {
                                        any: 1,
                                        window: "-10m"
                                    }
                                ]
                            }
                        });

                    // act
                    evaluateNewResult(result, context);

                    // assert
                    expect(context.logIdsToDelete).toEqual([1, 2]);
                    expect(context.snapshots).toEqual([
                        {
                            type: result.type,
                            label: result.label,
                            identifier: result.identifier,
                            last_result: "FAIL",
                            success: false,
                            date: snapshot.date,
                            alert: expect.any(Object),
                            alert_config: expect.any(Object)
                        }
                    ]);
                });
            });
        });
        describe("when result is success", () => {
            describe("but no matching rules", () => {
                it("should add no snapshot and remove previous logs", async () => {
                    // arrange
                    const logs = [generateLog(1), generateLog(2)];
                    const context = new DigestContext([], logs);
                    // @ts-ignore
                    const result = new Result(
                        new Date(),
                        "web",
                        "health",
                        "www.codeo.co.za",
                        true,
                        "OK",
                        100,
                        true,
                        {
                            alert: {
                                channels: ["test-channel"],
                                rules: []
                            }
                        });

                    // act
                    evaluateNewResult(result, context);

                    // assert
                    expect(context.logIdsToDelete).toEqual([1, 2]);
                    expect(context.snapshots).toEqual([]);
                });
            });
            describe("and type is consecutive", () => {
                it("should schedule previous logs for deletion and append no new snapshot", async () => {
                    // arrange
                    const logs = [generateLog(1), generateLog(2)];
                    const context = new DigestContext([], logs);
                    const result = new Result(
                        new Date(),
                        "web",
                        "health",
                        "www.codeo.co.za",
                        true,
                        "OK",
                        100,
                        true,
                        {
                            alert: {
                                channels: ["test-channel"],
                                rules: [
                                    {
                                        count: 1
                                    }
                                ]
                            }
                        });

                    // act
                    evaluateNewResult(result, context);

                    // assert
                    expect(context.logIdsToDelete).toEqual([1, 2]);
                    expect(context.snapshots).toEqual([]);
                });
            });
            describe("and type is 'any in window' and window period is successful", () => {
                it("should delete logs older than window period", async () => {
                    // arrange
                    const logs = [
                        generateLog(1, new Date("2023-01-01")),
                        generateLog(2, new Date("2023-01-01")),
                        generateLog((3))
                    ];
                    const context = new DigestContext([], logs);
                    const result = new Result(
                        new Date(),
                        "web",
                        "health",
                        "www.codeo.co.za",
                        true,
                        "OK",
                        100,
                        true,
                        {
                            alert: {
                                channels: ["test-channel"],
                                rules: [
                                    {
                                        any: 2,
                                        window: "-10m"
                                    }
                                ]
                            }
                        });

                    // act
                    evaluateNewResult(result, context);

                    // assert
                    expect(context.logIdsToDelete).toEqual([1, 2]);
                    expect(context.snapshots).toEqual([]);
                });
            });
            describe("and type is 'any in window' and window period is failure", () => {
                it("should delete logs older than window period and return snapshot", async () => {
                    // arrange
                    const snapshot = new Snapshot({
                        id: 1,
                        type: "web",
                        label: "health",
                        identifier: "www.codeo.co.za",
                        last_result: "last_failure",
                        success: false,
                        date: new Date(),
                        alert_config: null
                    });
                    const logs = [
                        generateLog(1, new Date("2023-01-01")),
                        generateLog(2, new Date("2023-01-01")),
                        generateLog(3),
                        generateLog(4)
                    ];
                    const context = new DigestContext([snapshot], logs);
                    const result = new Result(
                        new Date(),
                        "web",
                        "health",
                        "www.codeo.co.za",
                        true,
                        "OK",
                        100,
                        true,
                        {
                            alert: {
                                channels: ["test-channel"],
                                rules: [
                                    {
                                        any: 1,
                                        window: "-10m"
                                    }
                                ]
                            }
                        });

                    // act
                    evaluateNewResult(result, context);

                    // assert
                    expect(context.logIdsToDelete).toEqual([1, 2]);
                    expect(context.snapshots).toEqual([
                        {
                            type: result.type,
                            label: result.label,
                            identifier: result.identifier,
                            last_result: "last_failure",
                            success: false,
                            date: snapshot.date,
                            alert: expect.any(Object),
                            alert_config: expect.any(Object)
                        }
                    ]);
                });
            });
        });
    });

    describe("generateResultsToEvaluate", () => {
        describe("when intersection between result set and snapshots", () => {
            it("should add and emit no new logs", async () => {
                // arrange
                const result = new Result(
                    new Date(),
                    "web",
                    "health",
                    "www.codeo.co.za",
                    false,
                    "FAIL",
                    100,
                    false,
                    null);
                const snapshot = new Snapshot({
                    id: 1,
                    type: "web",
                    label: "health",
                    identifier: "www.codeo.co.za",
                    last_result: "last_failure",
                    success: false,
                    date: new Date(),
                    alert_config: null
                });

                // act
                const output = generateResultsToEvaluate(
                    [result],
                    [snapshot]
                );

                // assert
                expect(output.length).toEqual(1);
                expect(output[0]).toEqual(result);
                expect(console.log).not.toHaveBeenCalled();
            });
        });
        describe("when no match in result set with last snapshot", () => {
            it("should generate new inferred result with success => true", async () => {
                // arrange
                const snapshot = new Snapshot({
                    id: 1,
                    type: "web",
                    label: "health",
                    identifier: "www.codeo.co.za",
                    last_result: "last_failure",
                    success: false,
                    date: new Date(),
                    alert_config: new AlertConfiguration({
                        channels: ["test-channel"],
                        rules: []
                    })
                });

                // act
                const output = generateResultsToEvaluate(
                    [],
                    [snapshot]
                );

                // assert
                const expectedResult = new Result(
                    new Date(),
                    "web",
                    "health",
                    "www.codeo.co.za",
                    true,
                    "OK (inferred)",
                    0,
                    true,
                    { alert: snapshot.alert });
                expect(output.length).toEqual(1);
                expect(output[0]).toEqual(expectedResult);
                expect(console.log).toHaveBeenCalledWith(expect.stringContaining("|OK (inferred)|"));
            });
        });
        describe("when app is skipped", () => {
            it("should not generate inferred result with success, and include skipped", async () => {
                // arrange
                const snapshot = new Snapshot({
                    id: 1,
                    type: "web",
                    label: "health",
                    identifier: "www.codeo.co.za",
                    last_result: "last_failure",
                    success: false,
                    date: new Date(),
                    alert_config: new AlertConfiguration({
                        channels: ["test-channel"],
                        rules: []
                    })
                });
                const skippedResult = new SkippedResult(new Date(), "web", "*", "www.codeo.co.za", {});

                // act
                const output = generateResultsToEvaluate(
                    [skippedResult],
                    [snapshot]
                );

                // assert
                expect(output.length).toEqual(1);
            });
        });
    });

    describe("generateDigest", () => {
        beforeEach(async () => initConnection("test"));
        afterEach(async () => {
            await destroy();
            deleteDbIfExists("test");
        });
        describe("when no results", () => {
            it("should return empty context and state OK", async () => {
                // arrange
                // act
                const context = await generateDigest([]);

                // assert
                expect(context.snapshots.length).toEqual(0);
                expect(context.state).toEqual(DigestState.OK);
            });
            describe("and has previous snapshots", () => {
                describe("and alerts all clear", () => {
                    it("should present result as outage cleared", async () => {
                        // arrange
                        await persistSnapshots([
                            new Snapshot({
                                date: new Date(),
                                type: "web",
                                label: "health",
                                identifier: "www.codeo.co.za",
                                last_result: "last_failure",
                                success: false,
                                alert_config: {
                                    channels: ["test-channel"],
                                    rules: []
                                }
                            })
                        ]);

                        // act
                        const context = await generateDigest([]);

                        // assert
                        expect(context.state).toEqual(DigestState.OutageResolved);
                    });
                });
            });
        });
        describe("when has results", () => {
            describe("and no snapshots previously", () => {
                describe("but no alerts configured", () => {
                    it("should return state == OK", async () => {
                        // arrange
                        const result = new Result(
                            new Date(),
                            "web",
                            "health",
                            "www.codeo.co.za",
                            false,
                            "FAIL",
                            100,
                            false,
                            null);

                        // act
                        const context = await generateDigest([result]);

                        // assert
                        expect(context.state).toEqual(DigestState.OK);
                        const snapshots = await getSnapshots();
                        expect(snapshots).toEqual([]);
                    });
                });
                describe("and has alerts configured", () => {
                    it("should trigger outage", async () => {
                        // arrange
                        const result = new Result(
                            new Date(),
                            "web",
                            "health",
                            "www.codeo.co.za",
                            false,
                            "FAIL",
                            100,
                            false,
                            {
                                alert: {
                                    channels: ["test-channel"],
                                    rules: [{ count: 1 }]
                                }
                            });
                        await persistResults([result]);

                        // act
                        const context = await generateDigest([result]);

                        // assert
                        expect(context.state).toEqual(DigestState.OutageTriggered);
                        const snapshots = await getSnapshots();
                        const logs = await getLogs();
                        expect(snapshots.length).toEqual(1);
                        expect(logs.length).toEqual(1);
                    });
                });
            });
            describe("and snapshots exist previously", () => {
                it("should return ongoing", async () => {
                    // arrange
                    await persistSnapshots([
                        new Snapshot({
                            date: new Date(),
                            type: "web",
                            label: "health",
                            identifier: "www.codeo.co.za",
                            last_result: "last_failure",
                            success: false,
                            alert_config: {
                                channels: ["test-channel"],
                                rules: []
                            }
                        })
                    ]);
                    const result = new Result(
                        new Date(),
                        "web",
                        "health",
                        "www.codeo.co.za",
                        false,
                        "FAIL",
                        100,
                        false,
                        {
                            alert: {
                                channels: ["test-channel"],
                                rules: [{ count: 1 }]
                            }
                        });
                    await persistResults([result]);

                    // act
                    const context = await generateDigest([result]);

                    // assert
                    expect(context.state).toEqual(DigestState.OutageOngoing);
                    const snapshots = await getSnapshots();
                    const logs = await getLogs();
                    expect(snapshots.length).toEqual(1);
                    expect(logs.length).toEqual(1);
                });
                describe("if new result is missing (i.e. no result)", () => {
                    it("should infer OK and resolve", async () => {
                        // arrange
                        await persistSnapshots([
                            new Snapshot({
                                date: new Date(),
                                type: "web",
                                label: "health",
                                identifier: "www.codeo.co.za",
                                last_result: "last_failure",
                                success: false,
                                alert_config: {
                                    channels: ["test-channel"],
                                    rules: [{ count: 1 }]
                                }
                            })
                        ]);

                        // act
                        const context = await generateDigest([]);

                        // assert
                        expect(context.state).toEqual(DigestState.OutageResolved);
                        const snapshots = await getSnapshots();
                        const logs = await getLogs();
                        expect(snapshots.length).toEqual(0);
                        expect(logs.length).toEqual(0);
                    });
                    describe("however if result is skipped", () => {
                        it("should keep previous snapshot and infer ongoing", async () => {
                            // arrange
                            const alert =  {
                                channels: ["test-channel"],
                                rules: [{ count: 1 }]
                            };
                            const app = { alert };
                            await persistSnapshots([
                                new Snapshot({
                                    date: new Date(),
                                    type: "web",
                                    label: "health",
                                    identifier: "www.codeo.co.za",
                                    last_result: "last_failure",
                                    success: false,
                                    alert_config: alert
                                })
                            ]);
                            const result = new SkippedResult(new Date(), "web", "*", "www.codeo.co.za", app);

                            // act
                            const context = await generateDigest([result]);

                            // assert
                            expect(context.state).toEqual(DigestState.OutageOngoing);
                            const snapshots = await getSnapshots();
                            expect(snapshots.length).toEqual(1);
                        });
                    });
                });
                describe("even if one alert resolved and a new one appears", () => {
                    it("should indicate ongoing", async () => {
                        // arrange
                        await persistSnapshots([
                            new Snapshot({
                                date: new Date(),
                                type: "web",
                                label: "health",
                                identifier: "www.codeo.co.za",
                                last_result: "last_failure",
                                success: false,
                                alert_config: {
                                    channels: ["test-channel"],
                                    rules: []
                                }
                            })
                        ]);
                        const result = new Result(
                            new Date(),
                            "mysql",
                            "health",
                            "www.codeo.co.za",
                            false,
                            "FAIL",
                            100,
                            false,
                            {
                                alert: {
                                    channels: ["test-channel"],
                                    rules: [{ count: 1 }]
                                }
                            });
                        await persistResults([result]);

                        // act
                        const context = await generateDigest([result]);

                        // assert
                        expect(context.state).toEqual(DigestState.OutageOngoing);
                        const snapshots = await getSnapshots();
                        const logs = await getLogs();
                        expect(snapshots.length).toEqual(1);
                        expect(logs.length).toEqual(1);
                    });
                });
            });
        });
    });
});
