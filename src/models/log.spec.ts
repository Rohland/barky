import { MonitorLog } from "./log";

describe("monitorlog", () => {
    describe("when creating", () => {
        it("should specify date field as type date", async () => {
            // arrange
            // act
            const log = new MonitorLog({
                date: "2023-01-01"
            });

            // assert
            expect(log.date.toISOString()).toBeTruthy();
        });
    });
});
