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
import { ShellEvaluator } from "./shell";

describe("base evaluator", () => {

    beforeEach(() => resetExecutionCounter());

    describe("getAppsToEvaluate", () => {
        describe("when called", () => {
            describe.each([
                ["web", WebEvaluator],
                ["mysql", MySqlEvaluator],
                ["sumo", SumoEvaluator],
                ["shell", ShellEvaluator]
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
        describe("when app is missing name", () => {
            it("should use inferred name by key", async () => {
                // arrange
                const myApp = {};
                const config = {
                    ["web"]: {
                        myApp
                    }
                };
                const e = new WebEvaluator(config);

                // act
                const apps = e.getAppsToEvaluate()

                // assert
                expect(apps.length).toEqual(1);
                expect(apps[0].name).toEqual("myApp");
            });
        });
        describe("when app is not missing name", () => {
            it("should use name", async () => {
                // arrange
                const myApp = {
                    name: "test"
                };
                const config = {
                    ["web"]: {
                        myApp
                    }
                };
                const e = new WebEvaluator(config);

                // act
                const apps = e.getAppsToEvaluate()

                // assert
                expect(apps.length).toEqual(1);
                expect(apps[0].name).toEqual("test");
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
                expect(apps1).toEqual([{ type: "custom", name: "app1", timeout: 10000, variation: [null] }]);
                expect(apps2).toEqual([{ type: "custom", name: "app1", timeout: 10000, variation: [null] }]);
                expect(apps3).toEqual([{ type: "custom", name: "app1", timeout: 10000, variation: [null] }]);
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
                    expect(apps1).toMatchObject([app]);
                    expect(apps2).toMatchObject([app]);
                    expect(apps3).toMatchObject([app]);
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
                    expect(apps1).toMatchObject([app]);
                    expect(apps2).toMatchObject([]);
                    expect(apps3).toMatchObject([app]);
                    expect(evaluator.skippedApps).toMatchObject([
                        {
                            ...app,
                            type: "custom",
                            label: "app1",
                            identifier: "*"
                        },
                        {
                            ...app,
                            type: "custom",
                            label: "monitor",
                            identifier: "app1"
                        }
                    ]);
                });
                describe("with variations", () => {
                    it("should ensure that every count evaluates all", async () => {
                        // arrange
                        const app = {
                            every: "60s",
                            "vary-by": ["a", "b"]
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
                        const first = structuredClone(app);
                        // @ts-ignore
                        first.variation = ["a"];
                        const second = structuredClone(app);
                        // @ts-ignore
                        second.variation = ["b"];
                        expect(apps1).toMatchObject([first, second]);
                        expect(apps2).toMatchObject([]);
                        expect(apps3).toMatchObject([first, second]);
                        expect(evaluator.skippedApps).toMatchObject([
                            {
                                ...app,
                                type: "custom",
                                label: "app1",
                                identifier: "*"
                            },
                            {
                                ...app,
                                type: "custom",
                                label: "monitor",
                                identifier: "app1"
                            }
                        ]);
                    });
                });
            });
            describe("if every 5m", () => {
                it("should only be evaluated every 10th invocation", async () => {
                    // arrange
                    const app = {
                        every: "5m"
                    };
                    const evaluator = new CustomEvaluator({
                        "custom": {
                            "app1": app
                        }
                    });

                    // act
                    const calls = 10;
                    const results = [];
                    for (let i = 0; i <= calls; i++) {
                        results.push(evaluator.getAppsToEvaluate());
                    }

                    // assert
                    expect(results[0]).toMatchObject([app]);
                    for (let i = 1; i < calls; i++) {
                        expect(results[i]).toMatchObject([]);
                    }
                    expect(results[10]).toMatchObject([app])
                    expect(evaluator.skippedApps.length).toEqual(2);
                    expect(evaluator.skippedApps.filter(x => x.type === "custom" && x.label === "app1" && x.identifier === "*").length).toEqual(1);
                    expect(evaluator.skippedApps.filter(x => x.type === "custom" && x.label === "monitor" && x.identifier === "app1").length).toEqual(1);
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
                it(`should return ${expected ? "rule" : "default rules"}`, async () => {
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

            public configureApp(_app: IApp): void {
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

            public async dispose(): Promise<void> {
                return;
            }

            protected async tryEvaluate(_app: IApp): Promise<Result | Result[]> {
                return [];
            }

            protected isResultForApp(app: IApp, result: Result): boolean {
                return app.name === result.label;
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
            describe("if the results have duplicate identifiers", () => {
                it("should add a numeric postfix to make the name unique", async () => {
                    // arrange
                    const app = {
                        type: "mysql",
                        name: "queue-performance"
                    };

                    const sut = new MyEval({});
                    sut.addApp(app);
                    sut.addResult(new MySqlResult(app.name, "my-queue", "test", "test", 0, true, app));
                    sut.addResult(new MySqlResult(app.name, "my-queue", "test", "test", 0, true, app))
                    sut.addResult(new MySqlResult(app.name, "my-queue", "test", "test", 0, true, app))

                    // act
                    const results = await sut.evaluateApps();

                    // assert
                    expect(results.skippedApps).toEqual([]);
                    expect(results.results.length).toEqual(3);
                    expect(results.results[0].identifier).toEqual("my-queue");
                    expect(results.results[1].identifier).toEqual("my-queue-1");
                    expect(results.results[2].identifier).toEqual("my-queue-2");
                });
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
        describe('generateVariablesAndValues', () => {
            it('should emit all non-identifier fields when app.emit is undefined', () => {
                const sut = new MyEval({});
                const row = { identifier: 1, a: 2, b: 3 };
                const app = {};
                const { variables, values, emit } = sut.generateVariablesAndValues(row, app);

                expect(variables).toEqual(['identifier', 'a', 'b', '_context']);
                expect(values).toEqual({
                    identifier: 1,
                    a: 2,
                    b: 3,
                    _context: {}
                });
                expect(emit).toEqual({ a: 2, b: 3 });
            });

            it('should only emit specified fields when app.emit is provided', () => {
                const sut = new MyEval({});
                const row = { id: 1, name: 'foo', age: 30 };
                const app = { emit: ['name'] };
                const { variables, values, emit } = sut.generateVariablesAndValues(row, app);

                expect(variables).toEqual(['id', 'name', 'age', '_context']);
                expect(values).toEqual({
                    id: 1,
                    name: 'foo',
                    age: 30,
                    _context: { emit: ['name'] }
                });
                expect(emit).toEqual({ name: 'foo' });
            });

            it('should use custom identifier key (string) and exclude it from emit', () => {
                const sut = new MyEval({});
                const row = { id: 10, a: 20, b: 30 };
                const app = { identifier: 'id' };
                const { variables, values, emit } = sut.generateVariablesAndValues(row, app);

                expect(variables).toEqual(['id', 'a', 'b', '_context']);
                expect(values).toEqual({
                    id: 10,
                    a: 20,
                    b: 30,
                    _context: { identifier: 'id' }
                });
                expect(emit).toEqual({ a: 20, b: 30 });
            });

            it('should use multiple identifier keys (array) and exclude them from emit', () => {
                const sut = new MyEval({});
                const row = { id: 5, uid: 999, x: 1, y: 2 };
                const app = { identifier: ['id', 'uid'] };
                const { variables, values, emit } = sut.generateVariablesAndValues(row, app);

                expect(variables).toEqual(['id', 'uid', 'x', 'y', '_context']);
                expect(values).toEqual({
                    id: 5,
                    uid: 999,
                    x: 1,
                    y: 2,
                    _context: { identifier: ['id', 'uid'] }
                });
                expect(emit).toEqual({ x: 1, y: 2 });
            });

            it('should include identifier if included in app.emit list', () => {
                const sut = new MyEval({});
                const row = { identifier: 'abc', foo: 'bar' };
                const app = { emit: ['identifier', 'foo'] };
                const { variables, values, emit } = sut.generateVariablesAndValues(row, app);

                expect(variables).toEqual(['identifier', 'foo', '_context']);
                expect(values).toEqual({
                    identifier: 'abc',
                    foo: 'bar',
                    _context: { emit: ['identifier', 'foo'] }
                });
                expect(emit).toEqual({ foo: 'bar', identifier: 'abc' });
            });

            it('should include only non-private app properties in _context', () => {
                const sut = new MyEval({});
                const row = { a: 1 };
                const app = { foo: 'bar', _secret: 'shh' };
                const { variables, values, emit } = sut.generateVariablesAndValues(row, app);

                expect(variables).toEqual(['a', '_context']);
                expect(values).toEqual({
                    a: 1,
                    _context: { foo: 'bar' }
                });
                expect(emit).toEqual({ a: 1 });
            });

            it('should handle an empty row object', () => {
                const sut = new MyEval({});
                const row: any = {};
                const app = {};
                const { variables, values, emit } = sut.generateVariablesAndValues(row, app);

                expect(variables).toEqual(['_context']);
                expect(values).toEqual({ _context: {} });
                expect(emit).toEqual({});
            });
        });
    });

    describe("fillMissing", () => {
        describe("with no fill", () => {
            it("should be a no-op", async () => {
                const app = {
                    name: "codeo.co.za",
                };
                const e = new CustomEvaluator({});
                const entries = [];
                e.fillMissing(app, entries);
                expect(entries.length).toEqual(0);
            });
        });
        describe("with fill but row has value", () => {
            it("should do nothing", async () => {
                const app = {
                    name: "codeo.co.za",
                    identifier: "server",
                    fill: [
                        {
                            identifier: "server-a",
                            value: "123"
                        }
                    ]
                };
                const e = new CustomEvaluator({});
                const entries = [{ "server": "server-a", value: "0" }];
                e.fillMissing(app, entries);
                expect(entries.length).toEqual(1);
                expect(entries[0].value).toEqual("0");
            });
            describe("with array identifier", () => {
                it("still does nothing", async () => {
                    const app = {
                        name: "codeo.co.za",
                        identifier: ["server", "host"],
                        fill: [
                            {
                                identifier: ["server-a", "host-a"],
                                value: "123"
                            }
                        ]
                    };
                    const e = new CustomEvaluator({});
                    const entries = [{ "server": "server-a", "host": "host-a", value: "0" }];
                    e.fillMissing(app, entries);
                    expect(entries.length).toEqual(1);
                    expect(entries[0].value).toEqual("0");
                });
            });
        });
        describe("with fill and row not found", () => {
            it("should add the missing row", async () => {
                const app = {
                    name: "codeo.co.za",
                    identifier: "server",
                    fill: [
                        {
                            identifier: "server-a",
                            value: "123"
                        }
                    ]
                };
                const e = new CustomEvaluator({});
                const entries = [{ "server": "server-b", value: "0" }];
                e.fillMissing(app, entries);
                expect(entries.length).toEqual(2);
                expect(entries[1].server).toEqual("server-a");
                expect(entries[1].value).toEqual("123");
            });
            describe("and with array", () => {
                it("should add the missing row", async () => {
                    const app = {
                        name: "codeo.co.za",
                        identifier: ["server", "host"],
                        fill: [
                            {
                                identifier: ["server-a", "host-a"],
                                value: "123"
                            }
                        ]
                    };
                    const e = new CustomEvaluator({});
                    const entries = [{ "server": "server-b", "host": "host-b", value: "0" }];
                    e.fillMissing(app, entries);
                    expect(entries.length).toEqual(2);
                    expect(entries[1].server).toEqual("server-a");
                    expect(entries[1].host).toEqual("host-a");
                    expect(entries[1].value).toEqual("123");
                });
            });
        });
    });

    describe("getVariations", () => {
        describe("with no vary-by", () => {
            describe.each([
                [null],
                [undefined],
                [],
                [""]
            ])(`when given %s`, (varyBy) => {
                it("should return app as is", async () => {
                    // arrange
                    const app = {
                        name: "codeo.co.za",
                        url: "https://www.codeo.co.za",
                        "vary-by": varyBy
                    };
                    const e = new CustomEvaluator({});

                    // act
                    const result = e.getAppVariations(app);

                    // assert
                    expect(result).toEqual([{
                        name: "codeo.co.za",
                        url: "https://www.codeo.co.za",
                        "vary-by": varyBy,
                        "variation": [null]
                    }]);
                });
            });
            describe("with app name", () => {
                it("should keep it", async () => {
                    // arrange
                    const app = {
                        name: "test",
                        url: "https://www.codeo.co.za",
                    };
                    const e = new CustomEvaluator({});

                    // act
                    const result = e.getAppVariations(app);

                    // assert
                    expect(result).toMatchObject([{
                        name: "test",
                        url: "https://www.codeo.co.za",
                        "variation": [null]
                    }]);
                });
            });
            describe("with vary-by", () => {
                describe("names", () => {
                    describe.each([
                        [null, "codeo", ["codeo"]],
                        [undefined, "codeo", ["codeo"]],
                        [[], "codeo", ["codeo"]],
                        [["a"], "codeo-$1", ["codeo-a"]],
                        [["a", "b"], "codeo-$1", ["codeo-a", "codeo-b"]],
                        [[["a", "b"]], "codeo-$1-$2", ["codeo-a-b"]],
                    ])(`when given %s`, (varyBy, name, expected) => {
                        it("should return variant names", async () => {
                            const app = {
                                "vary-by": varyBy,
                                name
                            };
                            const e = new CustomEvaluator({});

                            // act
                            const result = e.getAppVariations(app);

                            // assert
                            const expectedResults = expected.map((x, index) => ({
                                name: x,
                                "vary-by": varyBy,
                                "variation": varyBy?.length > 0 ? [varyBy[index]].flat() : [null]
                            }));
                            expect(result).toEqual(expectedResults);
                        });
                    });
                });
                describe("urls", () => {
                    describe.each([
                        [null, "www.codeo.co.za/$1", ["www.codeo.co.za/$1"]],
                        [undefined, "www.codeo.co.za/$1", ["www.codeo.co.za/$1"]],
                        [[], "www.codeo.co.za/$1", ["www.codeo.co.za/$1"]],
                        [["a"], "www.codeo.co.za/$1", ["www.codeo.co.za/a"]],
                        [["a", "b"], "www.codeo.co.za/$1", ["www.codeo.co.za/a", "www.codeo.co.za/b"]],
                        [["a", "b"], "www.codeo.co.za/$1/$2", ["www.codeo.co.za/a/$2", "www.codeo.co.za/b/$2"]],
                        [[["a", 1], ["b", 2]], "www.codeo.co.za/$1/$2", ["www.codeo.co.za/a/1", "www.codeo.co.za/b/2"]],
                    ])(`when given %s`, (varyBy, url, expected) => {
                        it("should return expected", async () => {
                            const app = {
                                name: "codeo",
                                url: url,
                                "vary-by": varyBy
                            };
                            const e = new CustomEvaluator({});

                            // act
                            const result = e.getAppVariations(app);

                            // assert
                            const expectedResults = expected.map((x, index) => ({
                                name: "codeo",
                                url: x,
                                "vary-by": varyBy,
                                "variation": varyBy?.length > 0 ? [varyBy[index]].flat() : [null]
                            }));
                            expect(result).toEqual(expectedResults);
                        });
                    });
                });
            });
        });
    });

    describe("getIdentifierValueForObject", () => {
        describe("with no identifier", () => {
            it("should return null", () => {
                const e = new CustomEvaluator({});
                const value = e.getIdentifierValueForObject({}, null);
                expect(value).toBeNull();
            });
        });
        describe("with null object", () => {
            it("should return null", async () => {
                const e = new CustomEvaluator({});
                const value = e.getIdentifierValueForObject(null, "test");
                expect(value).toEqual(null);
            });
            it("should return default value if specified", async () => {
                const e = new CustomEvaluator({});
                const value = e.getIdentifierValueForObject(null, "test", "abc");
                expect(value).toEqual("abc");
            });
            describe("if identifier is array", () => {
                it("should return null", async () => {
                    const e = new CustomEvaluator({});
                    const value = e.getIdentifierValueForObject(null, ["test", "123"]);
                    expect(value).toEqual(null);
                });
                it("should return default value if specified", async () => {
                    const e = new CustomEvaluator({});
                    const value = e.getIdentifierValueForObject(null, ["test", "123"], "abc");
                    expect(value).toEqual("abc");
                });
            });
        });
        describe("with object", () => {
            describe("but field missing", () => {
                it("should return null", async () => {
                    const e = new CustomEvaluator({});
                    const value = e.getIdentifierValueForObject({}, "test");
                    expect(value).toEqual(null);
                });
                it("should return defaultValue if set", async () => {
                    const e = new CustomEvaluator({});
                    const value = e.getIdentifierValueForObject({}, "test", "abc");
                    expect(value).toEqual("abc");
                });
                describe("if identifier is array", () => {
                    it("should return joined name with separator", async () => {
                        const e = new CustomEvaluator({});
                        const value = e.getIdentifierValueForObject({}, ["test", "123"]);
                        expect(value).toEqual(null);
                    });
                    it("should return default value if set", async () => {
                        const e = new CustomEvaluator({});
                        const value = e.getIdentifierValueForObject({}, ["test", "123"], "abc");
                        expect(value).toEqual("abc");
                    });
                });
            });
            describe("with field present", () => {
                it("should return value", async () => {
                    const e = new CustomEvaluator({});
                    const value = e.getIdentifierValueForObject({ "test": 123 }, "test");
                    expect(value).toEqual(123);
                });
                describe("with array", () => {
                    it("should concat values", async () => {
                        const e = new CustomEvaluator({});
                        const value = e.getIdentifierValueForObject({ "a": "hello", "b": "world" }, ["a", "b"]);
                        expect(value).toEqual("hello:world");
                    });
                });
            });
        });
    });

});

class CustomEvaluator extends BaseEvaluator {

    constructor(config) {
        super(config);
    }

    configureApp(_app: IApp) {
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

    public async dispose(): Promise<void> {
        return;
    }

    protected tryEvaluate(_app: IApp): Promise<Result | Result[]> {
        return Promise.resolve(undefined);
    }

    protected isResultForApp(app: IApp, result: Result): boolean {
        return app.name === result.label;
    }

}
