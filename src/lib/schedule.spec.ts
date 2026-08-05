import { initLocaleAndTimezone } from "./utility.js";
import {
    getDueTimeSlot,
    isExplicitTimeSchedule,
    isWithinAnyTimeRange,
    parseExceptAtRanges,
    parseExplicitTimes
} from "./schedule.js";

describe("schedule", () => {

    beforeEach(() => initLocaleAndTimezone({
        locale: "en-ZA",
        timezone: "Africa/Johannesburg"
    }));

    describe("isExplicitTimeSchedule", () => {
        describe.each([
            ["5:00"],
            ["05:00"],
            ["19:30"],
            ["0:00"],
            ["23:59"],
            ["5:00:30"],
            [["5:00", "19:00"]],
            [[" 5:00 "]],
            // routed here so that the error names the real problem, rather than a period parse failure
            ["24:00"],
            ["5:60"],
            ["25:00"],
            [["5:00", "1h"]],
            [["12h"]]
        ])(`when given %s`, (input) => {
            it("should return true", async () => {
                // arrange
                // act
                const result = isExplicitTimeSchedule(input);

                // assert
                expect(result).toEqual(true);
            });
        });
        describe.each([
            ["12h"],
            ["30s"],
            ["90s"],
            ["5"],
            [""],
            ["  "],
            [null],
            [undefined],
            [[]],
            [[""]]
        ])(`when given %s`, (input) => {
            it("should return false", async () => {
                // arrange
                // act
                const result = isExplicitTimeSchedule(input as any);

                // assert
                expect(result).toEqual(false);
            });
        });
    });

    describe("parseExplicitTimes", () => {
        describe("when given a single time", () => {
            it("should parse it", async () => {
                // arrange
                // act
                const times = parseExplicitTimes("5:00");

                // assert
                expect(times.length).toEqual(1);
                expect(times[0].time).toEqual("05:00");
                expect(times[0].hours).toEqual(5);
                expect(times[0].minutes).toEqual(0);
            });
        });
        describe("when given a list of times", () => {
            it("should parse each", async () => {
                // arrange
                // act
                const times = parseExplicitTimes(["5:00", "19:30:15"]);

                // assert
                expect(times.map(x => x.time)).toEqual(["05:00", "19:30:15"]);
                expect(times[1].seconds).toEqual(15);
            });
        });
        describe("when given a mix of durations and times", () => {
            it("should throw", async () => {
                // arrange
                // act & assert
                expect(() => parseExplicitTimes(["5:00", "1h"]))
                    .toThrow("cannot mix durations and explicit times");
            });
        });
        describe.each([
            ["24:00"],
            ["5:60"],
            ["5"],
            [""],
            [null],
            [["12h"]],
            [["5:00", "not-a-time"]]
        ])(`when given %s`, (input) => {
            it("should throw", async () => {
                // arrange
                // act & assert
                expect(() => parseExplicitTimes(input as any))
                    .toThrow("expected an explicit time in HH:mm or HH:mm:ss format");
            });
        });
    });

    describe("getDueTimeSlot", () => {
        describe.each([
            ["2020-01-01T05:00:00+02:00", true],
            ["2020-01-01T05:00:30+02:00", true],
            ["2020-01-01T05:00:59.999+02:00", true],
            ["2020-01-01T05:01:00+02:00", false],
            ["2020-01-01T04:59:59+02:00", false],
            ["2020-01-01T06:00:00+02:00", false],
            ["2020-01-01T17:00:00+02:00", false]
        ])(`when scheduled for 5:00 and it is %s`, (now, expected) => {
            it(`should ${expected ? "be" : "not be"} due`, async () => {
                // arrange
                const times = parseExplicitTimes("5:00");

                // act
                const slot = getDueTimeSlot(times, new Date(now));

                // assert
                expect(!!slot).toEqual(expected);
            });
        });
        describe("when scheduled for multiple times", () => {
            it("should be due at each of them", async () => {
                // arrange
                const times = parseExplicitTimes(["5:00", "19:00"]);

                // act
                const morning = getDueTimeSlot(times, new Date("2020-01-01T05:00:10+02:00"));
                const midday = getDueTimeSlot(times, new Date("2020-01-01T12:00:10+02:00"));
                const evening = getDueTimeSlot(times, new Date("2020-01-01T19:00:10+02:00"));

                // assert
                expect(morning).toBeTruthy();
                expect(midday).toBeNull();
                expect(evening).toBeTruthy();
                expect(morning).not.toEqual(evening);
            });
        });
        describe("when the same time comes around the next day", () => {
            it("should return a different slot", async () => {
                // arrange
                const times = parseExplicitTimes("5:00");

                // act
                const today = getDueTimeSlot(times, new Date("2020-01-01T05:00:10+02:00"));
                const tomorrow = getDueTimeSlot(times, new Date("2020-01-02T05:00:10+02:00"));

                // assert
                expect(today).toBeTruthy();
                expect(tomorrow).toBeTruthy();
                expect(today).not.toEqual(tomorrow);
            });
        });
        describe("when the window rolls past midnight", () => {
            it("should still be due and attribute the slot to the previous day", async () => {
                // arrange
                const times = parseExplicitTimes("23:59:30");

                // act
                const beforeMidnight = getDueTimeSlot(times, new Date("2020-01-01T23:59:40+02:00"));
                const afterMidnight = getDueTimeSlot(times, new Date("2020-01-02T00:00:15+02:00"));
                const tooLate = getDueTimeSlot(times, new Date("2020-01-02T00:00:40+02:00"));

                // assert
                expect(beforeMidnight).toBeTruthy();
                expect(afterMidnight).toEqual(beforeMidnight);
                expect(tooLate).toBeNull();
            });
        });
        describe("when a time is scheduled just after midnight", () => {
            it("should not be due before it", async () => {
                // arrange
                const times = parseExplicitTimes("0:00:30");

                // act
                const before = getDueTimeSlot(times, new Date("2020-01-01T00:00:15+02:00"));
                const during = getDueTimeSlot(times, new Date("2020-01-01T00:00:45+02:00"));

                // assert
                expect(before).toBeNull();
                expect(during).toBeTruthy();
            });
        });
        describe("when the configured timezone differs", () => {
            it("should resolve the time in that timezone", async () => {
                // arrange
                initLocaleAndTimezone({
                    locale: "en-ZA",
                    timezone: "America/New_York"
                });
                const times = parseExplicitTimes("5:00");

                // act
                const inNewYork = getDueTimeSlot(times, new Date("2020-01-01T10:00:10Z"));
                const inJohannesburg = getDueTimeSlot(times, new Date("2020-01-01T03:00:10Z"));

                // assert
                expect(inNewYork).toBeTruthy();
                expect(inJohannesburg).toBeNull();
            });
        });
    });

    describe("parseExceptAtRanges", () => {
        describe.each([
            ["09:00-11:00", "09:00", "11:00"],
            ["9:00-11:00", "09:00", "11:00"],
            [" 09:00 - 11:00 ", "09:00", "11:00"],
            ["23:00-02:00", "23:00", "02:00"]
        ])(`when given %s`, (input, start, end) => {
            it("should parse the range", async () => {
                // arrange
                // act
                const ranges = parseExceptAtRanges(input);

                // assert
                expect(ranges.length).toEqual(1);
                expect(ranges[0].start.time).toEqual(start);
                expect(ranges[0].end.time).toEqual(end);
            });
        });
        describe("when given a list of ranges", () => {
            it("should parse each", async () => {
                // arrange
                // act
                const ranges = parseExceptAtRanges(["9:00-11:00", "17:00-23:00"]);

                // assert
                expect(ranges.length).toEqual(2);
                expect(ranges.map(x => `${ x.start.time }-${ x.end.time }`))
                    .toEqual(["09:00-11:00", "17:00-23:00"]);
            });
        });
        describe.each([
            ["09:00"],
            ["abc"],
            ["09:00-abc"],
            ["1h"],
            [""],
            [null],
            [[]],
            [["09:00-11:00", "17:00"]]
        ])(`when given %s`, (input) => {
            it("should throw", async () => {
                // arrange
                // act & assert
                expect(() => parseExceptAtRanges(input as any))
                    .toThrow("expected a time range in HH:mm-HH:mm format");
            });
        });
    });

    describe("isWithinAnyTimeRange", () => {
        describe.each([
            ["2020-01-01T08:59:59+02:00", false],
            ["2020-01-01T09:00:00+02:00", true],
            ["2020-01-01T10:30:00+02:00", true],
            ["2020-01-01T11:00:00+02:00", true],
            ["2020-01-01T11:00:01+02:00", false],
            ["2020-01-01T23:00:00+02:00", false]
        ])(`when the range is 09:00-11:00 and it is %s`, (now, expected) => {
            it(`should return ${expected}`, async () => {
                // arrange
                const ranges = parseExceptAtRanges("09:00-11:00");

                // act
                const result = isWithinAnyTimeRange(ranges, new Date(now));

                // assert
                expect(result).toEqual(expected);
            });
        });
        describe("with multiple ranges", () => {
            describe.each([
                ["2020-01-01T10:00:00+02:00", true],
                ["2020-01-01T13:00:00+02:00", false],
                ["2020-01-01T18:00:00+02:00", true],
                ["2020-01-01T23:30:00+02:00", false]
            ])(`when it is %s`, (now, expected) => {
                it(`should return ${expected}`, async () => {
                    // arrange
                    const ranges = parseExceptAtRanges(["09:00-11:00", "17:00-23:00"]);

                    // act
                    const result = isWithinAnyTimeRange(ranges, new Date(now));

                    // assert
                    expect(result).toEqual(expected);
                });
            });
        });
        describe("when the range wraps past midnight", () => {
            describe.each([
                ["2020-01-01T22:59:00+02:00", false],
                ["2020-01-01T23:30:00+02:00", true],
                ["2020-01-02T00:30:00+02:00", true],
                ["2020-01-02T02:00:00+02:00", true],
                ["2020-01-02T02:00:01+02:00", false],
                ["2020-01-02T12:00:00+02:00", false]
            ])(`when the range is 23:00-02:00 and it is %s`, (now, expected) => {
                it(`should return ${expected}`, async () => {
                    // arrange
                    const ranges = parseExceptAtRanges("23:00-02:00");

                    // act
                    const result = isWithinAnyTimeRange(ranges, new Date(now));

                    // assert
                    expect(result).toEqual(expected);
                });
            });
        });
        describe("when the range is expressed with out of bounds hours", () => {
            it("should still wrap past midnight", async () => {
                // arrange
                const ranges = parseExceptAtRanges("23:00-26:00");

                // act
                const during = isWithinAnyTimeRange(ranges, new Date("2020-01-02T00:30:00+02:00"));
                const after = isWithinAnyTimeRange(ranges, new Date("2020-01-02T03:00:00+02:00"));

                // assert
                expect(during).toEqual(true);
                expect(after).toEqual(false);
            });
        });
        describe("when the configured timezone differs", () => {
            it("should resolve the range in that timezone", async () => {
                // arrange
                initLocaleAndTimezone({
                    locale: "en-ZA",
                    timezone: "America/New_York"
                });
                const ranges = parseExceptAtRanges("09:00-11:00");

                // act
                const inNewYork = isWithinAnyTimeRange(ranges, new Date("2020-01-01T15:00:00Z"));
                const inJohannesburg = isWithinAnyTimeRange(ranges, new Date("2020-01-01T08:00:00Z"));

                // assert
                expect(inNewYork).toEqual(true);
                expect(inJohannesburg).toEqual(false);
            });
        });
    });
});
