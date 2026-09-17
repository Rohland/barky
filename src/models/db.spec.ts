import {
    addMuteWindow,
    deleteDbIfExists, deleteMuteWindowsByIds,
    destroy, getAlerts,
    getChatOpsAudit,
    getChatThread,
    getConnection,
    getLogs, getMuteWindows,
    getSnapshots,
    initConnection,
    mutateAndPersistSnapshotState, persistAlerts,
    persistResults,
    persistSnapshots,
    recordChatOpsAudit,
    recordChatThread,
    tryRecordChatEvent
} from "./db.js";
import { Result } from "./result.js";
import { Snapshot } from "./snapshot.js";
import { AlertState } from "./alerts.js";
import { AlertConfiguration, IAlertConfig } from "./alert_configuration.js";
import { getTestSnapshot } from "./snapshot.spec.js";
import knex from "knex";

describe("db", () => {

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

            async function verifyMuteWindowTableExists() {
                const results = await connection("mute_windows").select();
                expect(results).toEqual([]);
            }

            await verifyLogsTableExists();
            await verifySnapshotTableExists();
            await verifyMuteWindowTableExists();
        });
    });
    describe("if different context provided", () => {
        it("should throw", async () => {
            // arrange
            // act
            expect(() => getConnection("test")).toThrow("Sqlite connection already established with context dbtests and now requesting test");
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
                expect(snapshots[0]).toMatchObject({
                    ...newSnapshot,
                    id: 1,
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
    describe("mute-windows", () => {

        describe("getMuteWindows", () => {
            it("should return empty with none", async () => {
                const items = await getMuteWindows();
                expect(items.length).toEqual(0);
            });
            it("should clear old mute windows and avoid returning them", async () => {
                const oldWindow = {
                    match: "test",
                    from: new Date("2025-01-01"),
                    to: new Date("2025-02-01 09:00:00.000")
                };
                await addMuteWindow(oldWindow);
                const tomorrow = new Date();
                tomorrow.setHours(tomorrow.getHours()+24);
                const newWindow = {
                    match: "test",
                    from: new Date(),
                    to: tomorrow
                };
                await addMuteWindow(newWindow);
                const windows = await getMuteWindows();
                expect(windows.length).toEqual(1);
                expect(windows[0]).toMatchObject(newWindow);
            });
        });
        describe("addMuteWindow", () => {
            it("should add mute window", async () => {
                const tomorrow = new Date();
                tomorrow.setHours(tomorrow.getHours()+24);
                const window = {
                    match: "test",
                    from: new Date("2025-01-01"),
                    to: tomorrow
                };
                await addMuteWindow(window);
                const windows = await getMuteWindows();
                expect(windows.length).toEqual(1);
                expect(windows[0]).toMatchObject(window);
                expect(windows[0].id).toBeGreaterThan(0);
            });
            describe("deleteMuteWindowsByIds", () => {
                it("should delete mute windows", async () => {
                    const windows = await getMuteWindows();
                    const ids = windows.map(x => x.id);
                    const tomorrow = new Date();
                    tomorrow.setHours(tomorrow.getHours()+24);
                    const newWindow = {
                        match: "test2",
                        from: new Date(),
                        to: tomorrow
                    };
                    await addMuteWindow(newWindow);
                    await deleteMuteWindowsByIds(ids);
                    const remaining = await getMuteWindows();
                    expect(remaining.length).toEqual(1);
                    expect(remaining[0]).toMatchObject(newWindow);
                });
            });
        });
    });
    describe("chat events", () => {
        it("should only accept an event once", async () => {
            expect(await tryRecordChatEvent("C1:123.456")).toEqual(true);
            expect(await tryRecordChatEvent("C1:123.456")).toEqual(false);
            expect(await tryRecordChatEvent("C1:123.457")).toEqual(true);
        });
        describe("when recording fails for a reason other than it being a duplicate", () => {
            it("should let the message through rather than silently dropping it", async () => {
                // arrange - slack has already been acked, so a drop here is a drop for good
                await destroy();

                // act
                const result = await tryRecordChatEvent("C1:123.456");

                // assert
                expect(result).toEqual(true);

                // cleanup - the outer afterEach expects a connection it can close
                await initConnection(testDb);
            });
        });
    });

    describe("chat threads", () => {
        it("should record and return the alerts a message reported", async () => {
            // arrange
            await recordChatThread({
                channel: "C1",
                threadTs: "1700000000.000100",
                alertIds: ["web::health::a.com", "mysql::lag::db-01"]
            });

            // act
            const result = await getChatThread("C1", "1700000000.000100");

            // assert
            expect(result.alertIds).toEqual(["web::health::a.com", "mysql::lag::db-01"]);
        });
        it("should record a thread that only points at another, for a message barky reposts", async () => {
            // arrange
            await recordChatThread({
                channel: "C1",
                threadTs: "1700000000.000900",
                alertIds: [],
                pointsToTs: "1700000000.000100",
                pointsToUrl: "https://codeo.slack.com/archives/C1/p1700000000000100"
            });

            // act
            const result = await getChatThread("C1", "1700000000.000900");

            // assert
            expect(result.pointsToTs).toEqual("1700000000.000100");
            expect(result.pointsToUrl).toEqual("https://codeo.slack.com/archives/C1/p1700000000000100");
        });
        it("should leave an alert's own thread pointing at nothing", async () => {
            // arrange
            await recordChatThread({
                channel: "C1",
                threadTs: "1700000000.000100",
                alertIds: ["web::health::a.com"]
            });

            // act
            const result = await getChatThread("C1", "1700000000.000100");

            // assert
            expect(result.pointsToTs).toBeNull();
            expect(result.pointsToUrl).toBeNull();
        });
        it("should record which channel config posted it, so a reply is answered by the same one", async () => {
            // arrange
            await recordChatThread({
                channel: "C1",
                threadTs: "1700000000.000100",
                alertIds: ["mysql::lag::db-01"],
                channelName: "slack-db"
            });

            // act
            const result = await getChatThread("C1", "1700000000.000100");

            // assert
            expect(result.channelName).toEqual("slack-db");
        });
        describe("when the same message is recorded again", () => {
            it("should replace what it reports, not duplicate it", async () => {
                // arrange - the alert message is edited in place as the outage changes
                await recordChatThread({ channel: "C1", threadTs: "1.1", alertIds: ["a"] });

                // act
                await recordChatThread({ channel: "C1", threadTs: "1.1", alertIds: ["a", "b"] });

                // assert
                const result = await getChatThread("C1", "1.1");
                expect(result.alertIds).toEqual(["a", "b"]);
            });
        });
        describe("for a thread that was never recorded", () => {
            it("should return nothing", async () => {
                expect(await getChatThread("C1", "9.9")).toBeNull();
            });
        });
    });

    describe("for a database created by a version before chat ops covered several channels", () => {

        const olderDb = "dbtestsolder";

        beforeEach(async () => {
            // the outer hook already holds a connection to a current schema db
            await destroy();
            deleteDbIfExists(olderDb);
            const older = knex({
                client: "better-sqlite3",
                connection: { filename: `./db/${ olderDb }.sqlite` },
                useNullAsDefault: true
            });
            await older.schema.createTable("chat_threads", table => {
                table.string("channel");
                table.string("thread_ts");
                table.json("alert_ids");
                table.dateTime("date");
                table.primary(["channel", "thread_ts"]);
            });
            await older("chat_threads").insert({
                channel: "C_OLD",
                thread_ts: "1699999999.000100",
                alert_ids: JSON.stringify(["web::health::a.com"]),
                date: new Date().toISOString()
            });
            await older.destroy();
        });

        afterEach(async () => {
            await destroy();
            deleteDbIfExists(olderDb);
            // leave the connection as the outer hooks expect to find it
            await initConnection(testDb);
        });

        it("should keep the threads already recorded, belonging to no particular channel config", async () => {
            // act - what barky does when it starts against an existing file
            await initConnection(olderDb);

            // assert - a thread naming no channel routes a reply to the one that declared chat ops
            const existing = await getChatThread("C_OLD", "1699999999.000100");
            expect(existing.alertIds).toEqual(["web::health::a.com"]);
            expect(existing.channelName).toBeNull();
        });

        it("should add the column it needs, so threads recorded from here name the channel that posted them", async () => {
            // arrange - what barky does when it starts against an existing file
            await initConnection(olderDb);

            // act
            await recordChatThread({
                channel: "C_NEW",
                threadTs: "1700000000.000200",
                alertIds: ["mysql::lag::db-01"],
                channelName: "slack-db"
            });

            // assert
            expect((await getChatThread("C_NEW", "1700000000.000200")).channelName).toEqual("slack-db");
        });

        describe("and barky is restarted again afterwards", () => {
            it("should leave the upgraded file alone", async () => {
                // arrange
                await initConnection(olderDb);
                await destroy();

                // act
                await initConnection(olderDb);

                // assert
                expect((await getChatThread("C_OLD", "1699999999.000100")).alertIds)
                    .toEqual(["web::health::a.com"]);
            });
        });
    });

    describe("chat ops audit", () => {
        it("should record entries newest first", async () => {
            // arrange
            await recordChatOpsAudit({
                channel: "C1",
                userId: "U1",
                action: "mute",
                detail: { alerts: ["web::health::a.com"] }
            });
            await recordChatOpsAudit({
                channel: "C1",
                userId: "U2",
                action: "unmute",
                detail: { mutes: ["^web::health::a\\.com$"] }
            });

            // act
            const result = await getChatOpsAudit();

            // assert
            expect(result).toHaveLength(2);
            expect(result[0].action).toEqual("unmute");
            expect(result[0].userId).toEqual("U2");
            expect(result[1].detail.alerts).toEqual(["web::health::a.com"]);
            expect(result[1].date).toBeInstanceOf(Date);
        });
        describe("entries older than the retention period", () => {
            it("should not be returned, even when nothing new has been written", async () => {
                // arrange - pruning only happens on write, so a quiet month would otherwise leave
                // the dashboard showing entries older than the retention it promises
                await recordChatOpsAudit({ channel: "C1", userId: "U1", action: "mute", detail: {} });
                const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
                await getConnection("dbtests")("chat_ops_audit").update({ date: longAgo });

                // act
                const result = await getChatOpsAudit();

                // assert
                expect(result).toHaveLength(0);
            });
        });
        describe("when a limit is given", () => {
            it("should honour it", async () => {
                for (let i = 0; i < 5; i++) {
                    await recordChatOpsAudit({ channel: "C1", userId: "U1", action: "mute", detail: { i } });
                }
                expect(await getChatOpsAudit(2)).toHaveLength(2);
            });
        });
    });
});
