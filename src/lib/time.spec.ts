import { initLocaleAndTimezone } from "./utility";
import { DayAndTimeEvaluator, humanizeDuration, Time, toLocalTime } from "./time";

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
        [0, "s", "0 secs"],
        [0, "m", "0 mins"],
        [0, "h", "0 hrs"],
        [0.1, "m", "6 secs"],
        [0.5, "m", "30 secs"],
        [1, "m", "1 min"],
        [1.1, "m", "1 min and 6 secs"],
        [1.9, "m", "1 min and 53 secs"],
        [59, "m", "59 mins"],
        [60, "m", "1 hr"],
        [61, "m", "1 hr and 1 min"],
        [120, "m", "2 hrs"],
        [120.5, "m", "2 hrs and 30 secs"],
        [340, "m", "5 hrs and 40 mins"],
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
