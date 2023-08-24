import { explodeUniqueKey, uniqueKey } from "./key";

describe("unique key", () => {
    describe("uniqueKey", () => {
        it("should combine", async () => {
            // arrange
            const input = {
                type: "type",
                label: "label",
                identifier: "identifier"
            };

            // act
            const result = uniqueKey(input);

            // assert
            expect(result).toEqual("type|label|identifier");
        });
    });
    describe("explodeKey", () => {
        it("should split", async () => {
            // arrange
            const input = "type|label|identifier";

            // act
            const result = explodeUniqueKey(input);

            // assert
            expect(result).toEqual({
                type: "type",
                label: "label",
                identifier: "identifier"
            });
        });
    });
});
