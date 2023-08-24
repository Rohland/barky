import { getEvaluators } from "./evaluation";
import { webEvaluator } from "./evaluators/web";
import { mysqlEvaluator } from "./evaluators/mysql";
import { sumoEvaluator } from "./evaluators/sumo";

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
                    ["web", webEvaluator],
                    ["WEB", webEvaluator],
                    ["mysql", mysqlEvaluator],
                    [" mysql ", mysqlEvaluator],
                    ["sumo", sumoEvaluator],
                    ["sUMo", sumoEvaluator],
                ])(`when given %s`, (evaluator, expected) => {
                    it("should return func", async () => {
                        // arrange
                        const config = {};

                        // act
                        const result = getEvaluators(config, evaluator);

                        // assert
                        expect(result).toEqual([expected]);
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
                expect(result).toEqual([webEvaluator, mysqlEvaluator, sumoEvaluator]);
            });
        });
    });
});
