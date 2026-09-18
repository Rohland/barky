import { resolveChatOpsCoverage } from "./coverage.js";

describe("chat ops coverage", () => {

    beforeEach(() => {
        process.env["ops-app-token"] = "xapp-ops";
        process.env["ops-bot-token"] = "xoxb-ops";
        process.env["db-app-token"] = "xapp-db";
        process.env["db-bot-token"] = "xoxb-db";
    });

    afterEach(() => {
        delete process.env["ops-app-token"];
        delete process.env["ops-bot-token"];
        delete process.env["db-app-token"];
        delete process.env["db-bot-token"];
    });

    const opsChannel = {
        type: "slack",
        token: "ops-bot-token",
        channel: "#ops",
        "chat-ops": { enabled: true, "app-token": "ops-app-token", "dashboard-url": "https://barky.acme.com" }
    };

    function coverageFor(channels: any) {
        return resolveChatOpsCoverage({ channels });
    }

    function channelNames(coverage: any) {
        return coverage.apps.flatMap(app => app.channels.map(x => x.name));
    }

    describe("for the channel that declares it", () => {
        it("should cover it, with its own settings", async () => {
            const coverage = coverageFor({ "slack-ops": opsChannel });
            expect(coverage.apps).toHaveLength(1);
            expect(coverage.apps[0].appToken).toEqual("xapp-ops");
            expect(coverage.apps[0].channels[0].name).toEqual("slack-ops");
            expect(coverage.apps[0].channels[0].botToken).toEqual("xoxb-ops");
            expect(coverage.apps[0].channels[0].config.dashboardUrl).toEqual("https://barky.acme.com");
        });
    });

    describe("for another channel the same app posts to", () => {
        it("should cover it too, since barky already receives its events and can post there", async () => {
            // arrange - the common shape: one slack app, one bot, several channels, and chat ops
            // configured once. Without this barky silently ignores every reply in the others
            const coverage = coverageFor({
                "slack-ops": opsChannel,
                "slack-db": { type: "slack", token: "ops-bot-token", channel: "#db" }
            });

            // assert - one app, one socket, both channels
            expect(coverage.apps).toHaveLength(1);
            expect(channelNames(coverage)).toEqual(["slack-ops", "slack-db"]);
            expect(coverage.apps[0].channels[1].config.dashboardUrl).toEqual("https://barky.acme.com");
        });
        describe("when it opts out", () => {
            it("should leave it alone", async () => {
                const coverage = coverageFor({
                    "slack-ops": opsChannel,
                    "slack-db": { type: "slack", token: "ops-bot-token", "chat-ops": { enabled: false } }
                });
                expect(channelNames(coverage)).toEqual(["slack-ops"]);
            });
        });
    });

    describe("for a channel posting with a different bot", () => {
        it("should not cover it, since that is a different slack app", async () => {
            const coverage = coverageFor({
                "slack-ops": opsChannel,
                "slack-other": { type: "slack", token: "db-bot-token", channel: "#other" }
            });
            expect(channelNames(coverage)).toEqual(["slack-ops"]);
        });
    });

    describe("when two channels declare chat ops on different apps", () => {
        it("should keep them apart, one socket each", async () => {
            // arrange
            const coverage = coverageFor({
                "slack-ops": opsChannel,
                "slack-db": {
                    type: "slack",
                    token: "db-bot-token",
                    channel: "#db",
                    "chat-ops": { enabled: true, "app-token": "db-app-token" }
                }
            });

            // assert
            expect(coverage.apps.map(x => x.appToken)).toEqual(["xapp-ops", "xapp-db"]);
            expect(coverage.apps[1].channels.map(x => x.botToken)).toEqual(["xoxb-db"]);
        });
    });

    describe("when the channel that declares it is listed after the ones it covers", () => {
        it("should still lead its app, since it is what a reply barky cannot place falls back to", async () => {
            const coverage = coverageFor({
                "slack-db": { type: "slack", token: "ops-bot-token", channel: "#db" },
                "slack-ops": opsChannel
            });
            expect(channelNames(coverage)).toEqual(["slack-ops", "slack-db"]);
        });
    });

    describe("when chat ops cannot be used as configured", () => {
        describe("because there is no app token", () => {
            it("should say why rather than leaving it looking like it is working", async () => {
                const coverage = coverageFor({
                    "slack-ops": { type: "slack", token: "ops-bot-token", "chat-ops": { enabled: true } }
                });
                expect(coverage.apps).toEqual([]);
                expect(coverage.issues[0]).toContain("no app-token");
            });
        });
        describe("because there is no bot token", () => {
            it("should say why rather than leaving it looking like it is working", async () => {
                const coverage = coverageFor({
                    "slack-ops": { type: "slack", "chat-ops": { enabled: true, "app-token": "ops-app-token" } }
                });
                expect(coverage.apps).toEqual([]);
                expect(coverage.issues[0]).toContain("no bot token");
            });
        });
        describe("but another channel's app covers it anyway", () => {
            it("should not report it, since there is no fault to go looking for", async () => {
                // arrange - a second chat-ops block that forgot the app token, on a channel the
                // first app already posts to and can already answer in
                const coverage = coverageFor({
                    "slack-ops": opsChannel,
                    "slack-db": {
                        type: "slack",
                        token: "ops-bot-token",
                        channel: "#db",
                        "chat-ops": { enabled: true }
                    }
                });

                // assert
                expect(channelNames(coverage)).toEqual(["slack-ops", "slack-db"]);
                expect(coverage.issues).toEqual([]);
            });
        });
        describe("because a setting is malformed", () => {
            it("should report it and carry on with the channels that are fine", async () => {
                // arrange - a typo in one channel must not take chat ops down everywhere
                const coverage = coverageFor({
                    "slack-broken": {
                        type: "slack",
                        token: "db-bot-token",
                        "chat-ops": { enabled: true, "app-token": "db-app-token", "max-mute": "7 days or so" }
                    },
                    "slack-ops": opsChannel
                });

                // assert
                expect(channelNames(coverage)).toEqual(["slack-ops"]);
                expect(coverage.issues[0]).toContain("slack-broken");
            });
        });
    });

    describe("for a channel named with capitals", () => {
        it("should name it the way the rest of barky does", async () => {
            // arrange - the digest lowercases channel config names, and a recorded thread is
            // tagged with that name, so coverage has to agree or nothing routes
            const coverage = coverageFor({ "Slack-OPS": opsChannel });

            // assert
            expect(channelNames(coverage)).toEqual(["slack-ops"]);
        });
    });

    describe("for channels that are not slack", () => {
        it("should ignore them", async () => {
            const coverage = coverageFor({
                "slack-ops": opsChannel,
                sms: { type: "sms", token: "ops-bot-token" },
                console: { type: "console" }
            });
            expect(channelNames(coverage)).toEqual(["slack-ops"]);
        });
    });

    describe("with no digest at all", () => {
        it("should report nothing to do", async () => {
            expect(resolveChatOpsCoverage(null).apps).toEqual([]);
            expect(resolveChatOpsCoverage({}).apps).toEqual([]);
        });
    });
});
