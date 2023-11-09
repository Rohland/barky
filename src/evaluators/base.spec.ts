import { BaseEvaluator, EvaluatorType, findTriggerRulesFor, resetExecutionCounter } from "./base";
import { IApp } from "../models/app";
import { EvaluatorResult } from "./types";
import { WebEvaluator } from "./web";
import { MySqlEvaluator } from "./mysql";
import { SumoEvaluator } from "./sumo";
import { IUniqueKey } from "../lib/key";
import { DefaultTrigger } from "../models/trigger";
import { initLocaleAndTimezone } from "../lib/utility";
import { MySqlResult, Result } from "../models/result";

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
                expect(apps1).toEqual([{ type: "custom" }]);
                expect(apps2).toEqual([{ type: "custom" }]);
                expect(apps3).toEqual([{ type: "custom" }]);
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

    describe("findTriggerRulesFor", () => {
        describe.each([
            null,
            undefined,
            []
        ])(`when trigger is %s`,
            // @ts-ignore
            (triggers) => {
                it("should return default trigger", () => {
                    const app = {
                        triggers
                    };
                    const result = findTriggerRulesFor("test", app);

                    // assert
                    expect(result).toEqual(DefaultTrigger.rules);
                });
            });
        describe("when has triggers", () => {
            describe("but none match", () => {
                it("should return default trigger rules", async () => {
                    // arrange
                    const app = {
                        triggers: [
                            {
                                match: "test",
                                rules: []
                            }
                        ]
                    };

                    // act
                    const rules = findTriggerRulesFor("abc", app);

                    // assert
                    expect(rules.length).toEqual(1);
                    expect(rules[0].expression).toEqual("false");
                });
            });
            describe("and one matches", () => {
                describe("but has no rules", () => {
                    describe.each([
                        null,
                        undefined,
                        []
                    ])(`when rules is %s`,
                        // @ts-ignore
                        (rules) => {
                            it("should return default rule", async () => {
                                // arrange
                                const app = {
                                    name: "test",
                                    triggers: [
                                        {
                                            match: "test",
                                            rules
                                        }
                                    ]
                                };

                                // act
                                const result = findTriggerRulesFor("test", app);

                                // assert
                                expect(result.length).toEqual(1);
                                expect(result[0].expression).toEqual("false");
                            });
                        });
                });
                describe("and has rules", () => {
                    it("should return rules", async () => {
                        // arrange
                        const app = {
                            triggers: [
                                {
                                    match: "test",
                                    rules: [
                                        {
                                            expression: "123",
                                            message: "test"
                                        }
                                    ]
                                }
                            ]
                        };

                        // act
                        const result = findTriggerRulesFor("test", app);

                        // assert
                        expect(result).toEqual(app.triggers[0].rules);
                    });
                });
            });
        });
        describe("when has day and time rules", () => {
            describe.each([
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", null, "01:30-02:30", true],
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", ["Sun", "Mon"], "01:30-02:30", true],
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", "Sun", "01:30-02:30", true],
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", "Mon", "01:30-02:30", false],
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", "Sun", "02:30-03:30", false],
            ])(`when date is %s, timezone is %s, day is %s and time is %s`, (date, timezone, day, time, expected) => {
                it(`should return ${ expected ? "rule" : "default rules" }`, async () => {
                    // arrange
                    initLocaleAndTimezone({
                        timezone,
                    });
                    const app = {
                        triggers: [
                            {
                                match: "test",
                                rules: [
                                    {
                                        expression: "123",
                                        message: "test",
                                        days: day,
                                        time: time
                                    }
                                ]
                            }
                        ]
                    };

                    // act
                    // @ts-ignore
                    const result = findTriggerRulesFor("test", app, new Date(date));

                    // assert
                    if (expected) {
                        expect(result).toEqual(app.triggers[0].rules);
                    } else {
                        expect(result).toEqual(DefaultTrigger.rules);
                    }
                });
            });
            describe("when one rule has date and time (and matches) and one rule has none", () => {
                it("should return both rules", async () => {
                    // arrange
                    initLocaleAndTimezone({
                        timezone: "Africa/Johannesburg"
                    });
                    const app = {
                        triggers: [
                            {
                                match: "test",
                                rules: [
                                    {
                                        expression: "123",
                                        message: "test",
                                        days: null,
                                        time: "00:00-24:00"
                                    },
                                    {
                                        expression: "321",
                                        message: "abc",
                                    }
                                ]
                            }
                        ]
                    };

                    // act
                    const result = findTriggerRulesFor("test", app);

                    // assert
                    expect(result).toEqual(app.triggers[0].rules);
                });
            });
        });
    });

    describe("evaluateApps", () => {
        class MyEval extends BaseEvaluator {

            public skipped: IApp[] = null;
            public apps: IApp[] = null;
            public results: Result[] = [];

            public addSkipped(skip) {
                this.skipped ||= [];
                this.skipped.push(skip);
            }

            public addApp(app) {
                this.apps ||= [];
                this.apps.push(app);
            }

            public addResult(result) {
                this.results.push(result);
            }

            configureAndExpandApp(_app: IApp, _name: string): IApp[] {
                return [];
            }

            public async evaluate(): Promise<EvaluatorResult> {
                return {
                    apps: this.apps,
                    results: this.results,
                    skippedApps: this.skipped
                };
            }

            public generateSkippedAppUniqueKey(name: string): IUniqueKey {
                return {
                    type: "mysql",
                    label: name,
                    identifier: "*"
                };
            }

            get type(): EvaluatorType {
                return undefined;
            }

            protected async dispose(): Promise<void> {
                return;
            }

            protected async tryEvaluate(_app: IApp): Promise<Result | Result[]> {
                return [];
            }
        }

        describe("when results are emitted", () => {
            it("should return results and no skipped", async () => {
                // arrange
                const app = {
                    type: "mysql",
                    name: "queue-performance"
                };

                const sut = new MyEval({});
                sut.addApp(app);
                const result = new MySqlResult(app.name, "my-queue", "test", "test", 0, true, app);
                sut.addResult(result);

                // act
                const results = await sut.evaluateApps();

                // assert
                expect(results.skippedApps).toEqual([]);
                expect(results.results).toEqual([result]);
            });
        });

        describe("when results are missing (presumably due to underlying error)", () => {
            it("should add skipped result to avoid failures resolving", async () => {
                // arrange
                const app = {
                    type: "mysql",
                    name: "queue-performance"
                };

                const sut = new MyEval({});
                sut.addApp(app);

                // act
                const results = await sut.evaluateApps();

                // assert
                expect(results.results).toEqual([]);
                expect(results.skippedApps.length).toEqual(1);
                const skipped = results.skippedApps[0];
                expect(skipped.type).toEqual(app.type);
                expect(skipped.label).toEqual(app.name);
                expect(skipped.identifier).toEqual("*");
            });
            describe("but if is already skipped", () => {
                it("should not add skip again", async () => {
                    // arrange
                    const app = {
                        type: "mysql",
                        name: "queue-performance"
                    };

                    const sut = new MyEval({});
                    sut.addApp(app);
                    sut.addSkipped({
                        ...app,
                        ...sut.generateSkippedAppUniqueKey(app.name)
                    });

                    // act
                    const results = await sut.evaluateApps();

                    // assert
                    expect(results.results).toEqual([]);
                    expect(results.skippedApps.length).toEqual(1);
                    const skipped = results.skippedApps[0];
                    expect(skipped.type).toEqual(app.type);
                    expect(skipped.label).toEqual(app.name);
                    expect(skipped.identifier).toEqual("*");
                });
            });
        });
    });
});

class CustomEvaluator extends BaseEvaluator {

    constructor(config) {
        super(config);
    }

    configureAndExpandApp(app: IApp, _name: string): IApp[] {
        return [app];
    }

    evaluate(): Promise<EvaluatorResult> {
        return Promise.resolve(undefined);
    }

    get type(): EvaluatorType {
        return "custom" as EvaluatorType;
    }

    protected generateSkippedAppUniqueKey(name: string): IUniqueKey {
        return {
            type: this.type,
            label: name,
            identifier: "*"
        };
    }

    protected async dispose(): Promise<void> {
        return;
    }

    protected tryEvaluate(_app: IApp): Promise<Result | Result[]> {
        return Promise.resolve(undefined);
    }

}
