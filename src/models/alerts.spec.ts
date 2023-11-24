import { AlertState } from "./alerts";
import { toLocalTimeString } from "../lib/utility";
import { Snapshot } from "./snapshot";

describe("alert", () => {
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
