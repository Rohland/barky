import { executeSumoRequest, parseMetricResults, resetState, SumoEvaluator } from "./sumo";
import { IApp } from "../models/app";
import { getEnvVar } from "../lib/env";
jest.mock("../lib/env");

describe('sumo ', () => {
    beforeEach(() => {
        resetState();
    })
    describe('executeSumoRequest', () => {
        describe("when executed with success", () => {
            it("should return result", async () => {
                // arrange
                const secrets = { "test": "test-token"};
                (getEnvVar as jest.Mock).mockImplementation(x => secrets[x]);
                const request = jest.fn().mockResolvedValue("result");

                // act
                const result = await executeSumoRequest({ token: "test" }, request);

                // assert
                expect(getEnvVar).toHaveBeenCalledWith("test");
                expect(result).toEqual("result");
                expect(request).toHaveBeenCalledTimes(1);
                expect(request).toHaveBeenCalledWith(expect.objectContaining({
                    headers: expect.objectContaining({
                        "Authorization": "Basic " + btoa("test-token")
                    })
                }));
            });
        });
        describe("when multiple instances of tokens available", () => {
            it("should use the same token for the same app", async () => {
                // arrange
                const secrets = { "test": "test-token", "test-1": "test-token-1"};
                (getEnvVar as jest.Mock).mockImplementation(x => secrets[x]);
                const request = jest.fn().mockImplementation((config) => config.headers["Authorization"]);
                const app1 = { token: "test" };
                const app2 = { token: "test" };

                // act
                const resultA = await executeSumoRequest(app1, request);
                const resultA2 = await executeSumoRequest(app1, request);
                const resultB = await executeSumoRequest(app2, request);
                const resultB2 = await executeSumoRequest(app2, request);

                // assert
                expect(getEnvVar).toHaveBeenCalledWith("test");
                expect(getEnvVar).toHaveBeenCalledWith("test-1");
                expect(resultA2).toEqual(resultA);
                expect(resultB2).toEqual(resultB);
            });
            it("should round robin between them", async () => {
                // arrange
                const secrets = { "test": "test-token", "test-1": "test-token-1"};
                (getEnvVar as jest.Mock).mockImplementation(x => secrets[x]);
                const request = jest.fn().mockImplementation((config) => config.headers["Authorization"]);

                // act
                const result = await executeSumoRequest({ token: "test" }, request);
                const result2 = await executeSumoRequest({ token: "test" }, request);
                const result3 = await executeSumoRequest({ token: "test" }, request);

                // assert
                expect(getEnvVar).toHaveBeenCalledWith("test");
                expect(getEnvVar).toHaveBeenCalledWith("test-1");
                // tokens used for result and result 3 should be the same
                expect(result).toEqual(result3);
                expect(result2).not.toEqual(result);
                expect(request).toHaveBeenCalledTimes(3);
                expect(request).toHaveBeenCalledWith(expect.objectContaining({
                    headers: expect.objectContaining({
                        "Authorization": "Basic " + btoa("test-token")
                    })
                }));
                expect(request).toHaveBeenCalledWith(expect.objectContaining({
                    headers: expect.objectContaining({
                        "Authorization": "Basic " + btoa("test-token-1")
                    })
                }));
            });
        });
        describe("when failure", () => {
            it("should throw error", async () => {
                // arrange
                const secrets = { "test": "test-token"};
                (getEnvVar as jest.Mock).mockImplementation(x => secrets[x]);
                const request = jest.fn().mockRejectedValue(new Error("error"));

                // act
                let error;
                try {
                    await executeSumoRequest({ token: "test"}, request);
                } catch (err) {
                    error = err;
                }

                // assert
                expect(error).toEqual(new Error("error"));
                expect(request).toHaveBeenCalledTimes(1);
            });
        });
        describe("when request takes some time", () => {
            it("should wait", async () => {
                // arrange
                const secrets = { "test": "test-token"};
                (getEnvVar as jest.Mock).mockImplementation(x => secrets[x]);
                const request = jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve("result"), 100)));

                // act
                const start = performance.now();
                const result = await executeSumoRequest({ token: "test"}, request);
                const end = performance.now();

                // assert
                expect(result).toEqual("result");
                expect(end - start).toBeGreaterThanOrEqual(95);
                expect(request).toHaveBeenCalledTimes(1);
            });
        });
        describe("when multiple requests sent", () => {
            it("should queue them and only execute 4 per second", async () => {
                // arrange
                const secrets = { "test": "test-token"};
                (getEnvVar as jest.Mock).mockImplementation(x => secrets[x]);
                const count = 10;
                const requests = [];
                const countPerSecond = new Map<number, number>();
                for (let i = 0; i < count; i++) {
                    const req = jest.fn().mockImplementation(() => new Promise(resolve => {
                        const time = Math.round(performance.now() / 1000);
                        const count = countPerSecond.get(time) ?? 0;
                        countPerSecond.set(time, count + 1);
                        setTimeout(() => resolve(`result${ i }`), 100)
                    }));
                    requests.push(req);
                }

                // act
                const start = performance.now();
                const result = await Promise.all(requests.map(x => executeSumoRequest({ token: "test"}, x)));
                const end = performance.now();

                // assert
                expect(result).toEqual(requests.map((_x, i) => `result${ i }`));
                expect(end - start).toBeGreaterThanOrEqual(2500);
                expect(end - start).toBeLessThanOrEqual(3000);
                requests.forEach(x => expect(x).toHaveBeenCalledTimes(1));
                countPerSecond.forEach((value, _) => {
                    expect(value).toBeLessThanOrEqual(5);
                });
            });
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
                    const evaluator = new SumoEvaluator({});

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
                    const evaluator = new SumoEvaluator({});

                    // act
                    // @ts-ignore
                    const results = evaluator.validateResults(app as IApp, []);
                    expect(results.length).toEqual(0);
                });
            });
        });
    });

    describe("validateEntry", () => {
        it("should validate using expression and keys available", async () => {
            const sut = new SumoEvaluator({});
            const app = {
                identifier: "id",
                triggers: [
                    {
                        match: ".*",
                        rules: [
                            {
                                expression: "someKey > 0"
                            }
                        ]
                    }
                ]
            };
            const entry = {
                "id": 123,
                "someKey": 0
            }
            // @ts-ignore
            const result = sut.validateEntry(app, entry);
            expect(result.success).toBe(true);
            expect(result.result).toEqual(JSON.stringify({ someKey: 0}));
        });
        describe("with mix case keys", () => {
            it("should allow evaluation with lowercase", async () => {
                const sut = new SumoEvaluator({});
                const app = {
                    identifier: "id",
                    triggers: [
                        {
                            match: ".*",
                            rules: [
                                {
                                    expression: "somekey > 0"
                                }
                            ]
                        }
                    ]
                };
                const entry = {
                    "id": 123,
                    "someKey": 0
                }
                // @ts-ignore
                const result = sut.validateEntry(app, entry);
                expect(result.success).toBe(true);
                expect(result.result).toEqual(JSON.stringify({ someKey: 0}));
            });
        });
        describe("with emit", () => {
            it("should only emit specific values", async () => {
                const sut = new SumoEvaluator({});
                const app = {
                    identifier: "id",
                    emit: ["someKey"],
                    triggers: [
                        {
                            match: ".*",
                            rules: [
                                {
                                    expression: "someKey > 0"
                                }
                            ]
                        }
                    ]
                };
                const entry = {
                    "id": 123,
                    "someKey": 0,
                    "anotherValue": 99
                }
                // @ts-ignore
                const result = sut.validateEntry(app, entry);
                expect(result.success).toBe(true);
                expect(result.result).toEqual(JSON.stringify({ someKey: 0}));
            });
        });
    });

    describe("parseMetricResults", () => {
        describe("when executed with success", () => {
            it("should return result", () => {
                const results =
                    [
                        {
                            "metric":
                                {
                                    "dimensions":
                                        [
                                            {
                                                "key": "_collector",
                                                "value": "nomad/client-production-1740483508383"
                                            },
                                            {
                                                "key": "some.other.field",
                                                "value": "123"
                                            },
                                            {
                                                "key": "metric",
                                                "value": "avg"
                                            }
                                        ],
                                    "algoId": 1
                                },
                            "horAggs":
                                {
                                    "min": 1.3557997990486519,
                                    "max": 1.3557997990486519,
                                    "avg": 1.3557997990486519,
                                    "sum": 1.3557997990486519,
                                    "count": 1,
                                    "latest": 1.3557997990486519
                                },
                            "datapoints":
                                {
                                    "timestamp":
                                        [
                                            1741351500000
                                        ],
                                    "value":
                                        [
                                            1.3557997990486519
                                        ],
                                    "outlierParams":
                                        [
                                            {
                                                "baseline": 0,
                                                "unit": 0,
                                                "lowerBound": 0,
                                                "upperBound": 0,
                                                "isOutlier": false,
                                                "outlier": false
                                            }
                                        ],
                                    "max":
                                        [
                                            1.3557997990486519
                                        ],
                                    "min":
                                        [
                                            1.3557997990486519
                                        ],
                                    "avg":
                                        [
                                            1.3557997990486519
                                        ],
                                    "count":
                                        [
                                            1
                                        ],
                                    "isFilled":
                                        [
                                            false
                                        ]
                                }
                        },
                        {
                            "metric":
                                {
                                    "dimensions":
                                        [
                                            {
                                                "key": "_collector",
                                                "value": "nomad/client-production-1740483508347"
                                            },
                                            {
                                                "key": "metric",
                                                "value": "avg"
                                            }
                                        ],
                                    "algoId": 1
                                },
                            "horAggs":
                                {
                                    "min": 11.253610272723256,
                                    "max": 11.253610272723256,
                                    "avg": 11.253610272723256,
                                    "sum": 11.253610272723256,
                                    "count": 1,
                                    "latest": 11.253610272723256
                                },
                            "datapoints":
                                {
                                    "timestamp":
                                        [
                                            1741351500000
                                        ],
                                    "value":
                                        [
                                            11.253610272723256
                                        ],
                                    "outlierParams":
                                        [
                                            {
                                                "baseline": 0,
                                                "unit": 0,
                                                "lowerBound": 0,
                                                "upperBound": 0,
                                                "isOutlier": false,
                                                "outlier": false
                                            }
                                        ],
                                    "max":
                                        [
                                            11.253610272723256
                                        ],
                                    "min":
                                        [
                                            11.253610272723256
                                        ],
                                    "avg":
                                        [
                                            11.253610272723256
                                        ],
                                    "count":
                                        [
                                            1
                                        ],
                                    "isFilled":
                                        [
                                            false
                                        ]
                                }
                        }
                    ];
                const output = parseMetricResults(results);
                expect(output.length).toBe(2);
                const row = output[0];
                expect(row).toMatchObject({
                    "_collector": "nomad/client-production-1740483508383",
                    "some_other_field": "123",
                    "metric": "avg",
                    "min": 1.3557997990486519,
                    "max": 1.3557997990486519,
                    "avg": 1.3557997990486519,
                    "sum": 1.3557997990486519,
                    "count": 1,
                    "latest": 1.3557997990486519,
                });
            })
        })
    });
});
