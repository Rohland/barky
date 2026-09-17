import { CommandType, parseCommand, parseDuration, parseSelectionReply, parseUntil } from "./parser.js";
import { initLocaleAndTimezone } from "../lib/utility.js";

describe("chatops parser", () => {

    const oneHour = 60 * 60 * 1000;
    const oneMinute = 60 * 1000;

    describe("parseDuration", () => {
        it("should not drift below the exact period, whatever the clock does", async () => {
            // parsePeriodToMillis reads the clock twice, which used to yield 3599999 at random
            const seen = new Set();
            for (let i = 0; i < 2000; i++) {
                seen.add(parseDuration("for 1h"));
            }
            expect(Array.from(seen)).toEqual([oneHour]);
        });
        describe.each([
            ["for 1h", oneHour],
            ["1h", oneHour],
            ["for 30m", 30 * oneMinute],
            ["for 90 mins", 90 * oneMinute],
            ["for 2 hours", 2 * oneHour],
            ["for 2 days", 48 * oneHour],
            ["FOR 4H", 4 * oneHour]
        ])("given '%s'", (input, expected) => {
            it("should parse the duration", async () => {
                expect(parseDuration(input)).toEqual(expected);
            });
        });
        describe.each([["mute"], ["all"], ["1,3"], [""], [null]])("given '%s'", (input) => {
            it("should return null so the default applies", async () => {
                expect(parseDuration(input)).toBeNull();
            });
        });
    });

    describe("parseCommand", () => {
        describe.each([
            ["mute", CommandType.Mute, false],
            ["<@U123> mute", CommandType.Mute, false],
            ["Mute.", CommandType.Mute, false],
            ["mute all", CommandType.Mute, true],
            ["mute everything", CommandType.Mute, true],
            ["unmute", CommandType.Unmute, false],
            ["unmute all", CommandType.Unmute, true]
        ])("given '%s'", (input, type, all) => {
            it("should parse the command", async () => {
                const result = parseCommand(input);
                expect(result.type).toEqual(type);
                expect(result.all).toEqual(all);
            });
        });
        describe("given a command carrying a duration", () => {
            it("should keep the duration", async () => {
                const result = parseCommand("mute all for 4h");
                expect(result.type).toEqual(CommandType.Mute);
                expect(result.all).toEqual(true);
                expect(result.durationMs).toEqual(4 * oneHour);
            });
        });
        describe.each([["help"], ["?"], ["status"], ["cancel"]])("given '%s'", (input) => {
            it("should parse it", async () => {
                expect(parseCommand(input)).not.toBeNull();
            });
        });
        describe.each([
            ["why is the db down?"],
            ["mute the mysql ones"],
            ["silence everything please"],
            [""],
            [null]
        ])("given '%s'", (input) => {
            it("should return null so it can be interpreted", async () => {
                expect(parseCommand(input)).toBeNull();
            });
        });
    });

    describe("parseCommand with courtesy", () => {
        it.each([
            ["mute all please", CommandType.Mute, true],
            ["please mute all", CommandType.Mute, true],
            ["mute, thanks", CommandType.Mute, false],
            ["status please", CommandType.Status, undefined],
            ["help please", CommandType.Help, undefined]
        ])("should read '%s' as the command it is", async (input, type, all) => {
            const result = parseCommand(input);
            expect(result.type).toEqual(type);
            expect(result.all).toEqual(all);
        });
        it("should still keep a period given with it", async () => {
            const result = parseCommand("please mute for 1 hour");
            expect(result.type).toEqual(CommandType.Mute);
            expect(result.durationMs).toEqual(oneHour);
        });
    });

    describe("parseSelectionReply", () => {
        describe.each([
            ["1", [1], undefined],
            ["1,3", [1, 3], undefined],
            ["1, 3", [1, 3], undefined],
            ["2 and 4", [2, 4], undefined],
            ["1 & 2", [1, 2], undefined],
            ["1-3", [1, 2, 3], undefined],
            ["3,1,3", [1, 3], undefined],
            ["1,3 for 4h", [1, 3], 4 * oneHour],
            ["mute 1 for 1h", [1], oneHour]
        ])("given '%s'", (input, indices, durationMs) => {
            it("should resolve the selected numbers", async () => {
                const result = parseSelectionReply(input);
                expect(result.all).toEqual(false);
                expect(result.indices).toEqual(indices);
                expect(result.durationMs ?? undefined).toEqual(durationMs);
            });
        });
        describe.each([["all"], ["All of them"], ["everything"], ["mute all"]])("given '%s'", (input) => {
            it("should select everything on the pinned list", async () => {
                const result = parseSelectionReply(input);
                expect(result.all).toEqual(true);
                expect(result.indices).toEqual([]);
            });
        });
        describe("when the answer is a polite one", () => {
            // people are polite to barky, and the courtesy must not be what makes the answer
            // unreadable - especially with no ai service configured to fall back on
            it.each([
                ["all please", true, []],
                ["all, thanks", true, []],
                ["please all", true, []],
                ["just all", true, []],
                ["1 and 3 please", false, [1, 3]],
                ["only 1", false, [1]],
                ["1,3 thanks!", false, [1, 3]]
            ])("should read '%s' as the answer it is", async (input, all, indices) => {
                const result = parseSelectionReply(input);
                expect(result.all).toEqual(all);
                expect(result.indices).toEqual(indices);
            });
            it("should still keep a period given with it", async () => {
                const result = parseSelectionReply("all for 4h please");
                expect(result.all).toEqual(true);
                expect(result.durationMs).toEqual(4 * oneHour);
            });
        });
        describe("given 'all' with a duration", () => {
            it("should keep the duration", async () => {
                const result = parseSelectionReply("all for 2 hours");
                expect(result.all).toEqual(true);
                expect(result.durationMs).toEqual(2 * oneHour);
            });
        });
        describe.each([
            ["the mysql ones"],
            ["all except 2"],
            ["the first two"],
            ["3-1"],
            [""],
            [null]
        ])("given '%s'", (input) => {
            it("should return null so it can be interpreted", async () => {
                expect(parseSelectionReply(input)).toBeNull();
            });
        });
        describe("when the reply names the verb of the pinned list", () => {
            it.each([
                ["mute 1", "mute"],
                ["unmute 2", "unmute"],
                ["mute all", "mute"]
            ])("should accept '%s' against a %s list", async (input, kind) => {
                expect(parseSelectionReply(input, kind as any)).not.toBeNull();
            });
        });
        describe("when the reply names the opposite verb to the pinned list", () => {
            it.each([
                ["mute 1", "unmute"],
                ["unmute 1", "mute"],
                ["mute all", "unmute"],
                ["unmute all", "mute"]
            ])("should reject '%s' against a %s list", async (input, kind) => {
                // asking to silence something is not an answer to "which of these shall I un-silence?"
                expect(parseSelectionReply(input, kind as any)).toBeNull();
            });
        });
        describe("given an absurdly large range", () => {
            it.each([
                ["1-999999999"],
                ["1-1001"],
                ["999999999"]
            ])("should reject '%s' rather than expanding it", async (input) => {
                // expansion happens before the numbers are checked against the list, so an
                // unbounded range would block the event loop or exhaust memory
                const started = Date.now();
                expect(parseSelectionReply(input)).toBeNull();
                expect(Date.now() - started).toBeLessThan(1000);
            });
        });
        describe("given a range within sensible bounds", () => {
            it("should still expand it", async () => {
                expect(parseSelectionReply("1-3").indices).toEqual([1, 2, 3]);
            });
        });
        describe("when the reply names no verb", () => {
            it("should be accepted against either list", async () => {
                expect(parseSelectionReply("1,3", "mute" as any)).not.toBeNull();
                expect(parseSelectionReply("1,3", "unmute" as any)).not.toBeNull();
                expect(parseSelectionReply("all", "unmute" as any).all).toEqual(true);
            });
        });
    });
    describe("parseUntil", () => {
        beforeEach(() => {
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });
        });

        // 2026-09-15 is a Tuesday. 08:00 SAST is 06:00Z, so 09:00Z is 11:00 local.
        const tuesdayMorning = new Date("2026-09-15T04:00:00Z");   // Tue 06:00 local
        const tuesdayAfternoon = new Date("2026-09-15T12:00:00Z"); // Tue 14:00 local

        describe.each([
            ["until tomorrow", tuesdayAfternoon, "2026-09-16 08:00"],
            ["until monday", tuesdayAfternoon, "2026-09-21 08:00"],
            ["until thursday", tuesdayAfternoon, "2026-09-17 08:00"],
            ["until friday", tuesdayAfternoon, "2026-09-18 08:00"],
            ["until sunday", tuesdayAfternoon, "2026-09-20 08:00"],
            // abbreviations barky already understands elsewhere
            ["until mon", tuesdayAfternoon, "2026-09-21 08:00"],
            ["until thurs", tuesdayAfternoon, "2026-09-17 08:00"],
            ["till friday", tuesdayAfternoon, "2026-09-18 08:00"],
            ["until next monday", tuesdayAfternoon, "2026-09-21 08:00"],
            ["UNTIL Tomorrow", tuesdayAfternoon, "2026-09-16 08:00"]
        ])("given '%s'", (input, now, expected) => {
            it(`should resolve to ${ expected }`, async () => {
                expect(parseUntil(input, now)).toEqual(expected);
            });
        });

        describe("naming the day it already is", () => {
            it("should mean today when the hour is still ahead", async () => {
                // Tuesday 06:00 local, so Tuesday 08:00 has not happened yet
                expect(parseUntil("until tuesday", tuesdayMorning)).toEqual("2026-09-15 08:00");
            });
            it("should mean next week once the hour has passed", async () => {
                expect(parseUntil("until tuesday", tuesdayAfternoon)).toEqual("2026-09-22 08:00");
            });
        });

        describe.each([
            ["until the end of the outage"],
            ["until later"],
            ["mute all"],
            [""],
            [null]
        ])("given '%s'", (input) => {
            it("should return nothing, leaving it to be interpreted", async () => {
                expect(parseUntil(input, tuesdayAfternoon)).toBeNull();
            });
        });
    });

    describe("commands carrying an until", () => {
        beforeEach(() => {
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });
        });

        it.each([
            ["mute until tomorrow", CommandType.Mute, false],
            ["mute all until monday", CommandType.Mute, true],
            ["mute this until thursday", CommandType.Mute, false]
        ])("should parse '%s'", async (input, type, all) => {
            const result = parseCommand(input);
            expect(result.type).toEqual(type);
            expect(result.all).toEqual(all);
            expect(result.until).not.toBeNull();
        });
        it("should carry it on a reply to a list too", async () => {
            const result = parseSelectionReply("1,3 until friday");
            expect(result.indices).toEqual([1, 3]);
            expect(result.until).not.toBeNull();
        });
        it("should keep 'all' readable alongside it", async () => {
            const result = parseSelectionReply("all until tomorrow");
            expect(result.all).toEqual(true);
            expect(result.until).not.toBeNull();
        });
    });
});
