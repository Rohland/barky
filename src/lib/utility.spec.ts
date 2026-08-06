import {
    dayOfWeek,
    flatten,
    hash,
    initLocaleAndTimezone,
    isToday,
    shortHash,
    toLocalDateString,
    toLocalTimeString,
    tryExecuteTimes
} from "./utility.js";

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
    describe("isToday", () => {
        describe.each([
            ["2023-01-02", "2023-01-01T21:59:00.000Z", "Africa/Johannesburg", false],
            ["2023-01-02", "2023-01-01T22:00:00.000Z", "Africa/Johannesburg", true],
            ["2023-01-02", "2023-01-02T12:00:00.000Z", "Africa/Johannesburg", true],
            ["2023-01-02", "2023-01-02T22:00:00.000Z", "Africa/Johannesburg", false],
        ])(`when given %s`, (input, date, timezone, expected) => {
            it("should return expected", async () => {
                // arrange
                initLocaleAndTimezone({ timezone: timezone});
                const on = new Date(date);
                // act
                const is = isToday(input, on);

                // assert
                expect(is).toEqual(expected);
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
        describe("with options", () => {
            describe("with no seconds", () => {
                it("should return time with no seconds", async () => {
                    // arrange
                    initLocaleAndTimezone(null);
                    const date = new Date("2020-01-01T00:00:00.000Z");

                    // act
                    const result = toLocalTimeString(date, { noSeconds: true });

                    // assert
                    expect(result).toEqual("02:00");
                });
            });
        });
        describe("with 'C.UTF-8' locale", () => {
            it("should use en-US", async () => {
                // arrange
                initLocaleAndTimezone({ locale: 'C.UTF-8'});
                const date = new Date("2020-01-01T00:00:00.000Z");

                // act
                const result = toLocalTimeString(date);

                // assert
                expect(result).toEqual("02:00:00");
            });
        });
        describe("with bad config", () => {
            it("should throw error with clear info", async () => {
                // arrange
                initLocaleAndTimezone({
                    locale: "xxx",
                    timezone: "abc"
                });
                const date = new Date("2020-01-01T00:00:00.000Z");

                // act
                expect(() => toLocalTimeString(date)).toThrow("Invalid locale or timezone (locale: 'xxx', timezone: 'abc')");
            });
        });
        describe("with specified timezone", () => {
            it("should use timezone", async () => {
                // arrange
                initLocaleAndTimezone({
                    locale: "en-ZA",
                    timezone: "America/New_York"
                });
                let date = new Date("2023-02-01T00:00:00.000Z");

                // act
                const result = toLocalTimeString(date);

                // assert
                date = new Date(date);
                const time = date.toLocaleTimeString("en-ZA", { hour12: false, timeZone: "America/New_York"});
                expect(result).toEqual(time);
            });
        });
    });
    // date formatting reuses a cached Intl formatter, so a config change must rebuild it
    describe("when the locale or timezone changes", () => {
        const date = new Date("2020-01-01T23:30:00.000Z");

        it("should reflect the new timezone in toLocalTimeString", async () => {
            // arrange
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });
            const inJohannesburg = toLocalTimeString(date);

            // act
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "America/New_York" });
            const inNewYork = toLocalTimeString(date);

            // assert
            expect(inJohannesburg).toEqual("01:30:00");
            expect(inNewYork).toEqual("18:30:00");
        });
        it("should reflect the new timezone in toLocalDateString", async () => {
            // arrange
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });
            const inJohannesburg = toLocalDateString(date);

            // act
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "America/New_York" });
            const inNewYork = toLocalDateString(date);

            // assert - the date has already rolled over in Johannesburg, but not in New York
            expect(inJohannesburg).not.toEqual(inNewYork);
            expect(inJohannesburg).toEqual(date.toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg" }));
            expect(inNewYork).toEqual(date.toLocaleDateString("en-ZA", { timeZone: "America/New_York" }));
        });
        it("should reflect the new timezone in dayOfWeek", async () => {
            // arrange
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });
            const inJohannesburg = dayOfWeek(date);

            // act
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "America/New_York" });
            const inNewYork = dayOfWeek(date);

            // assert - Thursday 2 Jan in Johannesburg, still Wednesday 1 Jan in New York
            expect(inJohannesburg).toEqual(4);
            expect(inNewYork).toEqual(3);
        });
        it("should reflect the new timezone in isToday", async () => {
            // arrange
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });
            const inJohannesburg = isToday("2020-01-02", date);

            // act
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "America/New_York" });
            const inNewYork = isToday("2020-01-02", date);

            // assert
            expect(inJohannesburg).toEqual(true);
            expect(inNewYork).toEqual(false);
        });
        it("should reflect the new locale", async () => {
            // arrange
            initLocaleAndTimezone({ locale: "en-US", timezone: "UTC" });
            const inUs = toLocalDateString(date);

            // act
            initLocaleAndTimezone({ locale: "de-DE", timezone: "UTC" });
            const inGermany = toLocalDateString(date);

            // assert
            expect(inUs).toEqual(date.toLocaleDateString("en-US", { timeZone: "UTC" }));
            expect(inGermany).toEqual(date.toLocaleDateString("de-DE", { timeZone: "UTC" }));
            expect(inUs).not.toEqual(inGermany);
        });
        it("should not poison the cache when a bad config throws", async () => {
            // arrange
            initLocaleAndTimezone({ locale: "xxx", timezone: "abc" });
            expect(() => toLocalTimeString(date)).toThrow("Invalid locale or timezone");

            // act
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });
            const result = toLocalTimeString(date);

            // assert
            expect(result).toEqual("01:30:00");
        });
    });
    describe("hash", () => {
        describe("with key", () => {
            it("should hash", async () => {
                // arrange
                const key = "test 123";

                // act
                const h = hash(key);

                // assert
                expect(h.length).toEqual(32);
            });
        });
        describe("with same key", () => {
            it("should generate same hash", async () => {
                // arrange
                const key = "test 123";

                // act
                const one = hash(key);
                const two = hash(key);

                // assert
                expect(one).toEqual(two);
            });
        });
        describe("with different keys", () => {
            it("should generate different hashes", async () => {
                // arrange
                // act
                const one = hash("test 1");
                const two = hash("test 2");

                // assert
                expect(one).not.toEqual(two);
            });
        });
        describe("with null, empty, undefined", () => {
            it("should generate same hash", async () => {
                // arrange
                const values = [null, undefined, ""];

                // act
                const hashes = values.map(hash);

                // assert
                expect(hashes[0]).toEqual(hashes[1]);
                expect(hashes[0]).toEqual(hashes[2]);
            });
        });
    });
    describe("shortHash", () => {
        describe("with key", () => {
            it("should hash", async () => {
                // arrange
                const key = "test 123";

                // act
                const h = shortHash(key);

                // assert
                expect(h.length).toEqual(8);
            });
        });
        describe("with same key", () => {
            it("should generate same hash", async () => {
                // arrange
                const key = "test 123";

                // act
                const one = shortHash(key);
                const two = shortHash(key);

                // assert
                expect(one).toEqual(two);
            });
        });
        describe("with different keys", () => {
            it("should generate different hashes", async () => {
                // arrange
                // act
                const one = shortHash("test 1");
                const two = shortHash("test 2");

                // assert
                expect(one).not.toEqual(two);
            });
        });
        describe("with null, empty, undefined", () => {
            it("should generate same hash", async () => {
                // arrange
                const values = [null, undefined, ""];

                // act
                const hashes = values.map(hash);

                // assert
                expect(hashes[0]).toEqual(hashes[1]);
                expect(hashes[0]).toEqual(hashes[2]);
            });
        });
    });

    describe("tryExecuteTimes", () => {
        describe("on success", () => {
            it("should return", async () => {
                // arrange
                const func = jest.fn().mockResolvedValue("ok");

                // act
                const result = await tryExecuteTimes("test", 3, func);

                // assert
                expect(func).toHaveBeenCalledTimes(1);
                expect(result).toEqual("ok");
            });
        });
        describe("on failure but then success", () => {
            it("should return success", async () => {
                // arrange
                const func = jest.fn().mockRejectedValueOnce(new Error("test")).mockResolvedValue("ok");

                // act
                const result = await tryExecuteTimes("test", 3, func);

                // assert
                expect(func).toHaveBeenCalledTimes(2);
                expect(result).toEqual("ok");
            });
        });
        describe("on successive failure", () => {
            it("should retry the number of times and throw", async () => {
                // arrange
                const func = jest.fn().mockRejectedValue(new Error("test"));

                // act
                await expect(tryExecuteTimes("test", 3, func)).rejects.toThrow("test");

                // assert
                expect(func).toHaveBeenCalledTimes(3);
            });
            it("should throw wrapped error with label and attempt count in message", async () => {
                // arrange
                const func = jest.fn().mockRejectedValue(new Error("inner-failure"));

                // act
                await expect(tryExecuteTimes("my-label", 2, func, true, 0))
                    .rejects.toThrow("Error executing my-label after 2 attempts");

                // assert
                expect(func).toHaveBeenCalledTimes(2);
            });
            it("should preserve original error as cause", async () => {
                // arrange
                const originalError = new Error("inner-failure");
                const func = jest.fn().mockRejectedValue(originalError);

                // act
                let caught: Error | null = null;
                try {
                    await tryExecuteTimes("my-label", 2, func, true, 0);
                } catch (err) {
                    caught = err as Error;
                }

                // assert
                expect(caught).not.toBeNull();
                expect(caught.message).toEqual("Error executing my-label after 2 attempts");
                expect(caught.cause).toBe(originalError);
            });
            describe("with throw set to false", () => {
                it("should not throw", async () => {
                    // arrange
                    const func = jest.fn().mockRejectedValue(new Error("test"));

                    // act
                    await tryExecuteTimes("test", 3, func, false, 0);

                    // assert
                    expect(func).toHaveBeenCalledTimes(3);
                });
            });
        });
    });
});
