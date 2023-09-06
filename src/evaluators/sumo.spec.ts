import { findTriggerRulesFor } from "./sumo";
import { DefaultTrigger } from "../models/trigger";

describe("sumo", () => {
    describe("findTriggerRulesFor", () => {
        describe.each([
            null,
            undefined,
            []
        ])(`when trigger is %s`,
            // @ts-ignore
            (triggers) => {
            it("should return default trigger", () => {
                const app = {
                    triggers
                };
                const result = findTriggerRulesFor("test", app);

                // assert
                expect(result).toEqual(DefaultTrigger.rules);
            });
        });
    });
    describe("when has triggers", () => {
        describe("but none match", () => {
            it("should throw", async () => {
                // arrange
                const app = {
                    triggers: [
                        {
                            match: "test"
                        }
                    ]
                };

                // act
                // assert
                expect(() => findTriggerRulesFor("abc", app)).toThrowError("expected to find one trigger that matched abc but did not");
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
                            triggers: [
                                {
                                    match: "test",
                                    rules
                                }
                            ]
                        };

                        // act
                        // assert
                        expect(() => findTriggerRulesFor("test", app)).toThrowError("expected to find one or more rules for trigger but did not");
                    });
                });
            });
            describe("and has rules", () => {
                it("should return rules", async () => {
                    // arrange
                    const app = {
                        triggers: [
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
                    const result = findTriggerRulesFor("test", app);

                    // assert
                    expect(result).toEqual(app.triggers[0].rules);
                });
            });
        });
    });
});
