import { parseDaysOfWeek, parsePeriod, parsePeriodRange, parsePeriodToMinutes, parseTimeRange } from "./period-parser";
import { Time } from "./time";

describe("period parsing", () => {

    describe("parsePeriodToMinutes", () => {
        describe.each([
            ["30s", 0.5],
            ["10m", 10],
            ["5h", 60 * 5]
            ])("when input is %s", (input, expected) => {
            it("should return expected result", async () => {
                // arrange
                // act
                const result = parsePeriodToMinutes(input);

                // assert
                expect(Math.abs(expected - result)).toBeLessThan(0.1);
            });
        });
    });

    describe("parseTimeRange", () => {
        describe.each([
            null,
            undefined,
            "",
            " ",
            "abc",
            "10:00",
            "10:00-abc",
            "abc-10:00"
        ])(`when input is %s`, (input) => {
            it("should return null", () => {
                // arrange
                // act
                const result = parseTimeRange(input);
                // assert
                expect(result).toEqual(null);
            });
        });
        describe.each([
            ["06:00-11:30", new Time("06:00"), new Time("11:30")],
            ["6:00-9:30", new Time("06:00"), new Time("9:30")],
            [" 06:00  -  11:30", new Time("06:00"), new Time("11:30")],
            ["08:00-19:00", new Time("08:00"), new Time("19:00")],
            ["00:00-22:00", new Time("00:00"), new Time("22:00")],
        ])(`when input is %s`, (input, from, to) => {
            it(`should return ${ from } - ${ to }`, async () => {
                // arrange
                // act
                const result = parseTimeRange(input);
                // assert
                expect(result.start).toEqual(from);
                expect(result.end).toEqual(to);
            });
        });
    });

    describe("parseDaysOfWeek", () => {
        describe.each([
            null,
            undefined,
            []
        ])(`when input is %s`,
            // @ts-ignore
            (input) => {
                it("should return empty", async () => {
                    // arrange
                    // act
                    const result = parseDaysOfWeek(input);

                    // assert
                    expect(result).toEqual([]);
                });
            });
        describe.each([
            [["sun"], [0]],
            [["sunday"], [0]],
            [["SUNDAY"], [0]],
            [["saturday"], [6]],
            [["monday"], [1]],
            [["tuesday"], [2]],
            [["tues"], [2]],
            [["TUES"], [2]],
            [["wednesday"], [3]],
            [["thursday"], [4]],
            [["thur"], [4]],
            [["thurs"], [4]],
            [["friday"], [5]],
        ])(`when input is %s`, (input, output) => {
            it("should return output", async () => {
                // arrange
                // act
                const result = parseDaysOfWeek(input);

                // assert
                expect(result).toEqual(output);
            });
        });
        describe("with multiple days", () => {
            it("should return ordered", async () => {
                // arrange
                // act
                const result = parseDaysOfWeek(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

                // assert
                expect(result).toEqual([0, 1, 2, 3, 4, 5, 6]);
            });
        });
    });

    describe("parsePeriod", () => {
        describe.each([
            null,
            undefined,
            "",
            " ",
            " to ",
            "10",
            "-10s to -5s",
        ])(`when input is %s`, (input) => {
            it("should throw an error", async () => {
                // arrange
                // act
                expect(() => parsePeriod(input)).toThrow("invalid period - expected format: Integer{s|m|h|d} (example: -10s or 5m)");
            });
        });
        describe("when period defined in seconds", () => {
            describe("when negative", () => {
                it("should return time in the past", async () => {
                    // arrange
                    const period = "-10s";
                    const now = new Date();

                    // act
                    const result = parsePeriod(period);

                    // assert
                    const diff = +now - +result;
                    expect(diff).toBeGreaterThanOrEqual(9950);
                    expect(diff).toBeLessThanOrEqual(10050);
                });
            });
            describe("when positive", () => {
                it("should return time in the future", async () => {
                    // arrange
                    const period = "10s";
                    const now = new Date();

                    // act
                    const result = parsePeriod(period);

                    // assert
                    const diff = +now - +result;
                    expect(diff).toBeLessThanOrEqual(-9950);
                    expect(diff).toBeGreaterThanOrEqual(-10050);
                });
            });

        });
        describe("when period defined in minutes", () => {
            it("should return valid from and to dates", async () => {
                // arrange
                const period = "-10m";
                const now = new Date();

                // act
                const result = parsePeriod(period);

                // assert
                const diff = +now - +result;
                const toleranceMs = 50;
                expect(diff).toBeGreaterThanOrEqual(1000 * 60 * 10 - toleranceMs);
                expect(diff).toBeLessThanOrEqual(1000 * 60 * 10 + toleranceMs);
            });
        });
        describe("when period defined in hours", () => {
            it("should return valid from and to dates", async () => {
                // arrange
                const period = "-10h";
                const now = new Date();

                // act
                const result = parsePeriod(period);

                // assert
                const diff = +now - +result;
                const toleranceMs = 50;
                expect(diff).toBeGreaterThanOrEqual(1000 * 60 * 60 * 10 - toleranceMs);
                expect(diff).toBeLessThanOrEqual(1000 * 60 * 60 * 10 + toleranceMs);
            });
        });
        describe("when period defined in days", () => {
            it("should return valid from and to dates", async () => {
                // arrange
                const period = "-1d";
                const now = new Date();

                // act
                const result = parsePeriod(period);

                // assert
                const diff = +now - +result;
                const toleranceMs = 50;
                expect(diff).toBeGreaterThanOrEqual(1000 * 60 * 60 * 24 - toleranceMs);
                expect(diff).toBeLessThanOrEqual(1000 * 60 * 60 * 25 + toleranceMs);
            });
        });
    });
    describe("parsePeriodRange", () => {
        describe.each([
            null,
            undefined,
            "",
            " ",
            " to ",
            "10",
            "abc to 123",
            "123 to abc",
            "-10 to -5",
        ])(`when input is %s`, (input) => {
            it("should throw an error", async () => {
                // arrange
                // act
                expect(() => parsePeriodRange(input)).toThrow("invalid period - expected format: -fromInteger{s|m|h|d} to -toInteger{s|m|h|d}");
            });
        });
        describe("when period defined in seconds", () => {
            it("should return valid from and to dates", async () => {
                // arrange
                const period = "-10s to -5s";

                // act
                const result = parsePeriodRange(period);

                // assert
                expect(+result.to - +result.from).toEqual(5000);
                expect(new Date().valueOf() - +result.to).toBeLessThan(6000);
            });
        });
        describe("when period defined in minutes", () => {
            it("should return valid from and to dates", async () => {
                // arrange
                const period = "-10m to -0m";

                // act
                const result = parsePeriodRange(period);

                // assert
                expect(+result.to - +result.from).toEqual(1000 * 60 * 10);
                expect(new Date().valueOf() - +result.to).toBeLessThan(1000);
            });
        });
        describe("when period defined in hours", () => {
            it("should return valid from and to dates", async () => {
                // arrange
                const period = "-10h to -0h";

                // act
                const result = parsePeriodRange(period);

                // assert
                expect(+result.to - +result.from).toEqual(1000 * 60 * 60 * 10);
                expect(new Date().valueOf() - +result.to).toBeLessThan(1000);
            });
        });
        describe("when period defined in days", () => {
            it("should return valid from and to dates", async () => {
                // arrange
                const period = "-1d to -0d";

                // act
                const result = parsePeriodRange(period);

                // assert
                expect(+result.to - +result.from).toEqual(1000 * 60 * 60 * 24 * 1);
                expect(new Date().valueOf() - +result.to).toBeLessThan(1000);
            });
        });
        describe("with named ranges", () => {
            describe("today", () => {
                it("should return value from 00:00AM to now", async () => {
                    // arrange
                    const period = "today";

                    // act
                    const result = parsePeriodRange(period);

                    // assert
                    const today = new Date();
                    today.setHours(0,0,0,0);
                    expect(result.from).toEqual(today);
                    const fuzzyDeltaInMillis = 100;
                    const now = new Date();
                    expect(+now - +result.to).toBeLessThanOrEqual(fuzzyDeltaInMillis);
                });
            });

            describe("yesterday", () => {
                it("should return value from 00:00AM yesterday to 00:00AM today", async () => {
                    // arrange
                    const period = "yesterday";

                    // act
                    const result = parsePeriodRange(period);

                    // assert
                    const today = new Date();
                    today.setHours(0,0,0,0);
                    const yesterday = new Date();
                    yesterday.setHours(0, 0, 0, 0);
                    yesterday.setDate(today.getDate() - 1);
                    expect(result.from).toEqual(yesterday);
                    expect(result.to).toEqual(today);
                });
            });
        });
    });

});
