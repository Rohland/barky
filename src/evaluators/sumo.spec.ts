import { findValidatorFor } from "./sumo";

describe("sumo", () => {
    describe("findValidatorFor", () => {
        describe.each([
            null,
            undefined,
            []
        ])(`when validators is %s`,
            // @ts-ignore
            (validators) => {
            it("should throw", () => {
                const app = {
                    validators
                };
                expect(() => findValidatorFor("test", app)).toThrowError("expected sumo app configuration to have validators, but did not");
            });
        });
    });
    describe("when has validators", () => {
        describe("but none match", () => {
            it("should throw", async () => {
                // arrange
                const app = {
                    validators: [
                        {
                            match: "test"
                        }
                    ]
                };

                // act
                // assert
                expect(() => findValidatorFor("abc", app)).toThrowError("expected to find one validator that matched abc but did not");
            });
        });
        describe("and one matches", () => {
            describe("but has no rules", () => {
                describe.each([
                    null,
                    undefined,
                    []
                ])(`when rules is %s`,
                    // @ts-ignore
                    (rules) => {
                    it("should throw", async () => {
                        // arrange
                        const app = {
                            validators: [
                                {
                                    match: "test",
                                    rules
                                }
                            ]
                        };

                        // act
                        // assert
                        expect(() => findValidatorFor("test", app)).toThrowError("expected to find one or more rules for validator but did not");
                    });
                });
            });
            describe("and has rules", () => {
                it("should return rules", async () => {
                    // arrange
                    const app = {
                        validators: [
                            {
                                match: "test",
                                rules: [
                                    {
                                        expression: "123"
                                    }
                                ]
                            }
                        ]
                    };

                    // act
                    const result = findValidatorFor("test", app);

                    // assert
                    expect(result).toEqual(app.validators[0].rules);
                });
            });
        });
    });
});
