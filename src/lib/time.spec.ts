import { initLocaleAndTimezone } from "./utility.js";
import { DayAndTimeEvaluator, humanizeDuration, nextBusinessHoursStart, Time, toLocalTime } from "./time.js";

describe("Time", () => {
    describe("when instantiated with date", () => {
        it("should parse", async () => {
            // arrange
            initLocaleAndTimezone({
                locale: "en-ZA",
                timezone: "America/New_York"
            });

            // act
            const time = new Time(new Date("2020-01-01T02:33:44.555Z"));

            // assert
            expect(time.time).toEqual("21:33:44");
            expect(time.hours).toEqual(21);
            expect(time.minutes).toEqual(33);
            expect(time.seconds).toEqual(44);
            expect(time.millis).toEqual(555);
        });
    });
    describe("with time", () => {
        describe.each([
            ["11:12", 11, 12, 0, 0],
            ["13:15:30", 13, 15, 30, 0],
            ["1:02:03", 1, 2, 3, 0],
            ["01:02:03.456", 1, 2, 3, 456],
            ["24:30", 24, 30, 0, 0]
        ])(`when given %s`, (input, hours, minutes, seconds, millis) => {
            it("should parse", async () => {
                // arrange
                // act
                const time = new Time(input);

                // assert
                expect(time.time).toEqual(input.startsWith("1:") ? `0${ input }` : input);
                expect(time.hours).toEqual(hours);
                expect(time.minutes).toEqual(minutes);
                expect(time.seconds).toEqual(seconds);
                expect(time.millis).toEqual(millis);
            });
        });
    });
    describe("isBetween", () => {
        describe("when time is in range", () => {
            it("should return true", async () => {
                // arrange
                initLocaleAndTimezone({
                    locale: "en-ZA",
                    timezone: "America/New_York"
                });
                const time = new Time(new Date("2020-01-01T02:33:44.555Z"));

                // act & assert
                expect(time.isBetween(new Time("20:00"), new Time("23:00"))).toEqual(true);
            });
        });
        describe("boundary conditions", () => {
            describe("when range is 00:00 and 24:00", () => {
                it("should return true", async () => {
                    // arrange
                    initLocaleAndTimezone({
                        locale: "en-ZA",
                        timezone: "America/New_York"
                    });
                    const time = new Time(new Date("2020-01-01T02:33:44.555Z"));

                    // act & assert
                    expect(time.isBetween(new Time("00:00"), new Time("24:00"))).toEqual(true);
                });
            });
            describe("when range is out of bounds", () => {
                it("should still work", async () => {
                    // arrange
                    initLocaleAndTimezone({
                        locale: "en-ZA",
                        timezone: "America/New_York"
                    });
                    const time = new Time(new Date("2020-01-01T02:33:44.555Z"));

                    // act & assert
                    expect(time.isBetween(new Time("24:00"), new Time("48:00"))).toEqual(true);
                });
            });
        });
        describe("when time is not in range", () => {
            it("should return false", async () => {
                // arrange
                initLocaleAndTimezone({
                    locale: "en-ZA",
                    timezone: "America/New_York"
                });
                const time = new Time(new Date("2020-01-01T02:33:44.555Z"));

                // act & assert
                expect(time.isBetween(new Time("21:34"), new Time("23:00"))).toEqual(false);
            });
        });
    });
});

describe("toLocalTime", () => {
    describe("with no config", () => {
        it("should use current locale", async () => {
            // arrange
            initLocaleAndTimezone(null);
            const date = new Date("2020-01-01T02:33:44.555Z");

            // act
            const result = toLocalTime(date);

            // assert
            expect(result.time).toEqual("04:33:44");
            expect(result.hours).toEqual(4);
            expect(result.minutes).toEqual(33);
            expect(result.seconds).toEqual(44);
            expect(result.millis).toEqual(555);
        });
    });
    describe("with specified locale", () => {
        it("should use current locale", async () => {
            // arrange
            initLocaleAndTimezone({
                locale: "en-ZA",
                timezone: "America/New_York"
            });
            const date = new Date("2020-01-01T02:33:44.555Z")

            // act
            const result = toLocalTime(date);

            // assert
            expect(result.time).toEqual("21:33:44");
            expect(result.hours).toEqual(21);
            expect(result.minutes).toEqual(33);
            expect(result.seconds).toEqual(44);
            expect(result.millis).toEqual(555);
        });
    });
});


describe("humanizeDuration", () => {
    describe.each([
        [0, "s", "0s"],
        [0, "m", "0m"],
        [0, "h", "0h"],
        [0.1, "m", "6s"],
        [0.5, "m", "30s"],
        [1, "m", "1m"],
        [65, "s", "1m and 5s"],
        [1.1, "m", "1m and 6s"],
        [1.9, "m", "1m and 54s"],
        [59, "m", "59m"],
        [60, "m", "1h"],
        [61, "m", "1h and 1m"],
        [120, "m", "2h"],
        [120.5, "m", "2h and 30s"],
        [340, "m", "5h and 40m"],
    ])(`when given %s`, (input, type, expected) => {
        it("should return expected", async () => {
            // arrange
            // act
            const result = humanizeDuration(input, type);

            // assert
            expect(result).toEqual(expected);
        });
    });
});


describe("DayAndTimeEvaluator", () => {
    describe("isValidNow", () => {
        describe("with no time or day config", () => {
            it("should return true", async () => {
                // arrange
                // act
                const rule = new DayAndTimeEvaluator(null, null);

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
                    const evaluator = new DayAndTimeEvaluator([day], null);
                    initLocaleAndTimezone({
                        timezone,
                    });

                    // act
                    const result = evaluator.isValidNow(new Date(date));

                    // assert
                    expect(result).toEqual(expected);
                });
            });
        });
        describe("with date and time rules", () => {
            describe.each([
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", null, "01:30-02:30", true],
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", ["Sun", "Mon"], "01:30-02:30", true],
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", "Sun", "01:30-02:30", true],
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", "Mon", "01:30-02:30", false],
                ["2023-01-01T00:00:00.000Z", "Africa/Johannesburg", "Sun", "02:30-03:30", false],
            ])(`with day and time`, (date, timezone, day, time, expected) => {
                it(`should return ${ expected } for day ${ day } and time ${ time }`, async () => {
                    // arrange
                    // @ts-ignore
                    const evaluator = new DayAndTimeEvaluator([day], time);
                    initLocaleAndTimezone({
                        timezone,
                    });

                    // act
                    const result = evaluator.isValidNow(new Date(date));

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
                    const evaluator = new DayAndTimeEvaluator(null, "00:00-23:59");

                    // act
                    // assert
                    expect(evaluator.isValidNow()).toEqual(true);
                });
            });
            describe("with a time that does not match now", () => {
                it("should return false", async () => {
                    // arrange
                    const now = new Date();
                    let hours = (now.getHours() + 1).toString();
                    hours = hours.length < 2 ? "0" + hours : hours;
                    const evaluator = new DayAndTimeEvaluator(null, `${ hours }:00-${ hours }:59`);

                    // act
                    // assert
                    expect(evaluator.isValidNow()).toEqual(false);
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
                        const evaluator = new DayAndTimeEvaluator(
                            null,
                            [
                                `00:00-4:00`,
                                "6:00-19:00"
                            ]);
                        const _2AM_SAST = new Date("2023-01-01T00:00:00.000Z");
                        const _5AM_SAST = new Date("2023-01-01T03:00:00.000Z");
                        const _9AM_SAST = new Date("2023-01-01T07:00:00.000Z");

                        // act and assert
                        expect(evaluator.isValidNow(_2AM_SAST)).toEqual(true);
                        expect(evaluator.isValidNow(_5AM_SAST)).toEqual(false);
                        expect(evaluator.isValidNow(_9AM_SAST)).toEqual(true);
                    });
                });
            });
        });
    });
});

describe("nextBusinessHoursStart", () => {
    // 2026-09-14 is a Monday
    describe.each([
        ["mid week, before business hours", "2026-09-15T00:00:00Z", "2026-09-15T06:00:00Z"], // Tue 02:00 -> Tue 08:00
        ["mid week, during business hours", "2026-09-15T08:00:00Z", "2026-09-16T06:00:00Z"], // Tue 10:00 -> Wed 08:00
        ["mid week, after business hours", "2026-09-15T18:00:00Z", "2026-09-16T06:00:00Z"],  // Tue 20:00 -> Wed 08:00
        ["friday afternoon", "2026-09-18T12:00:00Z", "2026-09-21T06:00:00Z"],                // Fri 14:00 -> Mon 08:00
        ["saturday", "2026-09-19T07:00:00Z", "2026-09-21T06:00:00Z"],                        // Sat 09:00 -> Mon 08:00
        ["sunday evening", "2026-09-20T18:00:00Z", "2026-09-21T06:00:00Z"],                  // Sun 20:00 -> Mon 08:00
        ["exactly at the start of business hours", "2026-09-15T06:00:00Z", "2026-09-16T06:00:00Z"] // must be strictly ahead
    ])("when called %s", (_label, now, expected) => {
        it("should resolve to the next business hours start", async () => {
            // arrange
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });

            // act
            const result = nextBusinessHoursStart(null, new Date(now));

            // assert
            expect(result.toISOString()).toEqual(new Date(expected).toISOString());
        });
    });
    describe("with configured business days and start time", () => {
        it("should honour them", async () => {
            // arrange
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });

            // act - Tuesday, with only Mon and Thu as business days, starting at 09:30
            const result = nextBusinessHoursStart(
                { days: ["mon", "thu"], start: "09:30" },
                new Date("2026-09-15T08:00:00Z"));

            // assert - Thursday 09:30 SAST
            expect(result.toISOString()).toEqual(new Date("2026-09-17T07:30:00Z").toISOString());
        });
    });
    describe("in a timezone observing daylight saving", () => {
        it("should resolve against the offset in force on the day", async () => {
            // arrange
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "America/New_York" });

            // act - Friday 2026-03-06, clocks go forward on the Sunday
            const result = nextBusinessHoursStart(null, new Date("2026-03-06T20:00:00Z"));

            // assert - Monday 08:00 EDT is 12:00Z, not the 13:00Z it would be under EST
            expect(result.toISOString()).toEqual(new Date("2026-03-09T12:00:00Z").toISOString());
        });
    });
    describe("with no business days configured", () => {
        it("should throw", async () => {
            // arrange
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });

            // act & assert
            expect(() => nextBusinessHoursStart({ days: ["nonsense"] })).toThrow(/at least one business day/);
        });
    });
});
