import { couldNameAnyone, isNamed, mentionedUserIds, namesInText } from "./mentions.js";

describe("chatops mentions", () => {

    describe("mentionedUserIds", () => {
        it("should return the ids a message names", async () => {
            expect(mentionedUserIds("<@U05NX4E9VEW> 1,3")).toEqual(["U05NX4E9VEW"]);
        });
        it("should read the form older clients send, which carries the name too", async () => {
            expect(mentionedUserIds("<@U05NX4E9VEW|barky> mute")).toEqual(["U05NX4E9VEW"]);
        });
        it("should return each one once, however often it is named", async () => {
            // arrange - people repeat the mention when they are asking twice
            const text = "<@U1> mute <@U2> <@U1>";

            // act
            const ids = mentionedUserIds(text);

            // assert
            expect(ids).toEqual(["U1", "U2"]);
        });
        it.each([
            ["", "nothing said"],
            [null, "no text at all"],
            ["mute all", "no mention"],
            ["email rohland@barky.co.za", "an address rather than a mention"]
        ])("should return none for '%s' (%s)", async (text) => {
            expect(mentionedUserIds(text)).toEqual([]);
        });
    });

    describe("namesInText", () => {
        it.each([
            ["@barky 1"],
            ["@Barky 1"],
            ["@BARKY 1"],
            ["@barky-spar 1"],
            ["@Barky(yumbi) status"],
            ["ok @barky mute all"],
            ["(@barky 1)"],
            ["\"@barky mute all\""]
        ])("should read '%s' as naming barky", async (text) => {
            expect(namesInText(text, "barky")).toEqual(true);
        });
        it.each([
            ["wonder if barky is broken"],
            ["barky 1"],
            ["is barky ok?"],
            ["mail rohland@barky.co.za about it"],
            ["see https://codeo.co.za/barky"],
            // a user group page, whose separator is not a character that starts a word
            ["<!subteam^S012ABC|@barky-oncall> can you look at this?"],
            ["see https://github.com/@barky/checks"],
            [""],
            [null]
        ])("should not read '%s' as naming barky", async (text) => {
            // arrange - the name has to be mentioned, not merely said: people discussing barky in
            // an alert's thread must be able to do it without barky joining in
            expect(namesInText(text, "barky")).toEqual(false);
        });
        it("should name nobody when there is no name to look for", async () => {
            expect(namesInText("@barky 1", "")).toEqual(false);
            expect(namesInText("@barky 1", null)).toEqual(false);
        });
        it("should read the name literally rather than as a pattern", async () => {
            // arrange - the name comes from the configuration, and is not a regex
            expect(namesInText("@barky 1", "b.rky")).toEqual(false);
        });
    });

    describe("isNamed", () => {
        it.each([
            ["Barky"],
            ["barky"],
            ["BARKY"],
            ["barky-spar"],
            ["Barky (YUMBI)"]
        ])("should read the display name '%s' as a barky's", async (displayName) => {
            // arrange - every barky in a channel is a slack app of its own, named apart on purpose
            expect(isNamed(displayName, "barky")).toEqual(true);
        });
        it.each([
            ["Rohland"],
            ["github"],
            [""],
            [null]
        ])("should not read the display name '%s' as a barky's", async (displayName) => {
            expect(isNamed(displayName, "barky")).toEqual(false);
        });
        it("should match nobody when there is no name to look for", async () => {
            expect(isNamed("Barky", "")).toEqual(false);
        });
    });

    describe("couldNameAnyone", () => {
        it("should be true only where there is an @ to read", async () => {
            expect(couldNameAnyone("<@U1> mute")).toEqual(true);
            expect(couldNameAnyone("@barky mute")).toEqual(true);
            expect(couldNameAnyone("mute all")).toEqual(false);
            expect(couldNameAnyone(null)).toEqual(false);
        });
    });
});
