import { AlertState } from "./alerts";
import { toLocalTimeString } from "../lib/utility";

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
});
