import { CommandType, parseCommand, parseDuration, parseSelectionReply } from "./parser.js";

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
        describe("when the reply names no verb", () => {
            it("should be accepted against either list", async () => {
                expect(parseSelectionReply("1,3", "mute" as any)).not.toBeNull();
                expect(parseSelectionReply("1,3", "unmute" as any)).not.toBeNull();
                expect(parseSelectionReply("all", "unmute" as any).all).toEqual(true);
            });
        });
    });
});
