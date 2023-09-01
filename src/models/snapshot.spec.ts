import { Snapshot } from "./snapshot";

describe("snapshot", () => {
    describe("when instantiated", () => {
        it("should parse as expected", () => {
            // arrange
            const snapshot = getTestSnapshot();
            const data = JSON.parse(JSON.stringify(snapshot));

            // act
            const result = new Snapshot(data);

            // assert
            expect(result).toEqual(snapshot);
        });
    });
    describe("isDigestable", () => {
        describe("when has alert channels", () => {
            it("should return true", async () => {
                // arrange
                const snapshot = getTestSnapshot();

                // act
                const digestable = snapshot.isDigestable;

                // assert
                expect(digestable).toEqual(true);
            });
        });
        describe("with no alert", () => {
            it("is not digestable", async () => {
                // arrange
                const snapshot = getTestSnapshot();
                snapshot.alert = null;

                // act
                const digestable = snapshot.isDigestable;

                // assert
                expect(digestable).toEqual(false);
            });
        });
        describe("with alert but no channels", () => {
            it("is not digestable", async () => {
                // arrange
                const snapshot = getTestSnapshot();
                snapshot.alert.channels = [];

                // act
                const digestable = snapshot.isDigestable;

                // assert
                expect(digestable).toEqual(false);
            });
        });
    });
});

export function getTestSnapshot() {
    return new Snapshot({
        id: 1,
        type: "web",
        label: "health",
        identifier: "www.codeo.co.za",
        last_result: "last_failure",
        success: false,
        date: new Date(),
        alert_config: {
            channels: ["test-channel"],
            rules: [],
            links: []
        }
    });
}
