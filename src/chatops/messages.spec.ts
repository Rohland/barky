import {
    clampToSlackLimit,
    renderHelp,
    renderHelpWithInterpretation,
    renderNoListWaiting,
    renderNotUnderstood,
    renderReplyInAlertThread,
    definitionFitsSlack,
    describeInstant,
    describeMutePattern,
    IDefinitionMessage,
    renderDefinition,
    renderSelectionListOrTooLong
} from "./messages.js";
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
            it("should close a code block it cut into", async () => {
                // arrange - slack renders everything after an unclosed fence as code, including the
                // rest of the thread
                const long = ["```", ...Array.from({ length: 500 }, (_, i) => `line ${ i }`), "```"]
                    .join("\n");

                // act
                const result = clampToSlackLimit(long, "the dashboard");

                // assert
                expect(result.length).toBeLessThanOrEqual(SlackMaxMessageLength);
                expect((result.match(/```/g) ?? []).length % 2).toEqual(0);
            });
        });
    });

    describe("renderReplyInAlertThread", () => {
        describe("with a link to the alert's thread", () => {
            it("should say why, and where to go instead", async () => {
                // act
                const result = renderReplyInAlertThread("https://codeo.slack.com/archives/C1/p1");

                // assert
                expect(result).toContain("I repost this message every time I check");
                expect(result).toContain("<https://codeo.slack.com/archives/C1/p1|the alert's own thread>");
                expect(result).toContain("`mute`");
                expect(result).toContain("`define`");
            });
        });
        describe("with no link to give", () => {
            it("should still say where to go", async () => {
                // arrange - the channel configures no workspace to build a url from
                const result = renderReplyInAlertThread(null);

                // assert
                expect(result).toContain("the alert's own thread above");
                expect(result).not.toContain("<");
            });
        });
    });

    describe("the commands barky offers", () => {
        // a command missing from these is a command nobody discovers
        const commands = ["`mute`", "`unmute`", "`define`", "`status`"];

        describe("when it did not understand", () => {
            it("should name every command", async () => {
                const result = renderNotUnderstood("the dashboard");
                commands.forEach(command => expect(result).toContain(command));
                expect(result).toContain("`help`");
            });
        });
        describe("when an answer arrives with no list waiting", () => {
            it("should name every command that offers one", async () => {
                const result = renderNoListWaiting();
                expect(result).toContain("`mute`");
                expect(result).toContain("`unmute`");
                expect(result).toContain("`define`");
            });
        });
        describe("help", () => {
            it("should name every command", async () => {
                commands.forEach(command => expect(renderHelp("the dashboard")).toContain(command));
            });
            it("should name config as an alias for define", async () => {
                expect(renderHelp("the dashboard")).toContain("`define` (or `config`)");
            });
            it("should say that a define list takes one number", async () => {
                expect(renderHelp("the dashboard")).toContain("`define` list takes one number");
            });
            it("should say the same with interpretation configured", async () => {
                const result = renderHelpWithInterpretation("the dashboard");
                commands.forEach(command => expect(result).toContain(command));
                expect(result).toContain("your own words");
            });
        });
    });

    describe("renderDefinition", () => {

        const shortBlock = [
            "replication:",
            "  connection: ca-slave",
            "  identifier: status"
        ].join("\n");

        function definition(overrides: Partial<IDefinitionMessage> = {}): IDefinitionMessage {
            return {
                alertId: "mysql::replication::status",
                key: "replication",
                displayPath: "configs/low.yaml",
                yaml: shortBlock,
                firstLine: 8,
                redacted: 0,
                ...overrides
            };
        }

        function longBlock(lines: number): string {
            return Array.from(
                { length: lines },
                (_, i) => `  option-${ i }: a value long enough to matter when there are many of them`)
                .join("\n");
        }

        describe("a block that fits", () => {
            it("should be posted whole, in a code block", async () => {
                // act
                const result = renderDefinition(definition());

                // assert
                expect(result).toContain("`mysql::replication::status`");
                expect(result).toContain("defined in `configs/low.yaml`");
                expect(result).toContain("```\nreplication:\n  connection: ca-slave\n  identifier: status\n```");
                expect(result).not.toContain("lines —");
            });
            it("should not carry a language hint, which slack renders as text", async () => {
                expect(renderDefinition(definition())).not.toContain("```yaml");
            });
            it("should say which variation the alert is", async () => {
                // act
                const result = renderDefinition(definition({
                    alertId: "web::health::comms.engine.za",
                    key: "comms.engine.$1",
                    variation: "za"
                }));

                // assert
                expect(result).toContain("`za` variation of `comms.engine.$1`");
            });
            it("should say when something was held back", async () => {
                expect(renderDefinition(definition({ redacted: 2 }))).toContain("2 values redacted");
                expect(renderDefinition(definition({ redacted: 1 }))).toContain("1 value redacted");
            });
            it("should say when the id names the monitor rather than the check", async () => {
                // act
                const result = renderDefinition(definition({
                    alertId: "mysql::monitor::replication",
                    monitorFor: "replication"
                }));

                // assert
                expect(result).toContain("monitor for the `replication` check");
            });
        });

        describe("a block too long for slack", () => {
            it("should be cut down to something slack will accept", async () => {
                // act
                const result = renderDefinition(definition({ yaml: longBlock(200) }));

                // assert
                expect(result.length).toBeLessThanOrEqual(SlackMaxMessageLength);
            });
            it("should keep its code block closed", async () => {
                // act
                const result = renderDefinition(definition({ yaml: longBlock(200) }));

                // assert
                expect((result.match(/```/g) ?? []).length).toEqual(2);
            });
            it("should say how much of it is showing", async () => {
                // act
                const result = renderDefinition(definition({ yaml: longBlock(200) }));

                // assert
                expect(result).toMatch(/…\d+ of 200 lines/);
            });
            it("should link to the rest of it where there is a link", async () => {
                // act
                const result = renderDefinition(definition({
                    yaml: longBlock(200),
                    permalink: "https://github.com/acme/widgets/blob/abc123/configs/low.yaml#L8-L207"
                }));

                // assert
                expect(result).toContain("<https://github.com/acme/widgets/blob/abc123/configs/low.yaml#L8-L207|see all 200 lines on github>");
                expect(result.length).toBeLessThanOrEqual(SlackMaxMessageLength);
            });
            it("should point at the file where there is not", async () => {
                // act
                const result = renderDefinition(definition({ yaml: longBlock(200) }));

                // assert
                expect(result).toContain("the rest is in `configs/low.yaml` from line 8");
            });
            /*
             The overhead is measured with the note reading "…0 of N" while the note finally sent
             counts the lines kept, which is wider. Losing those few characters put the message over
             the limit, where the blanket clamp cut it at the last line break and took the whole
             notes block with it - the redaction notice and the github link included.
             */
            it("should stay inside the limit whatever the lines measure", async () => {
                for (let width = 1; width <= 40; width++) {
                    for (let count = 200; count <= 400; count++) {
                        const yaml = Array.from({ length: count }, () => "x".repeat(width)).join("\n");
                        const result = renderDefinition(definition({ yaml, redacted: 1 }));
                        expect(result.length).toBeLessThanOrEqual(SlackMaxMessageLength);
                        expect(result).toContain("1 value redacted");
                    }
                }
            });
            it("should cut on a line boundary", async () => {
                // act
                const result = renderDefinition(definition({ yaml: longBlock(200) }));

                // assert
                const block = result.substring(result.indexOf("```") + 4, result.lastIndexOf("```"));
                expect(block.split("\n").filter(x => x.length > 0).every(x => /^  option-\d+: a value/.test(x)))
                    .toEqual(true);
            });
        });

        describe("definitionFitsSlack", () => {
            it("should be true for a block barky can post whole", async () => {
                expect(definitionFitsSlack(definition())).toEqual(true);
            });
            it("should be false for one it cannot, so a link is worth looking up", async () => {
                expect(definitionFitsSlack(definition({ yaml: longBlock(200) }))).toEqual(false);
            });
        });
    });

    describe("renderSelectionListOrTooLong", () => {
        const candidates = [
            { id: "web::health::a.com", title: "web::health::a.com" },
            { id: "mysql::lag::db-01", title: "mysql::lag::db-01" }
        ];

        describe("a list of definitions", () => {
            it("should ask for one number rather than offering all of them", async () => {
                // arrange - only one definition is shown at a time, so "all" could not be honoured
                const list = renderSelectionListOrTooLong({
                    kind: "define",
                    candidates,
                    dashboardHint: "the dashboard"
                });

                // assert
                expect(list.text).toContain("2 active alerts");
                expect(list.text).toContain("the number you want the configuration for");
                expect(list.text).not.toContain("`all`");
            });
        });

        describe("a list too long to post", () => {
            it("should not offer define all", async () => {
                // arrange
                const many = Array.from({ length: 200 }, (_, i) => ({
                    id: `web::health::host-${ i }.a-fairly-long-domain-name.example.com`,
                    title: `web::health::host-${ i }.a-fairly-long-domain-name.example.com`
                }));

                // act
                const list = renderSelectionListOrTooLong({
                    kind: "define",
                    candidates: many,
                    dashboardHint: "the dashboard"
                });

                // assert
                expect(list.fits).toEqual(false);
                expect(list.text).not.toContain("define all");
                expect(list.text).toContain("the alert's own thread");
            });
        });
    });
});
