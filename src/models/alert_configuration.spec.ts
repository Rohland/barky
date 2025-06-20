import { AlertConfiguration, AlertRule, AlertRuleType, IAlertRule } from "./alert_configuration";
import { initLocaleAndTimezone } from "../lib/utility";
import { ChannelType } from "./channels/base";

describe("AlertRule", () => {
    describe("when constructed with consecutive count type", () => {
        it("should set values and return correct type", () => {
            // arrange
            const config = {
                count: 1
            } as IAlertRule;

            // act
            const rule = new AlertRule(config);
            // assert
            expect(rule.count).toEqual(1);
            expect(rule.type).toEqual(AlertRuleType.ConsecutiveCount);
        });
    });
    describe("when constructed with any type", () => {
        it("should set values and return correct type", () => {
            // arrange
            const config = {
                any: 1,
                window: "-100m"
            } as IAlertRule;

            // act
            const rule = new AlertRule(config);
            // assert
            expect(rule.any).toEqual(1);
            expect(rule.type).toEqual(AlertRuleType.AnyInWindow);
            // we need the window on the object, even though it doesn't appear to be used, because
            // the type is serialised when a snapshot is taken
            expect(rule.window).toEqual("-100m");
        });
        describe("with no window defined", () => {
            it("should define window of -5m ", async () => {
                // arrange
                const config = {
                    any: 1
                } as IAlertRule;

                // act
                const rule = new AlertRule(config);
                // assert
                expect(rule.any).toEqual(1);
                expect(rule.type).toEqual(AlertRuleType.AnyInWindow);
                const diff = Math.abs(+new Date() - +rule.fromDate)
                const bufferMs = 100;
                expect(diff).toBeGreaterThanOrEqual(5 * 60 * 1000 - bufferMs);
                expect(diff).toBeLessThanOrEqual(5 * 60 * 1000 + bufferMs);
            });
        });
        describe.each([
            ["-10m"],
            ["10m"]
        ])(`with window defined as %s`, (window) => {
            it("should always set fromDate to past minus window", async () => {
                // arrange
                const config = {
                    any: 1,
                    window
                } as IAlertRule;

                // act
                const rule = new AlertRule(config);
                // assert
                expect(rule.any).toEqual(1);
                expect(rule.type).toEqual(AlertRuleType.AnyInWindow);
                const diff = Math.abs(+new Date() - +rule.fromDate)
                const bufferMs = 100;
                expect(diff).toBeGreaterThanOrEqual(10 * 60 * 1000 - bufferMs);
                expect(diff).toBeLessThanOrEqual(10 * 60 * 1000 + bufferMs);
            });
        });
    });
    describe("when constructed with no count or any", () => {
        it("should default to count of 1", () => {
            // arrange
            const config = {} as IAlertRule;

            // act
            const rule = new AlertRule(config);
            // assert
            expect(rule.count).toEqual(1);
            expect(rule.type).toEqual(AlertRuleType.ConsecutiveCount);
        });
    });
    describe("AlertConfiguration", () => {
        describe("when constructed", () => {
            it("should add web channel", async () => {
                // arrange
                const config = {
                    channels: []
                };

                // act
                const alertConfig = new AlertConfiguration(config);

                // assert
                expect(alertConfig.channels).toEqual([ChannelType.Web]);
            });
            describe("if config has web", () => {
                it("should not add web again", async () => {
                    // arrange
                    const config = {
                        channels: ["web"]
                    };

                    // act
                    const alertConfig = new AlertConfiguration(config);

                    // assert
                    expect(alertConfig.channels).toEqual([ChannelType.Web]);
                });
            });
        });
        describe("when constructed with links", () => {
            it("should bind them", async () => {
                // arrange
                const config = {
                    channels: [],
                    links: [
                        {
                            label: "test",
                            url: "http://test.com"
                        }
                    ]
                };

                // act
                const instance = new AlertConfiguration(config);

                // assert
                expect(instance.links).toEqual(config.links);
            });
            describe("if link missing url or label", () => {
                it("should not bind", async () => {
                    // arrange
                    const config = {
                        channels: [],
                        links: [
                            {
                                url: "http://test.com"
                            },
                            {
                                label: "test",
                            }
                        ]
                    };

                    // act
                    // @ts-ignore
                    const instance = new AlertConfiguration(config);

                    // assert
                    expect(instance.links).toEqual([]);
                });
            });
        });
    });

    describe("isValidNow", () => {
        describe("with no time or day config", () => {
            it("should return true", async () => {
                // arrange
                const config = {} as IAlertRule;

                // act
                const rule = new AlertRule(config);

                // assert
                expect(rule.isValidNow()).toEqual(true);
            });
        });
        describe("with day rules", () => {
            describe.each([
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", "Sun", true],
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", "Sunday", true],
                ["2023-01-02T00:00:00.000Z", "Africa/Johannesburg", "mon", true],
                ["2023-01-01T00:00:00.000Z", "America/New_York", "Saturday", true],
                ["2023-01-01T00:00:00.000Z", "America/New_York", "Sun", false],
            ])("with a day that matches today", (date, timezone, day, expected) => {
                it("should return expected result", async () => {
                    // arrange
                    const rule = new AlertRule({
                        days: [day]
                    });
                    initLocaleAndTimezone({
                        timezone,
                    });

                    // act
                    const result = rule.isValidNow(new Date(date));

                    // assert
                    expect(result).toEqual(expected);
                });
            });
        });
        describe("with date and time rules", () => {
            describe.each([
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", "Sun", "01:30-02:30", true],
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", "Mon", "01:30-02:30", false],
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", "Sun", "02:30-03:30", false],
            ])(`with day and time`, (date, timezone, day, time, expected) => {
                it(`should return ${ expected } for day ${ day } and time ${ time }`, async () => {
                    // arrange
                    const rule = new AlertRule({
                        days: [day],
                        time
                    });
                    initLocaleAndTimezone({
                        timezone,
                    });

                    // act
                    const result = rule.isValidNow(new Date(date));

                    // assert
                    expect(result).toEqual(expected);
                });
            });
        });
        describe("with time rules", () => {
            describe("with a time that matches now", () => {
                it("should return true", async () => {
                    // arrange
                    initLocaleAndTimezone({ timezone: "Africa/Johannesburg" });
                    const config = {
                        time: "00:00-23:59"
                    } as IAlertRule;

                    // act
                    const rule = new AlertRule(config);

                    // assert
                    expect(rule.isValidNow()).toEqual(true);
                });
            });
            describe("with a time that does not match now", () => {
                it("should return false", async () => {
                    // arrange
                    const now = new Date();
                    let hours = (now.getHours() + 1).toString();
                    hours = hours.length < 2 ? "0" + hours : hours;
                    const config = {
                        time: `${ hours }:00-${ hours }:59`
                    } as IAlertRule;

                    // act
                    const rule = new AlertRule(config);

                    // assert
                    expect(rule.isValidNow()).toEqual(false);
                });
            });
            describe("with time array", () => {
                describe("when time in first window", () => {
                    it("should evaluate times correctly", async () => {
                        // arrange
                        initLocaleAndTimezone({
                            timezone: "Africa/Johannesburg",
                            locale: "en-ZA"
                        });
                        const config = {
                            time: [
                                `00:00-4:00`,
                                "6:00-19:00"
                            ]
                        } as IAlertRule;
                        const rule = new AlertRule(config);
                        const _2AM_SAST = new Date("2023-01-01T00:00:00.000Z");
                        const _5AM_SAST = new Date("2023-01-01T03:00:00.000Z");
                        const _9AM_SAST = new Date("2023-01-01T07:00:00.000Z");

                        // act and assert
                        expect(rule.isValidNow(_2AM_SAST)).toEqual(true);
                        expect(rule.isValidNow(_5AM_SAST)).toEqual(false);
                        expect(rule.isValidNow(_9AM_SAST)).toEqual(true);
                    });
                });
            });
        });
    });
});
describe("AlertConfiguration", () => {
    describe("when instantiated with exception-policy", () => {
        it("should bind exception policy", async () => {
            // arrange & act
            const config = {
                channels: [],
                rules: null,
                "exception-policy": "monitor"
            };
            const alert = new AlertConfiguration(config);
            // assert
            expect(alert.exceptionPolicyName).toEqual(config["exception-policy"]);
        });
    });
    describe("findFirstValidRule", () => {
        describe("when no valid rules", () => {
            it("should return simplest rule of count 1", async () => {
                // arrange
                const config = new AlertConfiguration({
                    channels: [],
                    rules: null
                });

                // act
                const result = config.findFirstValidRule("");

                // assert
                expect(result.count).toEqual(1);
            });
        });
        describe("with multiple valid rules", () => {
            it("should return first", async () => {
                // arrange
                const config = new AlertConfiguration({
                    channels: [],
                    rules: [
                        {
                            count: 1
                        },
                        {
                            count: 2
                        }
                    ]
                });

                // act
                const result = config.findFirstValidRule("");

                // assert
                expect(result).toEqual(config.rules[0]);
            });
        });
        describe("with time of day based rule", () => {
            describe("matches time", () => {
                it("should use rule", async () => {
                    const config = new AlertConfiguration({
                        channels: [],
                        rules: [
                            {
                                time: ["00:00-5:00"],
                                count: 1
                            },
                            {
                                time: ["6:00-23:00"],
                                count: 2
                            }
                        ]
                    });
                    const date = new Date(2023, 10, 27, 8, 0, 0);

                    // act
                    const result = config.findFirstValidRule("", date);

                    // assert
                    expect(result).toEqual(config.rules[1]);
                });
            });
            describe("with no match", () => {
                it("should return null", async () => {
                    const config = new AlertConfiguration({
                        channels: [],
                        rules: [
                            {
                                time: ["00:00-5:00"],
                                count: 1
                            },
                            {
                                time: ["6:00-23:00"],
                                count: 2
                            }
                        ]
                    });
                    const date = new Date(2023, 10, 27, 5, 30, 0);

                    // act
                    const result = config.findFirstValidRule("", date);

                    // assert
                    expect(result).toEqual(null);
                });
            });
        });
        describe("with days of week based rule", () => {
            describe("matches date", () => {
                it("should use rule", async () => {
                    const config = new AlertConfiguration({
                        channels: [],
                        rules: [
                            {
                                days: ["Sun"],
                                count: 1
                            },
                            {
                                days: ["Mon"],
                                count: 2
                            }
                        ]
                    });
                    const date = new Date(2023, 10, 27, 8, 0, 0);

                    // act
                    const result = config.findFirstValidRule("", date);

                    // assert
                    expect(result).toEqual(config.rules[1]);
                });
            });
            describe("doesnt match", () => {
                it("should return null", async () => {
                    const config = new AlertConfiguration({
                        channels: [],
                        rules: [
                            {
                                days: ["Sun"],
                                count: 1
                            }
                        ]
                    });
                    const date = new Date(2023, 10, 27, 8, 0, 0);

                    // act
                    const result = config.findFirstValidRule("", date);

                    // assert
                    expect(result).toEqual(null);
                });
            });
        });
        describe("with match", () => {
            describe("when result id matches", () => {
                it("should return result", async () => {
                    const config = new AlertConfiguration({
                        channels: [],
                        rules: [
                            {
                                match: "test",
                                count: 1
                            },
                            {
                                match: "my-result",
                                count: 2
                            }
                        ]
                    });
                    const date = new Date(2023, 10, 27, 8, 0, 0);

                    // act
                    const result = config.findFirstValidRule("mysql|queue-performance|my-result", date);

                    // assert
                    expect(result).toEqual(config.rules[1]);
                });
                describe("when multiple rules", () => {
                    it("should return 1st matched result", async () => {
                        const config = new AlertConfiguration({
                            channels: [],
                            rules: [
                                {
                                    match: null,
                                    count: 1
                                },
                                {
                                    match: "my-result",
                                    count: 2
                                }
                            ]
                        });
                        const date = new Date(2023, 10, 27, 8, 0, 0);

                        // act
                        const result = config.findFirstValidRule("mysql|queue-performance|my-result", date);

                        // assert
                        expect(result).toEqual(config.rules[1]);
                    });
                    describe("but no matches", () => {
                        it("should consider the non-match rules", async () => {
                            const config = new AlertConfiguration({
                                channels: [],
                                rules: [
                                    {
                                        match: null,
                                        count: 1
                                    },
                                    {
                                        match: "abc",
                                        count: 2
                                    }
                                ]
                            });
                            const date = new Date(2023, 10, 27, 8, 0, 0);

                            // act
                            const result = config.findFirstValidRule("mysql|queue-performance|my-result", date);

                            // assert
                            expect(result).toEqual(config.rules[0]);
                        });
                    });
                    describe("when match not used in conjunction with match", () => {
                        it("should only consider the matched entries", async () => {
                            const config = new AlertConfiguration({
                                channels: [],
                                rules: [
                                    {
                                        match: null,
                                        count: 1,
                                    },
                                    {
                                        match: "my-result",
                                        count: 2
                                    }
                                ]
                            });
                            const date = new Date(2023, 10, 27, 8, 0, 0);

                            // act
                            const result = config.findFirstValidRule("my-result", date);

                            // assert
                            expect(result).toEqual(config.rules[1]);
                        });
                        describe("even when not valid now", () => {
                            it("should only consider the matched entries", async () => {
                                const config = new AlertConfiguration({
                                    channels: [],
                                    rules: [
                                        {
                                            match: null,
                                            count: 1,
                                        },
                                        {
                                            match: "my-result",
                                            count: 2,
                                            time: ["00:00-1:00"]
                                        }
                                    ]
                                });
                                const date = new Date(2023, 10, 27, 8, 0, 0);

                                // act
                                const result = config.findFirstValidRule("mysql|queue-performance|my-result", date);

                                // assert
                                expect(result).toEqual(null);
                            });
                        });
                    });
                });
            });
            describe("when no match", () => {
                it("should return null", async () => {
                    const config = new AlertConfiguration({
                        channels: [],
                        rules: [
                            {
                                match: "test",
                                count: 1
                            },
                            {
                                match: "my-result",
                                count: 2
                            }
                        ]
                    });
                    const date = new Date(2023, 10, 27, 8, 0, 0);

                    // act
                    const result = config.findFirstValidRule("abc", date);

                    // assert
                    expect(result).toEqual(null);
                });
            });
        });
    });
});
