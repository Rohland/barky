
const mysqlMock = {
    createConnection: jest.fn()
};
jest.doMock("mysql2/promise", () => {
    return mysqlMock;
});
import { disposeConnections, getConnection, validateResults } from "./mysql";

describe("mysql", () => {
    describe("validateResults", () => {
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
                    // act and assert
                    expect(() => validateResults(app, [row])).toThrowError("trigger for app 'app' has no rules");
                });

            });
        });
        describe("when no trigger rules", () => {
            it("should return success for each row", async () => {
                // arrange
                const app = {
                    name: "app",
                    identifier: "id"
                };
                const row = {
                    id: "123",
                    name: "test"
                };

                // act
                const results = validateResults(app, [row]);

                // assert
                expect(results.length).toEqual(1);
                const result = results[0];
                expect(result.success).toEqual(true);
                expect(result.resultMsg).toEqual("OK");
                expect(result.result).toEqual(JSON.stringify({ "name": "test" }));
            });
        });
        describe("when trigger has rules", () => {
            describe("and matches a rule", () => {
                it("should evaluate that rule", async () => {
                    // arrange
                    const app = {
                        name: "app",
                        identifier: "id",
                        triggers: [
                            {
                                match: "123",
                                rules: [
                                    {
                                        expression: true,
                                        message: "specific match"
                                    }
                                ]
                            },
                            {
                                match: ".*",
                                rules: [
                                    {
                                        expression: true,
                                        message: "catch all"
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
                    const results = validateResults(app, [row]);

                    // assert
                    expect(results.length).toEqual(1);
                    const result = results[0];
                    expect(result.success).toEqual(false);
                    expect(result.resultMsg).toEqual("specific match");
                });
            });
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
                    const results = validateResults(app, [row]);

                    // assert
                    expect(results.length).toEqual(1);
                    const result = results[0];
                    expect(result.success).toEqual(true);
                    expect(result.resultMsg).toEqual("OK");
                    expect(result.result).toEqual(JSON.stringify({ "name": "test" }));
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
                        const results = validateResults(app, [row]);

                        // assert
                        expect(results.length).toEqual(1);
                        const result = results[0];
                        expect(result.success).toEqual(true);
                        expect(result.resultMsg).toEqual("OK");
                        expect(result.result).toEqual(JSON.stringify({ "value": 321 }));
                    });
                });
            });
        });
    });
    describe("disposeConnections", () => {
        describe("with connections", () => {
            it("should destroy them and clear connections object", async () => {
                // arrange
                const mockConnection = {
                    destroy: jest.fn()
                };
                mysqlMock.createConnection.mockResolvedValue(mockConnection);
                // @ts-ignore
                const connection = await getConnection({});

                // act
                disposeConnections();
                disposeConnections();

                // assert
                expect(connection).toEqual(mockConnection);
                expect(mockConnection.destroy).toHaveBeenCalledTimes(1);
            });
        });
    });
});
