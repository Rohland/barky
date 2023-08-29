import { BaseEvaluator, resetExecutionCounter } from "./base";
import { IApp } from "../models/app";
import { EvaluatorResult } from "./types";
import { WebEvaluator } from "./web";
import { MySqlEvaluator } from "./mysql";
import { SumoEvaluator } from "./sumo";
import { IUniqueKey } from "../lib/key";

describe("base evaluator", () => {

    beforeEach(() => resetExecutionCounter());

    describe("getAppsToEvaluate", () => {
        describe("when called", () => {
            describe.each([
                ["web", WebEvaluator],
                ["mysql", MySqlEvaluator],
                ["sumo", SumoEvaluator],
            ])(`with %s`, (type, evaluator) => {
                it("should set the type of each app", async () => {
                    // arrange
                    const app = {};
                    const config = {
                        [type]: {
                            app
                        }
                    };
                    const e = new evaluator(config);

                    // act
                    const apps = e.getAppsToEvaluate()

                    // assert
                    expect(apps.length).toEqual(1);
                    expect(apps[0].type).toEqual(type);
                });
            });
        });
    });

    describe("given an evaluator", () => {
        describe("with no every field on app", () => {
            it("should be evaluated on each invocation", async () => {
                // arrange
                const evaluator = new CustomEvaluator({
                    "custom": {
                        "app1": {}
                    }
                });

                // act
                const apps1 = evaluator.getAppsToEvaluate();
                const apps2 = evaluator.getAppsToEvaluate();
                const apps3 = evaluator.getAppsToEvaluate();

                // assert
                expect(apps1).toEqual([{type: "custom"}]);
                expect(apps2).toEqual([{type: "custom"}]);
                expect(apps3).toEqual([{type: "custom"}]);
                expect(evaluator.skippedApps).toEqual([]);
            });
        });
        describe("with every configured", () => {
            describe("if every 30s", () => {
                it("should be evaluated every time", async () => {
                    // arrange
                    const app = {
                        every: "30s"
                    };
                    const evaluator = new CustomEvaluator({
                        "custom": {
                            "app1": app
                        }
                    });

                    // act
                    const apps1 = evaluator.getAppsToEvaluate();
                    const apps2 = evaluator.getAppsToEvaluate();
                    const apps3 = evaluator.getAppsToEvaluate();

                    // assert
                    expect(apps1).toEqual([app]);
                    expect(apps2).toEqual([app]);
                    expect(apps3).toEqual([app]);
                    expect(evaluator.skippedApps).toEqual([]);
                });
            });
            describe("if every 60s", () => {
                it("should only be evaluated every 2nd invocation", async () => {
                    // arrange
                    const app = {
                        every: "60s"
                    };
                    const evaluator = new CustomEvaluator({
                        "custom": {
                            "app1": app
                        }
                    });

                    // act
                    const apps1 = evaluator.getAppsToEvaluate();
                    const apps2 = evaluator.getAppsToEvaluate();
                    const apps3 = evaluator.getAppsToEvaluate();

                    // assert
                    expect(apps1).toEqual([app]);
                    expect(apps2).toEqual([]);
                    expect(apps3).toEqual([app]);
                    expect(evaluator.skippedApps).toEqual([{
                        ...app,
                        type: "custom",
                        label: "app1",
                        identifier: "*"
                    }]);
                });
            });
            describe("if every 90s", () => {
                it("should only be evaluated every 3rd invocation", async () => {
                    // arrange
                    const app = {
                        every: "90s"
                    };
                    const evaluator = new CustomEvaluator({
                        "custom": {
                            "app1": app
                        }
                    });

                    // act
                    const apps1 = evaluator.getAppsToEvaluate();
                    const apps2 = evaluator.getAppsToEvaluate();
                    const apps3 = evaluator.getAppsToEvaluate();
                    const apps4 = evaluator.getAppsToEvaluate();

                    // assert
                    expect(apps1).toEqual([app]);
                    expect(apps2).toEqual([]);
                    expect(apps3).toEqual([]);
                    expect(apps4).toEqual([app]);
                    expect(evaluator.skippedApps).toEqual([
                        {
                            ...app,
                            type: "custom",
                            label: "app1",
                            identifier: "*"
                        },
                        {
                            ...app,
                            type: "custom",
                            label: "app1",
                            identifier: "*"
                        }]);
                });
            });
        });
    });
});

class CustomEvaluator extends BaseEvaluator {

    constructor(config) {
        super(config);
    }

    configureAndExpandApp(app: IApp, name: string): IApp[] {
        return [app];
    }

    evaluate(): Promise<EvaluatorResult> {
        return Promise.resolve(undefined);
    }

    get type(): string {
        return "custom";
    }

    protected generateSkippedAppUniqueKey(name: string): IUniqueKey {
        return {
            type: this.type,
            label: name,
            identifier: "*"
        };
    }

}
