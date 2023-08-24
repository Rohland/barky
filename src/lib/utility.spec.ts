import { flatten, initLocaleAndTimezone, Time, toLocalTime, toLocalTimeString } from "./utility";

describe("utility functions", () => {
    describe("flatten", () => {
        describe.each([
            [[],[]],
            [null, []],
            [undefined, []],
            [[1], [1]],
            [[1,2,3], [1,2,3]],
            [[1,[2,[3]]], [1,2,3]]
        ])(`when given %s`, (input, expected) => {
            it("should flatten the array", async () => {
                // @ts-ignore
                const result = flatten(input);
                expect(result).toEqual(expected);
            });
        });
    });

    describe("localTimeString", () => {
        describe("with no config", () => {
            it("should use current locale", async () => {
                // arrange
                initLocaleAndTimezone(null);
                const date = new Date("2020-01-01T00:00:00.000Z");

                // act
                const result = toLocalTimeString(date);

                // assert
                expect(result).toEqual("02:00:00");
            });
        });
        describe("with specified locale", () => {
            it("should use current locale", async () => {
                // arrange
                initLocaleAndTimezone({
                    locale: "en-ZA",
                    timezone: "America/New_York"
                });
                let date = new Date();

                // act
                const result = toLocalTimeString(date);

                // assert
                date = new Date(date.setHours(date.getHours() - 6));
                const time = date.toLocaleTimeString("en-ZA", { hour12: false});
                expect(result).toEqual(time);
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
                ["11:12",11, 12, 0, 0],
                ["13:15:30", 13, 15, 30, 0],
                ["1:02:03", 1, 2, 3, 0],
                ["01:02:03.456", 1, 2, 3, 456],
            ])(`when given %s`, (input, hours, minutes, seconds, millis) => {
                it("should parse", async () => {
                    // arrange
                    // act
                    const time = new Time(input);

                    // assert
                    expect(time.time).toEqual(input.startsWith("1:") ? `0${input}` : input);
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
});
