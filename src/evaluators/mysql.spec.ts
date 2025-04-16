import { Result } from "../models/result";

const mysqlMock = {
    createConnection: jest.fn()
};
jest.doMock("mysql2/promise", () => {
    return mysqlMock;
});
import { IApp } from "../models/app";
import { MySqlEvaluator } from "./mysql";

describe("mysql", () => {
    describe("validateResults", () => {
        describe("when validator has no rules", () => {
            describe.each([
                [undefined],
                [null],
                []
            ])(`when validator.rules is %s`, (rules) => {
                it("should return ok", () => {
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
                    // @ts-ignore
                    const row = {
                        id: "123"
                    } as Result;

                    const evaluator = new MySqlEvaluator({});

                    // act
                    const result = evaluator.validateResults(app, [row]);

                    // assert
                    expect(result[0].success).toEqual(true);
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
                const evaluator = new MySqlEvaluator({});

                // act
                // @ts-ignore
                const results = evaluator.validateResults(app, [row]);

                // assert
                expect(results.length).toEqual(1);
                const result = results[0];
                expect(result.success).toEqual(true);
                expect(result.resultMsg).toEqual("OK");
                expect(result.result).toEqual(JSON.stringify({ "name": "test" }));
            });
        });
        describe("when trigger has rules", () => {
            describe("but no results", () => {
                describe("and empty configured", () => {
                    it("should return ok", async () => {
                        const app = {
                            name: "app",
                            identifier: "id",
                            triggers: [
                                {
                                    empty: "testing 123"
                                },
                            ]
                        };
                        const evaluator = new MySqlEvaluator({});

                        // act
                        // @ts-ignore
                        const results = evaluator.validateResults(app as IApp, []);
                        expect(results.length).toEqual(1);
                        const result = results[0];
                        expect(result.success).toEqual(false);
                        expect(result.resultMsg).toEqual("testing 123");
                        expect(result.identifier).toEqual("*");
                        expect(result.result).toEqual("missing");
                    });
                });
                describe("and empty not configured", () => {
                    it("should return no results", async () => {
                        const app = {
                            name: "app",
                            identifier: "id",
                            triggers: [
                            ]
                        };
                        const evaluator = new MySqlEvaluator({});

                        // act
                        // @ts-ignore
                        const results = evaluator.validateResults(app as IApp, []);
                        expect(results.length).toEqual(0);
                    });
                });
            });
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
                    // @ts-ignore
                    const row = {
                        id: "123",
                        name: "test"
                    };
                    const evaluator = new MySqlEvaluator({});

                    // act
                    // @ts-ignore
                    const results = evaluator.validateResults(app as IApp, [row]);

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
                    const evaluator = new MySqlEvaluator({});

                    // act
                    // @ts-ignore
                    const results = evaluator.validateResults(app as IApp, [row]);

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
                        const evaluator = new MySqlEvaluator({});

                        // act
                        // @ts-ignore
                        const results = evaluator.validateResults(app as IApp, [row]);

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
                    end: jest.fn()
                };
                mysqlMock.createConnection.mockResolvedValue(mockConnection);
                const evaluator = new MySqlEvaluator({});
                // @ts-ignore
                const connection = await evaluator.getConnection({});

                // act
                await evaluator.dispose();
                await evaluator.dispose();

                // assert
                expect(connection).toEqual(mockConnection);
                expect(mockConnection.end).toHaveBeenCalledTimes(1);
            });
        });
    });
});
