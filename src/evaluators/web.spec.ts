import { getCustomHeaders, isFailureWebResult } from "./web";

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
    describe("getCustomHeaders", () => {
        describe("with none", () => {
            describe.each([
                [null],
                [undefined],
                [{}]
            ])(`when given %s`, (headers) => {
                it("should return empty", async () => {
                    // arrange
                    // act
                    const result = getCustomHeaders(headers);
                    // assert
                    expect(result).toEqual({});
                });
            });
        });
        describe("with env var", () => {
            describe("but is not set", () => {
                it("should return value", async () => {
                    // arrange
                    const headers = {
                        test: "$123"
                    };
                    // act
                    const result = getCustomHeaders(headers);

                    // assert
                    expect(result.test).toEqual("$123");
                });
            });
            describe("and is set", () => {
                it("should return env var", async () => {
                    // arrange
                    const headers = {
                        test: "$my-test-header"
                    };
                    process.env["my-test-header"] = "321";

                    // act
                    const result = getCustomHeaders(headers);

                    // assert
                    expect(result.test).toEqual("321");
                });
                describe("even when its a numeric value", () => {
                    it("should return env var", async () => {
                        // arrange
                        const headers = {
                            test: 1
                        };
                        process.env["my-test-header"] = "321";

                        // act
                        const result = getCustomHeaders(headers);

                        // assert
                        expect(result.test).toEqual(1);
                    });
                });
            });
        });
    });
});
