import { clampToSlackLimit, describeInstant, describeMutePattern } from "./messages.js";
import { SlackMaxMessageLength } from "../models/channels/slack-api.js";
import { initLocaleAndTimezone } from "../lib/utility.js";

describe("chatops messages", () => {

    describe("describeInstant", () => {
        beforeEach(() => {
            initLocaleAndTimezone({ locale: "en-ZA", timezone: "Africa/Johannesburg" });
        });

        // 2026-09-15 is a Tuesday, and SAST is UTC+2
        describe.each([
            ["later the same day", "2026-09-15T08:00:00Z", "2026-09-15T16:30:00Z", "18:30 today"],
            ["the next day", "2026-09-15T08:00:00Z", "2026-09-16T06:00:00Z", "08:00 tomorrow"],
            ["later in the week", "2026-09-15T08:00:00Z", "2026-09-18T06:00:00Z", "08:00 on Friday"],
            ["beyond a week", "2026-09-15T08:00:00Z", "2026-09-28T06:00:00Z", "08:00 on Monday 2026-09-28"],
            // the instant is the same day in SAST even though it is the next day in UTC
            ["across the utc date line", "2026-09-15T08:00:00Z", "2026-09-15T22:30:00Z", "00:30 tomorrow"]
        ])("when the instant is %s", (_label, now, instant, expected) => {
            it("should describe it the way someone would say it", async () => {
                expect(describeInstant(new Date(instant), new Date(now))).toEqual(expected);
            });
        });
    });

    describe("describeMutePattern", () => {
        describe.each([
            ["^web::health::acme\\.com$", "web::health::acme.com"],
            ["^mysql::lag::db\\.01\\$prod$", "mysql::lag::db.01$prod"],
            // patterns written by hand in the digest config are shown as they are
            ["mysql.*performance", "mysql.*performance"]
        ])("given '%s'", (pattern, expected) => {
            it("should read it back as the alert it targets", async () => {
                expect(describeMutePattern(pattern)).toEqual(expected);
            });
        });
    });
    describe("clampToSlackLimit", () => {
        describe("a message that fits", () => {
            it("should be left alone", async () => {
                expect(clampToSlackLimit("short", "the dashboard")).toEqual("short");
            });
        });
        describe("a message that does not fit", () => {
            it("should be cut down to something slack will accept", async () => {
                // arrange - slack rejects the post outright, which after a mute has been applied
                // would leave the user with no confirmation at all
                const long = Array.from({ length: 500 }, (_, i) => `    • alert number ${ i }`).join("\n");

                // act
                const result = clampToSlackLimit(long, "the dashboard");

                // assert
                expect(result.length).toBeLessThanOrEqual(SlackMaxMessageLength);
                expect(result).toContain("truncated");
                expect(result).toContain("the dashboard");
                expect(result).toContain("alert number 0");
            });
            it("should cut on a line boundary rather than mid word", async () => {
                const long = Array.from({ length: 500 }, (_, i) => `line ${ i }`).join("\n");
                const result = clampToSlackLimit(long, "the dashboard");
                const body = result.substring(0, result.indexOf("\n\n_…truncated"));
                expect(body.split("\n").every(line => /^line \d+$/.test(line))).toEqual(true);
            });
        });
    });
});
