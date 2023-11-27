import { MuteWindow } from "./mute-window";
import { initLocaleAndTimezone } from "../lib/utility";

describe("mute-windows", () => {
    describe("with missing time", () => {
        it("should throw", async () => {
            // arrange
            const config = {};

            // act
            expect(() => new MuteWindow(config)).toThrowError("expected mute window to have a time");
        });
    });
    describe("with invalid time range", () => {
        it("should throw", async () => {
            // arrange
            const config = { time: "invalid" };

            // act
            expect(() => new MuteWindow(config)).toThrowError("invalid mute-window time range 'invalid'");
        });
    });
    describe("in mute Window", () => {
        describe.each([
            ["00:00-1:00", "00:30", true],
            ["0:00-01:00", "00:00", true],
            ["00:00-1:00", "01:00", true],
            ["00:00-1:00", "01:30", false],
            ["21:00-24:00", "20:59", false],
            ["21:00-24:00", "21:00", true],
            ["21:00-24:00", "22:00", true],
            ["21:00-24:00", "00:00", true],
            ["21:00-24:00", "00:01", false],
        ])("when time is %p and date is %p", (time, date, expected) => {
            it("should evaluate appropriate", async () => {
                // arrange
                initLocaleAndTimezone({ timezone: "Africa/Johannesburg" });
                const config = { time };
                const muteWindow = new MuteWindow(config);
                const dateSAST = new Date(Date.parse("2023-01-01T" + date + "+02:00"));

                // act
                const isMuted = muteWindow.isMutedAt(dateSAST);

                // assert
                expect(isMuted).toEqual(expected);
            });
        });
    });
    describe("with days of week", () => {
        describe.each([
            [null, "2023-01-01T00:00:00.000Z", true],
            [undefined, "2023-01-01T00:00:00.000Z", true],
            ["", "2023-01-01T00:00:00.000Z", true],
            [[], "2023-01-01T00:00:00.000Z", true],
            [["sun"], "2023-01-01T00:00:00.000Z", true],
            [["mon"], "2023-01-01T00:00:00.000Z", false],
            [["tue"], "2023-01-01T00:00:00.000Z", false],
        ])(`when given %p`, (days, date, expected) => {
            it("should evaluate", async () => {
                // arrange
                initLocaleAndTimezone({ timezone: "Africa/Johannesburg" });
                const config = { time: "00:00-8:00", days };

                // act
                const isMuted = new MuteWindow(config).isMutedAt(new Date(date));

                // assert
                expect(isMuted).toEqual(expected);
            });
        });
    });
    describe("with date", () => {
        describe("isMuted", () => {
            describe.each([
                ["2023-01-02", "2023-01-01T22:00:00.000Z", true],
                ["2023-01-02", "2023-01-01T21:59:00.000Z", false],
                ["2023-01-02", "2023-01-01T23:00:00.000Z", true],
                ["2023-01-02", "2023-01-01T23:01:00.000Z", false],
                ["2023-01-02", "2023-01-02T22:22:00.000Z", false],
            ])(`when given %s`, (date, dateToTest, expected) => {
                it("should consider date", async () => {
                    // arrange
                    initLocaleAndTimezone({ timezone: "Africa/Johannesburg" });
                    const config = { time: "00:00-1:00", date: date };
                    const muteWindow = new MuteWindow(config);

                    // act
                    const isMuted = muteWindow.isMutedAt(new Date(dateToTest));

                    // assert
                    expect(isMuted).toEqual(expected);
                });
            });
        });
        describe("can be called with null date", () => {
            it("should infer now", async () => {
                // arrange
                const config = {
                    time: "00:00-24:00",
                    date: new Date().toISOString().split('T')[0],
                    days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] };
                const muteWindow = new MuteWindow(config);

                // act
                const isMuted = muteWindow.isMutedAt();

                // assert
                expect(isMuted).toEqual(true);
            });
        });
    });
    describe("with match", () => {
        describe.each([
            [null, "foo", true],
            [undefined, "foo", true],
            ["", "foo", true],
            ["foo", "foo", true],
            ["foo", "bar", false],
            ["\\dfoo", "123foobar", true],
            ["\\dFOO", "123foobar", true],
        ])(`when given %s and %s`, (match, identifier, expected) => {
            it("should generate regex that works", async () => {
                // arrange
                const config = { time: "00:00-1:00", match: match };

                // act
                const muteWindow = new MuteWindow(config);
                const isMatch = muteWindow.isMatchForIdentifier(identifier);

                // assert
                expect(isMatch).toEqual(expected);
            });
        });
    });
});
