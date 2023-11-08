import {
    deleteDbIfExists,
    destroy, getAlerts,
    getConnection,
    getLogs,
    getSnapshots,
    initConnection,
    mutateAndPersistSnapshotState, persistAlerts,
    persistResults,
    persistSnapshots
} from "./db";
import { Result } from "./result";
import { Snapshot } from "./snapshot";
import { AlertState } from "./alerts";
import { AlertConfiguration, IAlertConfig } from "./alert_configuration";
import { getTestSnapshot } from "./snapshot.spec";

describe("persistResults", () => {

    const testDb = "dbtests";

    beforeEach(async () => {
        deleteDbIfExists(testDb);
        await initConnection(testDb);
    });
    afterEach(async () => {
        await destroy();
        deleteDbIfExists(testDb);
    });

    describe("if database does not exist", () => {
        it("should create it", async () => {
            // arrange
            // act
            await persistResults([])

            // assert
            const connection = getConnection(testDb);

            async function verifyLogsTableExists() {
                const results = await connection("logs").select();
                expect(results).toEqual([]);
            }

            async function verifySnapshotTableExists() {
                const results = await connection("snapshots").select();
                expect(results).toEqual([]);
            }

            await verifyLogsTableExists();
            await verifySnapshotTableExists();
        });
    });
    describe("persistResults", () => {
        describe("if has results", () => {
            describe.each([
                null,
                undefined,
                [{ channels: [] }],
                [{}]
            ])(`but alert digester is not configured, i.e. configured with: %s`,
                (alertDigester) => {
                    it("should not persist results", async () => {
                        // arrange
                        const result = new Result(
                            new Date(),
                            "mysql",
                            "test-label",
                            "test-identifier",
                            {},
                            "OK",
                            123,
                            true,
                            {
                                alert: alertDigester as IAlertConfig
                            }
                        );

                        // act
                        await persistResults([result]);

                        // assert
                        const connection = getConnection(testDb);
                        const rows = await connection("logs").select();
                        expect(rows.length).toEqual(0);
                    });
                });
            describe("if alert configured", () => {
                describe("and is success", () => {
                    it("should not persist it", async () => {
                        // arrange
                        const result = new Result(
                            new Date(),
                            "mysql",
                            "test-label",
                            "test-identifier",
                            {},
                            "OK",
                            123,
                            true,
                            {
                                alert: {
                                    channels: ["test-channel"],
                                }
                            }
                        );

                        // act
                        await persistResults([result]);

                        // assert
                        const rows = await getLogs();
                        expect(rows.length).toEqual(0);
                    });
                });
                describe("and is failure", () => {
                    describe("should persist it", () => {
                        it("should insert them", async () => {
                            // arrange
                            const result = new Result(
                                new Date(),
                                "mysql",
                                "test-label",
                                "test-identifier",
                                {},
                                "OK",
                                123,
                                false,
                                {
                                    alert: {
                                        channels: ["test-channel"],
                                    }
                                }
                            );

                            // act
                            await persistResults([result]);

                            // assert
                            const rows = await getLogs();
                            expect(rows.length).toEqual(1);
                        });
                    });
                });
            });
        });
    });

    describe("persistSnapshots", () => {
        describe.each([
            null,
            undefined,
            []
        ])(`with no snapshots, i.e. %s`,
            // @ts-ignore
            (snapshots) => {
                it("should not insert any", async () => {
                    // arrange
                    // act
                    await persistSnapshots(snapshots);

                    // assert
                    const rows = await getSnapshots();
                    expect(rows.length).toEqual(0);
                });
            });
        describe("with snapshots", () => {
            describe("with no alert config", () => {
                it("should persist and can be retrieved", async () => {
                    // arrange
                    const snapshot = new Snapshot({
                            date: new Date(),
                            type: "web",
                            label: "health",
                            identifier: "www.codeo.co.za",
                            success: false,
                            last_result: "test 123",
                            alert_config: null
                        }
                    );

                    // act
                    await persistSnapshots([snapshot]);

                    // assert
                    const rows = await getSnapshots();
                    expect(rows.length).toEqual(1);
                    const entry = rows[0];
                    expect(entry.id).toBeGreaterThan(0);
                    expect(entry.date).toEqual(snapshot.date);
                    expect(entry.type).toEqual(snapshot.type);
                    expect(entry.label).toEqual(snapshot.label);
                    expect(entry.identifier).toEqual(snapshot.identifier);
                    expect(entry.success).toEqual(snapshot.success);
                    expect(entry.last_result).toEqual(snapshot.last_result);
                    expect(entry.alert_config).toEqual(snapshot.alert_config);
                });
            });
            describe("with alert config", () => {
                it("should persist and can be retrieved", async () => {
                    // arrange
                    const snapshot = new Snapshot({
                            date: new Date(),
                            type: "web",
                            label: "health",
                            identifier: "www.codeo.co.za",
                            success: false,
                            last_result: "test 123",
                            alert_config: {
                                channels: ["test-channel"],
                                rules: [],
                                links: []
                            }
                        }
                    );

                    // act
                    await persistSnapshots([snapshot]);

                    // assert
                    const rows = await getSnapshots();
                    expect(rows.length).toEqual(1);
                    const entry = rows[0];
                    expect(entry.alert).toEqual(snapshot.alert);
                });
            });
        });
    });
    describe("mutateAndPersistSnapshotState", () => {
        describe("with empty data", () => {
            it("should do nothing", async () => {
                // arrange
                // act & assert
                await mutateAndPersistSnapshotState([], []);
            });
        });
        describe("with logs to delete", () => {
            it("should delete the logs", async () => {
                // arrange
                const result = new Result(
                    new Date(),
                    "web",
                    "test-label",
                    "test-identifier",
                    {},
                    "FAIL",
                    123,
                    false,
                    {
                        alert: new AlertConfiguration({ channels: ["test-channel"], rules: [] })
                    }
                );
                const result2 = new Result(
                    new Date(),
                    "mysql",
                    "test-label",
                    "test-identifier",
                    {},
                    "FAIL",
                    123,
                    false,
                    {
                        alert: new AlertConfiguration({ channels: ["test-channel"], rules: [] })
                    }
                );
                await persistResults([result, result2]);

                // pre-assert
                const logs = await getLogs();
                expect(logs.length).toEqual(2);

                // act
                await mutateAndPersistSnapshotState([], [1]);

                // assert
                const logsRemaining = await getLogs();
                expect(logsRemaining.length).toEqual(1);
                const remainingLog = logsRemaining[0];
                expect(remainingLog.type).toEqual(result2.type);
                expect(remainingLog.label).toEqual(result2.label);
                expect(remainingLog.identifier).toEqual(result2.identifier);
            });
        });
        describe("with snapshots", () => {
            it("should clear existing snapshots and save the new ones", async () => {
                // arrange
                const oldSnapshot = new Snapshot({
                        date: new Date(),
                        type: "web",
                        label: "health",
                        identifier: "www.codeo.co.za",
                        success: false,
                        last_result: "test 123",
                        alert_config: {
                            channels: ["test-channel"],
                            rules: []
                        }
                    }
                );
                await mutateAndPersistSnapshotState([oldSnapshot], []);
                const newSnapshot = new Snapshot({
                        date: new Date(),
                        type: "mysql",
                        label: "health",
                        identifier: "www.codeo.co.za",
                        success: false,
                        last_result: "test 123",
                        alert_config: {
                            channels: ["test-channel"],
                            rules: [],
                            links: []
                        }
                    }
                );

                // act
                await mutateAndPersistSnapshotState([newSnapshot], []);

                // assert
                const snapshots = await getSnapshots();
                expect(snapshots.length).toEqual(1);
                expect(snapshots[0]).toEqual({
                    id: 1,
                    ...newSnapshot
                });
            });
        });
    });
    describe("alerts", () => {
        describe("getAlertStates", () => {
            describe("when none", () => {
                it("should return empty", async () => {
                    // arrange
                    // act
                    const alerts = await getAlerts();

                    // assert
                    expect(alerts.length).toEqual(0);
                });
            });
        });
        describe("when alerts persisted with state", () => {
            it("should be able to retrieve state", async () => {
                // arrange
                const alert = AlertState.New("test");
                alert.state = { test: 123 };
                alert.track([getTestSnapshot()]);
                await persistAlerts([alert]);

                // act
                const alerts = await getAlerts();

                // assert
                expect(alerts[0].state).toEqual(alert.state);
            });
            describe("with muted", () => {
                it("should not persist", async () => {
                    // arrange
                    const alert = AlertState.New("test");
                    alert.state = { test: 123 };
                    alert.track([getTestSnapshot()]);
                    alert.setMuted();
                    await persistAlerts([alert]);

                    // act
                    const alerts = await getAlerts();

                    // assert
                    expect(alerts.length).toEqual(0)
                });
            });
            describe("with no affected", () => {
                it("should not persist", async () => {
                    // arrange
                    const alert = AlertState.New("test");
                    alert.state = { test: 123 };
                    await persistAlerts([alert]);

                    // act
                    const alerts = await getAlerts();

                    // assert
                    expect(alerts.length).toEqual(0);
                });
            });
            describe("with affected", () => {
                it("should be able to retrieve state", async () => {
                    // arrange
                    const alert = AlertState.New("test");
                    alert.state = { test: 123 };
                    alert.track([getTestSnapshot()]);
                    await persistAlerts([alert]);

                    // act
                    const alerts = await getAlerts();

                    // assert
                    const a = alerts[0];
                    expect(a.state).toEqual(alert.state);
                    expect(Array.from(a.affected)).toEqual(Array.from(alert.affected));
                });
            });
        });
    });
});
