// @ts-ignore
import { importAndMock } from "../../tests/import-and-mock.js";

const mySqlMock = await importAndMock("mysql2/promise", () => {
    const original = jest.requireActual("mysql2/promise");
    const mock = {
        ...original,
        createConnection: jest.fn()
    };
    return mock;
});

import { Result } from "../models/result.js";
import { IApp } from "../models/app.js";

const { MySqlEvaluator, resolvePublicKey } = await import("./mysql.js");

describe("mysql", () => {
    describe("validateResults", () => {
        describe("when validator has no rules", () => {
            describe.each([
                [undefined],
                [null],
            ])(
                `when validator.rules is %s`,
                (rules: any) => {
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
                        expect(result.identifier).toEqual("-");
                        expect(result.result).toEqual("0");
                    });
                });
                describe("and empty not configured", () => {
                    it("should return no results", async () => {
                        const app = {
                            name: "app",
                            identifier: "id",
                            triggers: []
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
    describe("configureCachingSha2AuthForConnection", () => {
        const connection = "test-conn";
        const app = { connection } as IApp;
        const envKeys = [
            `mysql-${connection}-public-key`,
            `mysql-${connection}-allow-public-key-retrieval`,
        ];

        beforeEach(() => {
            envKeys.forEach(k => delete process.env[k]);
        });
        afterAll(() => {
            envKeys.forEach(k => delete process.env[k]);
        });

        it("should not set authPlugins when neither env var is configured", () => {
            // arrange
            const evaluator = new MySqlEvaluator({});
            const config: any = {};

            // act
            evaluator.configureCachingSha2AuthForConnection(app, config);

            // assert
            expect(config.authPlugins).toBeUndefined();
        });

        it("should install plugin when allowPublicKeyRetrieval is true", () => {
            // arrange
            process.env[`mysql-${connection}-allow-public-key-retrieval`] = "true";
            const evaluator = new MySqlEvaluator({});
            const config: any = {};

            // act
            evaluator.configureCachingSha2AuthForConnection(app, config);

            // assert
            expect(typeof config.authPlugins.caching_sha2_password).toEqual("function");
        });

        it("should install plugin with serverPublicKey when public-key is a base64 PEM", () => {
            // arrange
            const pem = "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----";
            process.env[`mysql-${connection}-public-key`] = Buffer.from(pem).toString("base64");
            const evaluator = new MySqlEvaluator({});
            const config: any = {};

            // act
            evaluator.configureCachingSha2AuthForConnection(app, config);

            // assert
            expect(typeof config.authPlugins.caching_sha2_password).toEqual("function");
        });
    });

    describe("resolvePublicKey", () => {
        it("should return undefined when value is empty", () => {
            expect(resolvePublicKey(undefined)).toBeUndefined();
            expect(resolvePublicKey("")).toBeUndefined();
        });
        it("should base64-decode the value", () => {
            const pem = "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----";
            const encoded = Buffer.from(pem).toString("base64");
            expect(resolvePublicKey(encoded)).toEqual(pem);
        });
    });

    describe("disposeConnections", () => {
        describe("with connections", () => {
            it("should destroy them and clear connections object", async () => {
                // arrange
                const mockConnection = {
                    end: jest.fn()
                };
                mySqlMock.createConnection.mockResolvedValue(mockConnection);
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
