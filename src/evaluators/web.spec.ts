import { isFailureWebResult } from "./web";

describe("web evaluator", () => {
    describe("isFailureWebResult", () => {
        describe("when no validator", () => {
            it("should return false", async () => {
                // arrange
                // act
                const result = isFailureWebResult({}, null);

                // assert
                expect(result).toEqual(false);
            });
        });
        describe("with validator", () => {
            describe("with text evaluator", () => {
                describe.each([
                    ["test 123", "TEST", false],
                    ["test 123", "test", false],
                    ["abctest 123", "test", false],
                    ["test 123", "321", true],
                    ["", "", false],
                    ["abc", "", false],
                    [null, "", false],
                    [undefined, "", false]
                ])(`when given %s and %s`, (text, validator, expected) => {
                    it(`should return ${ expected }`, async () => {
                        // arrange
                        const web = { data: text };

                        // act
                        const result = isFailureWebResult(web, {
                            text: validator
                        });

                        // assert
                        expect(result).toEqual(expected);
                    });
                });
            });
        });
    });
});
