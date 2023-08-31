import { validateRow } from "./mysql";

describe("mysql", () => {
    describe("validateRow", () => {
        describe("when validator has no rules", () => {
            describe.each([
                [undefined],
                [null],
                []
            ])(`when validator.rules is %s`, (rules) => {
                it("should throw error", () => {
                    // arrange
                    const app = {
                        name: "app",
                        identifier: "id",
                        triggers: [
                            {
                                match: ".*",
                                rules
                            }
                        ]
                    };
                    const row = {
                        id: "123"
                    };
                    const trigger = app.triggers[0];
                    // act and assert
                    expect(() => validateRow(app, "id", row, trigger)).toThrowError("trigger for app 'app' has no rules");
                });

            });
        });
        describe("when validator has rules", () => {
            describe("and success", () => {
                it("should return success with all values", async () => {
                    // arrange
                    const app = {
                        name: "app",
                        identifier: "id",
                        triggers: [
                            {
                                match: ".*",
                                rules: [
                                    {
                                        expression: false,
                                        message: "message"
                                    }
                                ]
                            }
                        ]
                    };
                    const row = {
                        id: "123",
                        name: "test"
                    };

                    // act
                    const result = validateRow(app, "id", row, app.triggers[0]);

                    // assert
                    expect(result.success).toEqual(true);
                    expect(result.resultMsg).toEqual("OK");
                    expect(result.result).toEqual(JSON.stringify({"name": "test"}));
                });
                describe("but if emit configured", () => {
                    it("should only return emitted fields", async () => {
                        // arrange
                        const app = {
                            name: "app",
                            identifier: "id",
                            emit: ["value"],
                            triggers: [
                                {
                                    match: ".*",
                                    rules: [
                                        {
                                            expression: false,
                                            message: "message",
                                        }
                                    ]
                                }
                            ]
                        };
                        const row = {
                            id: "123",
                            name: "test",
                            value: 321
                        };

                        // act
                        const result = validateRow(app, "id", row, app.triggers[0]);

                        // assert
                        expect(result.success).toEqual(true);
                        expect(result.resultMsg).toEqual("OK");
                        expect(result.result).toEqual(JSON.stringify({"value": 321}));
                    });
                });
            });
        });
    });
});
