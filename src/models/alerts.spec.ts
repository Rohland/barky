import { AlertState } from "./alerts";
import { toLocalTimeString } from "../lib/utility";
import { Snapshot } from "./snapshot";
import { getTestSnapshot } from "./snapshot.spec";

describe("alert", () => {
    describe("constructor", () => {
        describe("when initialised", () => {
            it("should bind all fields", async () => {
                // arrange
                const snapshot = getTestSnapshot();
                const lastFailure = {
                    date: snapshot.date,
                    result: snapshot.last_result,
                    alert: snapshot.alert,
                    resolvedDate: new Date()
                };

                // act
                const alert = new AlertState({
                    channel: "console",
                    start_date: new Date(new Date().getTime() - 1000 * 60 * 2),
                    last_alert_date: new Date(new Date().getTime() - 1000 * 60 * 2),
                    affected: JSON.stringify([["web|health|www.codeo.co.za", lastFailure]]),
                });

                // assert
                const affected = alert.affected.get("web|health|www.codeo.co.za");
                expect(affected.date).toEqual(lastFailure.date);
                expect(affected.result).toEqual(lastFailure.result);
                expect(affected.alert.getConfig()).toEqual(lastFailure.alert);
                expect(affected.resolvedDate).toEqual(lastFailure.resolvedDate);
            });
        });
    });
    describe("endTime", () => {
        describe("when called and not resolved", () => {
            it("should return null", async () => {
                // arrange
                const alert = new AlertState({ date: new Date() });

                // act
                const result = alert.endTime;

                // assert
                expect(result).toEqual(null);
            });
        });
        describe("when called and is resolved", () => {
            it("should return now", async () => {
                // arrange
                const alert = new AlertState({ date: new Date() });
                alert.resolve();

                // act
                const result = alert.endTime;

                // assert
                expect(result).toEqual(toLocalTimeString(new Date()));
            });
        });
    });
    describe("checkAndSetSnapshotsAsResolved", () => {
        describe("with current matching issues", () => {
            it("should not mark as resolved", async () => {
                // arrange
                const alert = new AlertState({ date: new Date() });
                const current = [
                    new Snapshot({
                        date: new Date(),
                        type: "web",
                        label: "health",
                        identifier: "www.codeo.co.za",
                        success: false,
                        last_result: "error",
                        alert_config: null
                    }),
                    new Snapshot({
                        date: new Date(),
                        type: "web",
                        label: "health",
                        identifier: "www.codeo2.co.za",
                        success: false,
                        last_result: "error",
                        alert_config: null
                    })
                ]
                alert.track(current);

                // act
                alert.checkAndSetSnapshotsAsResolved(current.map(x => x.uniqueId));

                // assert
                const affected = Array.from(alert.affected.values());
                expect(affected.length).toEqual(2);
                affected.forEach(x => {
                   expect(x.resolvedDate).toBeFalsy();
                });
            });
        });
        describe("with a resolved issue", () => {
            it("should mark as resolved", async () => {
                // arrange
                const alert = new AlertState({ date: new Date() });
                const current = [
                    new Snapshot({
                        date: new Date(),
                        type: "web",
                        label: "health",
                        identifier: "www.codeo.co.za",
                        success: false,
                        last_result: "error",
                        alert_config: null
                    }),
                    new Snapshot({
                        date: new Date(),
                        type: "web",
                        label: "health",
                        identifier: "www.codeo2.co.za",
                        success: false,
                        last_result: "error",
                        alert_config: null
                    })
                ]
                alert.track(current);

                // act
                alert.checkAndSetSnapshotsAsResolved([current[0].uniqueId]);

                // assert
                const affected = Array.from(alert.affected.values());
                expect(affected.length).toEqual(2);
                expect(affected[0].resolvedDate).toBeFalsy();
                expect(affected[1].resolvedDate).toBeInstanceOf(Date);
                expect(+affected[1].resolvedDate).toBeLessThanOrEqual(+new Date());
            });
        });
    });
    describe("getResolvedOrMutedSnapshotList", () => {
        describe("when provided with issues ids", () => {
            it("should return resolved ids", async () => {
                // arrange
                const alert = new AlertState({ date: new Date() });
                const current = [
                    new Snapshot({
                        date: new Date(),
                        type: "web",
                        label: "health",
                        identifier: "www.codeo.co.za",
                        success: false,
                        last_result: "error",
                        alert_config: null
                    }),
                    new Snapshot({
                        date: new Date(),
                        type: "web",
                        label: "health",
                        identifier: "www.codeo2.co.za",
                        success: false,
                        last_result: "error",
                        alert_config: null
                    })
                ]
                alert.track(current);

                // act
                const resolved = alert.getResolvedOrMutedSnapshotList([current[0].uniqueId]);

                // assert
                expect(resolved.length).toEqual(1);
                expect(resolved[0].key).toEqual({
                    type: current[1].type,
                    label: current[1].label,
                    identifier: current[1].identifier
                });
            });
        });
    });
});
