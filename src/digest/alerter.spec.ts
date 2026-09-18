import mockConsole from "jest-mock-console";
import { executeAlerts } from "./alerter.js";
import { DigestContext } from "./digest.js";
import { Result } from "../models/result.js";
import { deleteDbIfExists, destroy, getAlerts, initConnection, persistAlerts } from "../models/db.js";
import { AlertState } from "../models/alerts.js";
import { DigestConfiguration } from "../models/digest.js";
import { Snapshot } from "../models/snapshot.js";
import { getTestResult } from "../models/result.spec.js";
import { getTestSnapshot } from "../models/snapshot.spec.js";

describe("alerter", () => {

    let _restoreConsole;
    beforeEach(() => _restoreConsole = mockConsole());
    afterEach(() => _restoreConsole());

    const testDb = "alerterdb";

    beforeEach(async () => {
        deleteDbIfExists(testDb);
        await initConnection(testDb);
    });
    afterEach(async () => {
        await destroy();
        deleteDbIfExists(testDb);
    });

    describe("new alerts", () => {
        describe("when there are alerts configured with console", () => {
            it("should emit alert via console, save alert state and track affected ids", async () => {
                // arrange
                const config = new DigestConfiguration({});
                const context = new DigestContext([], []);
                const result1 = new Result(
                    new Date(),
                    "web",
                    "health",
                    "www.codeo.co.za",
                    false,
                    "FAIL",
                    0,
                    false,
                    {
                        alert: {
                            channels: ["console"]
                        }
                    }
                );
                const oneDayAgo = new Date(new Date().setDate(new Date().getDate() - 1));
                const result2 = new Result(
                    oneDayAgo,
                    "web",
                    "health",
                    "www.codeo2.co.za",
                    false,
                    "FAIL",
                    0,
                    false,
                    {
                        alert: {
                            channels: ["console"]
                        }
                    }
                );
                context.addSnapshotForResult(result1);
                context.addSnapshotForResult(result2);

                // act
                const before = new Date();
                await executeAlerts(config, context);
                const after = new Date();

                // assert
                expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Outage started at \d\d:\d\d:\d\d. 2 health checks affected./));
                const alerts = await getAlerts();
                expect(alerts.length).toBe(2);
                alerts.forEach((alert) => {
                    // stamped while alerting, so it must fall within the window we just bracketed
                    expect(+alert.last_alert_date).toBeGreaterThanOrEqual(+before);
                    expect(+alert.last_alert_date).toBeLessThanOrEqual(+after);
                    expect(Array.from(alert.affectedKeys)).toEqual([result1.uniqueId, result2.uniqueId]);
                    // check the start date is the min date of the snapshots
                    expect(alert.start_date).toEqual(oneDayAgo);
                });
            });
            describe("if first instance of failure was prior to this digest cycle", () => {
                it("should set start date to the earliest failure", async () => {
                    // arrange
                    const config = new DigestConfiguration({});
                    const previousSnapshot = getTestSnapshot();
                    const oneDayAgo = new Date(new Date().setDate(new Date().getDate() - 1));
                    previousSnapshot.date = oneDayAgo;
                    const context = new DigestContext([previousSnapshot], []);

                    const result = getTestResult();
                    context.addSnapshotForResult(result);

                    // act
                    await executeAlerts(config, context);

                    // assert
                    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Outage started at \d\d:\d\d:\d\d. 1 health check affected./));
                    const alerts = await getAlerts();
                    expect(alerts.length).toEqual(2);
                    alerts.forEach((alert) => {
                        expect(alert.start_date).toEqual(previousSnapshot.date);
                    });
                });
            });
        });
        describe("but alerts are muted", () => {
            it("should not trigger alerts", async () => {
                // arrange
                const config = new DigestConfiguration({
                    "mute-windows": [
                        {
                            match: "web",
                            time: "00:00-24:00",
                        }
                    ]
                });
                const context = new DigestContext([], []);
                const result1 = getTestResult();
                context.addSnapshotForResult(result1);

                // act
                await executeAlerts(config, context);

                // assert
                expect(console.log).not.toHaveBeenCalled();
            });
            describe("when there is another alert that is not muted", () => {
                it("should exclude muted", async () => {
                    // arrange
                    const config = new DigestConfiguration({
                        "mute-windows": [
                            {
                                match: "web",
                                time: "00:00-24:00",
                            }
                        ]
                    });
                    const context = new DigestContext([], []);
                    const result1 = getTestResult();
                    const result2 = getTestResult();
                    result2.type = "mysql";

                    context.addSnapshotForResult(result1);
                    context.addSnapshotForResult(result2);

                    // act
                    await executeAlerts(config, context);

                    // assert
                    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("1 health check affected"));
                });
            });
        });
    });
    describe("with existing alert", () => {
        describe("and is longer than last notification period", () => {
            it("should emit ongoing alert via console and save alert state", async () => {
                // arrange
                const config = new DigestConfiguration({});
                // @ts-ignore
                const previousSnapshot = new Snapshot({
                    type: "web",
                    label: "health",
                    identifier: "www.codeo.co.za",
                });
                const context = new DigestContext([previousSnapshot], []);
                const result = new Result(
                    new Date(),
                    "web",
                    "health",
                    "www.codeo.co.za",
                    false,
                    "FAIL",
                    0,
                    false,
                    {
                        alert: {
                            channels: ["console"]
                        }
                    }
                );
                context.addSnapshotForResult(result);
                const alert = new AlertState({
                    channel: "console",
                    start_date: new Date(new Date().getTime() - 1000 * 60 * 2),
                    last_alert_date: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
                    affected: JSON.stringify([[result.uniqueId, previousSnapshot]])
                });
                await persistAlerts([alert]);
                const result2 = new Result(
                    new Date(),
                    "web",
                    "health",
                    "www.codeo2.co.za",
                    false,
                    "FAIL",
                    0,
                    false,
                    {
                        alert: {
                            channels: ["console"]
                        }
                    }
                );
                context.addSnapshotForResult(result2);

                // act
                const before = new Date();
                await executeAlerts(config, context);
                const after = new Date();

                // assert
                expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Outage ongoing for \dm \(since \d\d:\d\d:\d\d\). 2 health checks affected./));
                const alerts = await getAlerts();
                expect(alerts.length).toEqual(2);
                alerts.forEach((alert) => {
                    // stamped while alerting, so it must fall within the window we just bracketed
                    expect(+alert.last_alert_date).toBeGreaterThanOrEqual(+before);
                    expect(+alert.last_alert_date).toBeLessThanOrEqual(+after);
                    expect(Array.from(alert.affectedKeys)).toEqual([result.uniqueId, result2.uniqueId]);
                });
            });
            describe("but if muted", () => {
                it("should send muted notification", async () => {
                    // arrange
                    const config = new DigestConfiguration({
                        "mute-windows": [
                            {
                                match: "web",
                                time: "00:00-24:00",
                            }
                        ]
                    });
                    // @ts-ignore
                    const previousSnapshot = new Snapshot({
                        type: "web",
                        label: "health",
                        identifier: "www.codeo.co.za",
                    });
                    const context = new DigestContext([previousSnapshot], []);
                    const result = getTestResult();
                    context.addSnapshotForResult(result);
                    const alert = new AlertState({
                        channel: "console",
                        start_date: new Date(new Date().getTime() - 1000 * 60 * 2),
                        last_alert_date: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
                        affected: JSON.stringify([[result.uniqueId, previousSnapshot]])
                    });
                    await persistAlerts([alert]);
                    const result2 = getTestResult();
                    context.addSnapshotForResult(result2);

                    // act
                    await executeAlerts(config, context);

                    // assert
                    expect(console.log).toHaveBeenCalledWith(expect.stringMatching("🔕 Outage muted at"));
                });
            });
        });
        describe("and inside notification window", () => {
            it("should not send alert", async () => {
                // arrange
                const config = new DigestConfiguration({
                    channels: {
                        console: {
                            type: "console",
                            interval: "10m"
                        }
                    }
                });
                // @ts-ignore
                const previousSnapshot = new Snapshot({
                    type: "web",
                    label: "health",
                    identifier: "www.codeo.co.za",
                });
                const context = new DigestContext([previousSnapshot], []);
                const result = new Result(
                    new Date(),
                    "web",
                    "health",
                    "www.codeo.co.za",
                    false,
                    "FAIL",
                    0,
                    false,
                    {
                        alert: {
                            channels: ["console"]
                        }
                    }
                );
                context.addSnapshotForResult(result);
                const alert = new AlertState({
                    channel: "console",
                    start_date: new Date(new Date().getTime() - 1000 * 60 * 2),
                    last_alert_date: new Date(new Date().getTime() - 1000 * 60 * 2),
                    affected: JSON.stringify([[result.uniqueId, previousSnapshot]])
                });
                await persistAlerts([alert]);

                // act
                await executeAlerts(config, context);

                // assert
                expect(console.log).not.toHaveBeenCalled();
                const alerts = await getAlerts();
                expect(alerts.length).toEqual(2);
                alerts.forEach((alert) => {
                    if (alert.channel === "console") {
                        const diff = Math.abs(+new Date() - +alert.last_alert_date);
                        expect(diff).toBeGreaterThanOrEqual(1000 * 60 * 2);
                        expect(Array.from(alert.affectedKeys)).toEqual([result.uniqueId]);
                    }
                });
            });
        });
    });
    describe("when a channel will not accept the alert", () => {

        const slackRefusal = new Error(
            "Error executing posting to slack (chat.update to C123) after 1 attempt: slack rejected the request: message_not_found");

        function configWithABrokenChannel() {
            const config = new DigestConfiguration({
                channels: {
                    "good": { type: "console" },
                    "broken": { type: "console" }
                }
            });
            const broken = config.getChannelConfig("broken");
            broken.sendNewAlert = jest.fn().mockRejectedValue(slackRefusal) as any;
            broken.sendOngoingAlert = jest.fn().mockRejectedValue(slackRefusal) as any;
            broken.pingAboutOngoingAlert = jest.fn().mockRejectedValue(slackRefusal) as any;
            return config;
        }

        function contextAlertingTo(channels: string[]) {
            const context = new DigestContext([], []);
            channels.forEach((channel, index) => {
                context.addSnapshotForResult(new Result(
                    new Date(),
                    "web",
                    "health",
                    `www.host-${ index }.com`,
                    false,
                    "FAIL",
                    0,
                    false,
                    { alert: { channels: [channel] } }));
            });
            return context;
        }

        it("should still alert the channels that will", async () => {
            // arrange - before this, one channel refusing took the whole digest down with it
            const config = configWithABrokenChannel();

            // act
            await executeAlerts(config, contextAlertingTo(["good", "broken"]));

            // assert
            expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Outage started at/));
        });

        it("should still persist the state of the channels that did accept it", async () => {
            /*
             The regression this is here for: the throw happened before persistAlerts, so nothing
             at all was recorded, the process exited, and a restart re-alerted every channel as new
             - then met the same refusal and exited again.
             */
            const config = configWithABrokenChannel();

            // act
            await executeAlerts(config, contextAlertingTo(["good", "broken"]));

            // assert
            const channels = (await getAlerts()).map(x => x.channel);
            expect(channels).toContain("good");
        });

        describe("and another channel did accept it", () => {
            it("should remember the message it posted, rather than posting a new one every pass", async () => {
                /*
                 The symptom this is here for: barky posting the same alert over and over, once per
                 evaluation loop. Writing to slack was working the whole time - what failed was the
                 run finishing. The throw came before persistAlerts, so the message barky had just
                 posted was never recorded, and the next pass saw an alert it had never announced
                 and announced it again.
                 */
                const config = new DigestConfiguration({
                    channels: {
                        "slack-ops": { type: "slack", channel: "#ops" },
                        "broken": { type: "console" }
                    }
                });
                const api = {
                    postMessage: jest.fn().mockResolvedValue({ channel: "C1", ts: "111" }),
                    updateMessage: jest.fn().mockResolvedValue({ channel: "C1", ts: "111" }),
                    deleteMessage: jest.fn()
                };
                Object.defineProperty(config.getChannelConfig("slack-ops"), "api", { get: () => api });
                const broken = config.getChannelConfig("broken");
                broken.sendNewAlert = jest.fn().mockRejectedValue(slackRefusal) as any;

                // act - two evaluation loops, the second finding the alert still failing
                await executeAlerts(config, contextAlertingTo(["slack-ops", "broken"]));
                await executeAlerts(config, contextAlertingTo(["slack-ops", "broken"]));

                // assert - announced once, then updated in place
                expect(api.postMessage).toHaveBeenCalledTimes(1);
                expect(api.updateMessage).toHaveBeenCalledTimes(1);
                const alert = (await getAlerts()).find(x => x.channel === "slack-ops");
                expect(alert.state.ts).toEqual("111");
            });
        });

        it("should say which channel it could not alert, and why", async () => {
            // arrange - said out loud, since the retry log is silent without --debug
            const config = configWithABrokenChannel();

            // act
            await executeAlerts(config, contextAlertingTo(["broken"]));

            // assert
            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining("barky could not alert 'broken'"));
            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining("message_not_found"));
        });

        it("should leave a new alert to be raised again next pass", async () => {
            // arrange
            const config = configWithABrokenChannel();

            // act
            await executeAlerts(config, contextAlertingTo(["broken"]));

            // assert - nothing reached the channel, so nothing is recorded as having reached it,
            // and the alert is raised again rather than treated as already announced
            expect((await getAlerts()).map(x => x.channel)).not.toContain("broken");
        });

        describe("and the alert is already ongoing", () => {
            it("should keep the alert, rather than losing it to the state being rewritten", async () => {
                // arrange - persistAlerts rewrites the table from what it is given, and before
                // this it was never reached at all when a channel refused
                const config = configWithABrokenChannel();
                const lastAlerted = new Date(Date.now() - 24 * 60 * 60 * 1000);
                const existing = AlertState.New("broken");
                existing.last_alert_date = lastAlerted;
                existing.track(contextAlertingTo(["broken"]).digestableSnapshots);
                await persistAlerts([existing]);

                // act
                await executeAlerts(config, contextAlertingTo(["broken"]));

                // assert - still there, and still due, so the next pass tries again
                const alert = (await getAlerts()).find(x => x.channel === "broken");
                expect(alert).not.toBeUndefined();
                expect(+alert.last_alert_date).toEqual(+lastAlerted);
            });
        });


    });

    describe("with resolving alert", () => {
        it("should send notification and be left with no alerts", async () => {
            // arrange
            const config = new DigestConfiguration({});
            // @ts-ignore
            const previousSnapshot = new Snapshot({
                type: "web",
                label: "health",
                identifier: "www.codeo.co.za",
            });
            const context = new DigestContext([previousSnapshot], []);
            const alert = new AlertState({
                channel: "console",
                start_date: new Date(new Date().getTime() - 1000 * 60 * 2),
                last_alert_date: new Date(new Date().getTime() - 1000 * 60 * 2),
                affected: JSON.stringify([["web|health|www.codeo.co.za", previousSnapshot]])
            });
            await persistAlerts([alert]);

            // act
            await executeAlerts(config, context);

            // assert
            expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Outage ended at \d\d:\d\d:\d\d\. Duration was 2m./));
            const alerts = await getAlerts();
            expect(alerts.length).toEqual(0);
        });
        describe("but if some muted", () => {
            describe("if no active alerts left", () => {
                it("should send resolved notification (as it resolved and was previously tracked)", async () => {
                    // arrange
                    const config = new DigestConfiguration({
                        "mute-windows": [
                            {
                                match: "web",
                                time: "00:00-24:00",
                            }
                        ]
                    });
                    // @ts-ignore
                    const previousSnapshot = new Snapshot({
                        type: "web",
                        label: "health",
                        identifier: "www.codeo.co.za",
                    });
                    const context = new DigestContext([previousSnapshot], []);
                    const alert = new AlertState({
                        channel: "console",
                        start_date: new Date(new Date().getTime() - 1000 * 60 * 2),
                        last_alert_date: new Date(new Date().getTime() - 1000 * 60 * 2),
                        affected: JSON.stringify([["web|health|www.codeo.co.za", previousSnapshot]])
                    });
                    await persistAlerts([alert]);

                    // act
                    await executeAlerts(config, context);

                    // assert
                    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Outage ended at "));
                    const alerts = await getAlerts();
                    expect(alerts.length).toEqual(0);
                });
            });
            describe("if some muted and some active and resolved", () => {
                it("should send resolved notification", async () => {
                    // arrange
                    const config = new DigestConfiguration({
                        "mute-windows": [
                            {
                                match: "web",
                                time: "00:00-24:00",
                            }
                        ]
                    });
                    // @ts-ignore
                    const previousWebSnapshot = new Snapshot({
                        type: "web",
                        label: "health",
                        identifier: "www.codeo.co.za",
                    });
                    // @ts-ignore
                    const previousMysqlSnapshot = new Snapshot({
                        type: "mysql",
                        label: "health",
                        identifier: "query",
                    });
                    const context = new DigestContext([previousWebSnapshot, previousMysqlSnapshot], []);
                    const alert = new AlertState({
                        channel: "console",
                        start_date: new Date(new Date().getTime() - 1000 * 60 * 2),
                        last_alert_date: new Date(new Date().getTime() - 1000 * 60 * 2),
                        affected: JSON.stringify([
                            ["web|health|www.codeo.co.za", previousWebSnapshot],
                            ["mysql|health|query", previousMysqlSnapshot]
                        ])
                    });
                    await persistAlerts([alert]);

                    // act
                    await executeAlerts(config, context);

                    // assert
                    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Outage ended at \d\d:\d\d:\d\d\. Duration was 2m./));
                    const alerts = await getAlerts();
                    expect(alerts.length).toEqual(0);
                });
            });
        });
    });
});
