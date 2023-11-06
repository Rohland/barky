import mockConsole from "jest-mock-console";
import { executeAlerts } from "./alerter";
import { DigestContext } from "./digest";
import { Result } from "../models/result";
import { deleteDbIfExists, destroy, getAlerts, initConnection, persistAlerts } from "../models/db";
import { AlertState } from "../models/alerts";
import { DigestConfiguration } from "../models/digest";
import { Snapshot } from "../models/snapshot";
import { getTestResult } from "../models/result.spec";
import { getTestSnapshot } from "../models/snapshot.spec";

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
                await executeAlerts(config, context);

                // assert
                expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Outage started at \d\d:\d\d:\d\d. 2 health checks affected./));
                const alerts = await getAlerts();
                expect(alerts.length).toEqual(1);
                const alert = alerts[0];
                const diff = Math.abs(+new Date() - +alert.last_alert_date);
                expect(diff).toBeLessThanOrEqual(100);
                expect(Array.from(alert.affectedKeys)).toEqual([result1.uniqueId, result2.uniqueId]);
                // check the start date is the min date of the snapshots
                expect(alert.start_date).toEqual(oneDayAgo);
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
                    expect(alerts.length).toEqual(1);
                    const alert = alerts[0];
                    expect(alert.start_date).toEqual(previousSnapshot.date);
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
                await executeAlerts(config, context);

                // assert
                expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Outage ongoing for \d mins \(since \d\d:\d\d:\d\d\). 2 health checks affected./));
                const alerts = await getAlerts();
                expect(alerts.length).toEqual(1);
                const diff = Math.abs(+new Date() - +alerts[0].last_alert_date);
                expect(diff).toBeLessThanOrEqual(100);
                expect(Array.from(alerts[0].affectedKeys)).toEqual([result.uniqueId, result2.uniqueId]);
            });
            describe("but if muted", () => {
                it("should not alert", async () => {
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
                    await executeAlerts(config, context);

                    // assert
                    expect(console.log).not.toHaveBeenCalled();
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
                expect(alerts.length).toEqual(1);
                const diff = Math.abs(+new Date() - +alerts[0].last_alert_date);
                expect(diff).toBeGreaterThanOrEqual(1000 * 60 * 2);
                expect(Array.from(alerts[0].affectedKeys)).toEqual([result.uniqueId]);
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
            expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Outage ended at \d\d:\d\d:\d\d\. Duration was 2 mins./));
            const alerts = await getAlerts();
            expect(alerts.length).toEqual(0);
        });
        describe("but if some muted muted", () => {
            describe("if none left", () => {
                it("should not send notification", async () => {
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
                    expect(console.log).not.toHaveBeenCalled();
                    const alerts = await getAlerts();
                    expect(alerts.length).toEqual(0);
                });
            });
            describe("if some left", () => {
                it("should send notification", async () => {
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
                    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/Outage ended at \d\d:\d\d:\d\d\. Duration was 2 mins./));
                    const alerts = await getAlerts();
                    expect(alerts.length).toEqual(0);
                });
            });
        });
    });
});
