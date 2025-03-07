import { executeSumoRequest, parseMetricResults, SumoEvaluator } from "./sumo";

describe('sumo ', () => {
    describe('executeSumoRequest', () => {
        describe("when executed with success", () => {
            it("should return result", async () => {
                // arrange
                const request = jest.fn().mockResolvedValue("result");

                // act
                const result = await executeSumoRequest("test", request);

                // assert
                expect(result).toEqual("result");
                expect(request).toHaveBeenCalledTimes(1);
            });
        });
        describe("when failure", () => {
            it("should throw error", async () => {
                // arrange
                const request = jest.fn().mockRejectedValue(new Error("error"));

                // act
                let error;
                try {
                    await executeSumoRequest("test", request);
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
                const request = jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve("result"), 100)));

                // act
                const start = performance.now();
                const result = await executeSumoRequest("test", request);
                const end = performance.now();

                // assert
                expect(result).toEqual("result");
                expect(end - start).toBeGreaterThanOrEqual(95);
                expect(request).toHaveBeenCalledTimes(1);
            });
        });
        describe("when multiple requests sent", () => {
            it("should queue them and only execute 5 per second", async () => {
                // arrange
                const count = 20;
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
                const result = await Promise.all(requests.map(x => executeSumoRequest("test", x)));
                const end = performance.now();

                // assert
                expect(result).toEqual(requests.map((_x, i) => `result${ i }`));
                expect(end - start).toBeGreaterThanOrEqual(2000);
                expect(end - start).toBeLessThanOrEqual(4000);
                requests.forEach(x => expect(x).toHaveBeenCalledTimes(1));
                countPerSecond.forEach((value, _) => {
                    expect(value).toBeLessThanOrEqual(5);
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
