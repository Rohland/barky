import { evaluateType, getEvaluators } from "./evaluation";
import { WebResult } from "./models/result";
import { WebEvaluator } from "./evaluators/web";
import { MySqlEvaluator } from "./evaluators/mysql";
import { SumoEvaluator } from "./evaluators/sumo";

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
                    ["web", "web", WebEvaluator],
                    ["WEB", "web", WebEvaluator],
                    ["mysql", "mysql", MySqlEvaluator],
                    [" mysql ", "mysql", MySqlEvaluator],
                    ["sumo", "sumo", SumoEvaluator],
                    ["sUMo", "sumo", SumoEvaluator],
                ])(`when given %s`, (evaluator, type, expected) => {
                    it("should return func", async () => {
                        // arrange
                        const config = {
                            env: {
                                web: { test: "web" },
                                mysql: { test: "mysql" },
                                sumo: { test: "sumo" },
                            }
                        };

                        // act
                        const result = getEvaluators(config, evaluator);

                        // assert
                        const e = result[0];
                        expect(e.config).toEqual(config.env[e.type]);
                        expect(e.type).toEqual(type);
                        expect(e).toBeInstanceOf(expected);
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
                    new WebEvaluator(config.env),
                    new MySqlEvaluator(config.env),
                    new SumoEvaluator(config.env)
                ]);
            });
        });
    });
    describe("evaluateType", () => {
        describe("when called", () => {
            it("should execute evaluation and include ping info", async () => {
                // arrange
                const result = new WebResult(new Date(), "health", "wwww.codeo.co.za", "FAIL", "500", "500", 1, null);
                const type = new WebEvaluator({});
                type.evaluate = jest.fn().mockResolvedValue({
                    apps: [{}, {}],
                    results: [result]
                });

                // act
                // @ts-ignore
                const results = await evaluateType(type);

                // assert
                expect(type.evaluate).toHaveBeenCalledTimes(1);
                expect(results.length).toEqual(2);
                expect(results[0]).toMatchObject({
                    type: "web",
                    label: "monitor",
                    identifier: "ping",
                    result: 2,
                    resultMsg: "2 evaluated",
                    success: true,
                    timeTaken: expect.any(Number),
                    alert: null
                });
                expect(results[1]).toEqual(result);
            });
        });
        describe("if there are skipped apps", () => {
            it("should emit results for them as skipped", async () => {
                // arrange
                const app = {
                    every: "60s"
                };
                const type = new WebEvaluator({
                    "web": {
                        "test": app
                    }
                });
                type.evaluate = jest.fn().mockImplementation(() => {
                    type.getAppsToEvaluate();
                    return {
                        apps: [],
                        results: [],
                    };
                });

                // act
                await evaluateType(type);
                const results = await evaluateType(type);

                // assert
                expect(results.length).toEqual(2);
                expect(results[0]).toMatchObject({
                    type: "web",
                    label: "monitor",
                    identifier: "ping",
                    result: 0,
                    resultMsg: "0 evaluated",
                    success: true,
                    timeTaken: expect.any(Number),
                    alert: null
                });
                expect(results[1]).toMatchObject({
                    type: "web",
                    label: "*",
                    identifier: "test",
                    result: 1,
                    timeTaken: 0,
                    resultMsg: "Skipped",
                    app: app,
                    alert: null,
                    success: true
                });
            });
        });
    });
});
