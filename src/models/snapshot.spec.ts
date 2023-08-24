import { Snapshot } from "./snapshot";
import { AlertConfiguration } from "./alert_configuration";

describe("snapshot", () => {
    describe("when instantiated", () => {
        it("should parse as expected", () => {
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
            const data = JSON.parse(JSON.stringify(snapshot));

            // act
            const result = new Snapshot(data);

            // assert
            expect(result).toEqual(snapshot);
        });
    });
});
