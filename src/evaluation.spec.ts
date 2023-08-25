import { evaluateType, getEvaluators } from "./evaluation";
import { webEvaluator } from "./evaluators/web";
import { mysqlEvaluator } from "./evaluators/mysql";
import { sumoEvaluator } from "./evaluators/sumo";
import { WebResult } from "./models/result";

describe("evaluation", () => {
    describe("getEvaluators", () => {
        describe("with no specified evaluator", () => {
            describe("and none defined", () => {
                describe.each([
                    null,
                    undefined,
                    ""
                ])(`when given %s`, (evaluators) => {
                    it("should return empty", async () => {
                        // arrange
                        // act
                        const result = getEvaluators({}, evaluators);

                        // assert
                        expect(result).toEqual([]);
                    });
                });
            });
        });
        describe("with specified evaluators", () => {
            describe("but not a supported type", () => {
                it("should throw", async () => {
                    // arrange
                    const config = {};
                    const evaluator = "test";

                    // act
                    expect(() => getEvaluators(config, evaluator)).toThrow("no evaluator found for 'test'");
                });
            });
            describe("and supported type", () => {
                describe.each([
                    ["web", "web", webEvaluator],
                    ["WEB", "web", webEvaluator],
                    ["mysql", "mysql", mysqlEvaluator],
                    [" mysql ", "mysql", mysqlEvaluator],
                    ["sumo", "sumo", sumoEvaluator],
                    ["sUMo", "sumo", sumoEvaluator],
                ])(`when given %s`, (evaluator, type, expected) => {
                    it("should return func", async () => {
                        // arrange
                        const config = {};

                        // act
                        const result = getEvaluators(config, evaluator);

                        // assert
                        expect(result[0].evaluator).toEqual(expected);
                        expect(result[0].type).toEqual(type);
                    });
                });
            });
        });
        describe("with no evaluators specified", () => {
            it("should return all defined in config file", async () => {
                // arrange
                const config = {
                    env: {
                        config: {},
                        web: {},
                        mysql: {},
                        sumo: {}
                    }
                };

                // act
                const result = getEvaluators(config, null);

                // assert
                expect(result).toEqual([
                    {
                        type: "web",
                        evaluator: webEvaluator
                    },
                    {
                        type: "mysql",
                        evaluator: mysqlEvaluator
                    },
                    {
                        type: "sumo",
                        evaluator: sumoEvaluator
                    }]);
            });
        });
    });
    describe("evaluateType", () => {
        describe("when called", () => {
            it("should execute evaluation and include ping info", async () => {
                // arrange
                const result = new WebResult(new Date(), "health", "wwww.codeo.co.za", "FAIL", "500", "500", 1, null);
                const type = {
                    type: "web",
                    evaluator: jest.fn().mockResolvedValue({
                        apps: [{}, {}],
                        results: [result]
                    })
                };
                const config = {};

                // act
                const results = await evaluateType(type, config);

                // assert
                expect(type.evaluator).toHaveBeenCalledWith(config);
                expect(results.length).toEqual(2);
                expect(results).toEqual([
                    expect.objectContaining({
                        type: "web",
                        label: "monitor",
                        identifier: "ping",
                        result: 2,
                        resultMsg: "2 evaluated",
                        success: true,
                        timeTaken: expect.any(Number),
                        alert: null
                    }),
                    result
                ])
            });
        });
    });
});
