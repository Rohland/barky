import mockConsole from "jest-mock-console";
import { buildListener, startChatOps, stopChatOps } from "./bootstrap.js";
import { IChatOpsApp, resolveChatOpsCoverage } from "./coverage.js";
import { ChatOpsRouter } from "./router.js";
import { IChatThread } from "../models/db.js";
import { initLogger } from "../models/logger.js";

describe("chatops bootstrap", () => {

    let restoreConsole;

    beforeEach(() => {
        restoreConsole = mockConsole();
        // what barky says about the channels it covers, and the ones it cannot, is the point of
        // several of these - and the logger is a no-op unless debug is on
        initLogger({ debug: true });
        process.env["test-app-token"] = "xapp-not-a-real-token";
        process.env["test-bot-token"] = "xoxb-not-a-real-token";
        process.env["other-app-token"] = "xapp-also-not-real";
        process.env["other-bot-token"] = "xoxb-also-not-real";
        process.env["test-ai-key"] = "sk-not-a-real-key";
    });

    afterEach(async () => {
        await stopChatOps();
        initLogger({ debug: false });
        restoreConsole();
        delete process.env["test-app-token"];
        delete process.env["test-bot-token"];
        delete process.env["other-app-token"];
        delete process.env["other-bot-token"];
        delete process.env["test-ai-key"];
    });

    const digestWith = (chatOps: any) => ({
        channels: {
            "team-slack": {
                type: "slack",
                token: "test-bot-token",
                channel: "#ops",
                "chat-ops": chatOps
            }
        }
    });

    interface IRecord {
        started: string[];
        stopped: string[];
        warmed: string[];
        covered: string[][];
    }

    function newRecord(): IRecord {
        return { started: [], stopped: [], warmed: [], covered: [] };
    }

    function fakeListener(record: IRecord) {
        return (app: IChatOpsApp) => {
            record.covered.push(app.channels.map(x => x.name));
            return {
                start: async () => {
                    record.started.push(app.appToken);
                },
                warmUp: async () => {
                    record.warmed.push(app.appToken);
                },
                stop: async () => {
                    record.stopped.push(app.appToken);
                }
            } as any;
        };
    }

    describe("startChatOps", () => {
        describe("when it is not configured", () => {
            it.each([
                ["no chat ops block at all", null],
                ["a block that is switched off", { enabled: false }]
            ])("should do nothing given %s", async (_description, chatOps) => {
                expect(await startChatOps({ loop: true }, digestWith(chatOps))).toEqual([]);
            });
        });
        describe("when there is no app token", () => {
            it("should say so rather than failing silently", async () => {
                // arrange - a chat ops block that cannot listen looks exactly like one that works
                const record = newRecord();

                // act
                const result = await startChatOps(
                    { loop: true },
                    digestWith({ enabled: true }),
                    { now: Date.now(), createListener: fakeListener(record) });

                // assert
                expect(result).toEqual([]);
                expect(record.started).toEqual([]);
                expect(logged()).toContain("no app-token");
            });
        });
        describe("when not running under the loop command", () => {
            it("should not start, as the socket would outlive nothing", async () => {
                const digest = digestWith({ enabled: true, "app-token": "test-app-token" });
                expect(await startChatOps({ loop: false }, digest)).toEqual([]);
            });
        });
        describe("when a chat ops setting is malformed", () => {
            it("should not throw, so monitoring carries on", async () => {
                // arrange - a typo in an optional key must not take barky down
                const digest = digestWith({
                    enabled: true,
                    "app-token": "test-app-token",
                    "selection-ttl": "10 minutes"
                });

                // act
                const result = await startChatOps({ loop: true }, digest);

                // assert
                expect(result).toEqual([]);
                expect(logged()).toContain("could not read");
            });
        });

        describe("once a listener is running", () => {
            it("should reuse it rather than starting another", async () => {
                // arrange
                const record = newRecord();
                const digest = digestWith({ enabled: true, "app-token": "test-app-token" });

                // act
                await startChatOps({ loop: true }, digest, { now: Date.now(), createListener: fakeListener(record) });
                await startChatOps({ loop: true }, digest, { now: Date.now(), createListener: fakeListener(record) });

                // assert
                expect(record.started).toHaveLength(1);
                expect(record.warmed).toHaveLength(1);
            });

            describe("and warming up fails", () => {
                it("should keep hold of the connected listener rather than orphaning the socket", async () => {
                    // arrange - the socket is live and already delivering events by the time warm
                    // up runs, so dropping the reference to it would leave it handling mentions
                    // with a second connection added on the next pass
                    const record = newRecord();
                    const factory = (app: IChatOpsApp) => ({
                        start: async () => {
                            record.started.push(app.appToken);
                        },
                        warmUp: async () => {
                            throw new Error("slack would not say which scopes it granted");
                        },
                        stop: async () => {
                            record.stopped.push(app.appToken);
                        }
                    }) as any;
                    const digest = digestWith({ enabled: true, "app-token": "test-app-token" });

                    // act
                    const first = await startChatOps({ loop: true }, digest, { now: Date.now(), createListener: factory });
                    await startChatOps({ loop: true }, digest, { now: Date.now(), createListener: factory });

                    // assert - one connection, and it is the one barky can still shut down
                    expect(first).toHaveLength(1);
                    expect(record.started).toHaveLength(1);
                    await stopChatOps();
                    expect(record.stopped).toHaveLength(1);
                });
            });

            describe("and a channel is added to the same app", () => {
                it("should rebuild it around the new coverage rather than waiting for a restart", async () => {
                    // arrange - the digest is reloaded every pass, and a listener still routing
                    // replies by the old set would answer the new channel with the wrong token
                    const record = newRecord();
                    const factory = fakeListener(record);
                    const oneChannel = digestWith({ enabled: true, "app-token": "test-app-token" });
                    await startChatOps({ loop: true }, oneChannel, { now: Date.now(), createListener: factory });

                    // act
                    const twoChannels = {
                        channels: {
                            ...oneChannel.channels,
                            "slack-db": { type: "slack", token: "test-bot-token", channel: "#db" }
                        }
                    };
                    await startChatOps({ loop: true }, twoChannels, { now: Date.now(), createListener: factory });

                    // assert - the socket was replaced, and the new one covers both channels
                    expect(record.stopped).toHaveLength(1);
                    expect(record.started).toHaveLength(2);
                    expect(record.covered).toEqual([["team-slack"], ["team-slack", "slack-db"]]);
                });
                describe("and nothing about the coverage has changed", () => {
                    it("should leave the socket alone, so pending lists survive the pass", async () => {
                        // arrange
                        const record = newRecord();
                        const factory = fakeListener(record);
                        const digest = digestWith({ enabled: true, "app-token": "test-app-token" });
                        await startChatOps({ loop: true }, digest, { now: Date.now(), createListener: factory });

                        // act - the same channels, with a setting edited
                        const edited = digestWith({
                            enabled: true,
                            "app-token": "test-app-token",
                            "dashboard-url": "https://barky.acme.com"
                        });
                        await startChatOps({ loop: true }, edited, { now: Date.now(), createListener: factory });

                        // assert
                        expect(record.stopped).toEqual([]);
                        expect(record.started).toHaveLength(1);
                    });
                });
            });

            describe("and chat ops is then removed from the configuration", () => {
                it("should shut it down rather than leaving the socket live", async () => {
                    // arrange - the config is reloaded on every pass, so disabling chat ops has to
                    // take effect without waiting for a restart
                    const record = newRecord();
                    const factory = fakeListener(record);
                    await startChatOps(
                        { loop: true },
                        digestWith({ enabled: true, "app-token": "test-app-token" }),
                        { now: Date.now(), createListener: factory });
                    expect(record.started).toHaveLength(1);

                    // act - the next pass sees a channel with chat ops switched off
                    const result = await startChatOps(
                        { loop: true },
                        digestWith({ enabled: false, "app-token": "test-app-token" }),
                        { now: Date.now(), createListener: factory });

                    // assert
                    expect(result).toEqual([]);
                    expect(record.stopped).toHaveLength(1);
                });
                it("should start again if it is switched back on", async () => {
                    // arrange
                    const record = newRecord();
                    const factory = fakeListener(record);
                    const enabled = digestWith({ enabled: true, "app-token": "test-app-token" });
                    await startChatOps({ loop: true }, enabled, { now: Date.now(), createListener: factory });
                    await startChatOps({ loop: true }, digestWith(null), { now: Date.now(), createListener: factory });

                    // act
                    await startChatOps({ loop: true }, enabled, { now: Date.now(), createListener: factory });

                    // assert
                    expect(record.started).toHaveLength(2);
                });
            });
        });

        describe("when several channels share one slack app", () => {
            const digest = {
                channels: {
                    "slack-ops": {
                        type: "slack",
                        token: "test-bot-token",
                        channel: "#ops",
                        "chat-ops": { enabled: true, "app-token": "test-app-token" }
                    },
                    "slack-db": {
                        type: "slack",
                        token: "test-bot-token",
                        channel: "#db"
                    }
                }
            };

            it("should cover them all on the one socket", async () => {
                // arrange - the second channel posts with the same bot, so the app already receives
                // its events and can already post there
                const record = newRecord();

                // act
                const result = await startChatOps({ loop: true }, digest, { now: Date.now(), createListener: fakeListener(record) });

                // assert
                expect(result).toHaveLength(1);
                expect(record.covered).toEqual([["slack-ops", "slack-db"]]);
                expect(logged()).toContain("#db");
            });

            describe("and one of them opts out", () => {
                it("should leave that one alone", async () => {
                    // arrange
                    const record = newRecord();
                    const optedOut = {
                        channels: {
                            ...digest.channels,
                            "slack-db": { ...digest.channels["slack-db"], "chat-ops": { enabled: false } }
                        }
                    };

                    // act
                    await startChatOps({ loop: true }, optedOut, { now: Date.now(), createListener: fakeListener(record) });

                    // assert
                    expect(record.covered).toEqual([["slack-ops"]]);
                });
            });
        });

        describe("when two channels use different slack apps", () => {
            it("should open a socket for each, since one app token cannot listen for the other", async () => {
                // arrange
                const record = newRecord();
                const digest = {
                    channels: {
                        "slack-ops": {
                            type: "slack",
                            token: "test-bot-token",
                            channel: "#ops",
                            "chat-ops": { enabled: true, "app-token": "test-app-token" }
                        },
                        "slack-db": {
                            type: "slack",
                            token: "other-bot-token",
                            channel: "#db",
                            "chat-ops": { enabled: true, "app-token": "other-app-token" }
                        }
                    }
                };

                // act
                const result = await startChatOps({ loop: true }, digest, { now: Date.now(), createListener: fakeListener(record) });

                // assert
                expect(result).toHaveLength(2);
                expect(record.started).toEqual(["xapp-not-a-real-token", "xapp-also-not-real"]);
                expect(record.covered).toEqual([["slack-ops"], ["slack-db"]]);
            });

            describe("and one of them cannot connect", () => {
                it("should still run the other, and back that one off on its own", async () => {
                    // arrange - one bad token must not take chat ops down everywhere
                    const record = newRecord();
                    const factory = (app: IChatOpsApp) => {
                        if (app.appToken === "xapp-also-not-real") {
                            throw new Error("slack refused the app token");
                        }
                        return fakeListener(record)(app);
                    };
                    const digest = {
                        channels: {
                            "slack-ops": {
                                type: "slack",
                                token: "test-bot-token",
                                "chat-ops": { enabled: true, "app-token": "test-app-token" }
                            },
                            "slack-db": {
                                type: "slack",
                                token: "other-bot-token",
                                "chat-ops": { enabled: true, "app-token": "other-app-token" }
                            }
                        }
                    };
                    const now = Date.now();

                    // act
                    const result = await startChatOps({ loop: true }, digest, { now, createListener: factory });

                    // assert
                    expect(result).toHaveLength(1);
                    expect(record.started).toEqual(["xapp-not-a-real-token"]);
                    expect(logged()).toContain("failed to start");
                });
            });
        });

        describe("when slack cannot be reached", () => {
            it("should not throw, so monitoring carries on", async () => {
                // arrange - the token is not a real one, so the connection attempt fails
                const digest = digestWith({ enabled: true, "app-token": "test-app-token" });

                // act
                const result = await startChatOps({ loop: true }, digest);

                // assert
                expect(result).toEqual([]);
            });
            it("should back off rather than retrying on every pass", async () => {
                // arrange
                const digest = digestWith({ enabled: true, "app-token": "test-app-token" });
                const now = Date.now();
                await startChatOps({ loop: true }, digest, { now });
                const callsAfterFirstAttempt = (console.log as any).mock.calls.length;

                // act - a pass a minute later must not try again
                await startChatOps({ loop: true }, digest, { now: now + 60_000 });

                // assert
                expect((console.log as any).mock.calls.length).toEqual(callsAfterFirstAttempt);
            });
        });
    });

    describe("buildListener", () => {

        const OneDayMs = 24 * 60 * 60 * 1000;

        function routerFor(digest: any): ChatOpsRouter {
            const apps = resolveChatOpsCoverage(digest).apps;
            expect(apps).toHaveLength(1);
            // the listener holds the router the socket dispatches replies through, which is what
            // decides who answers, under which settings
            return (buildListener(apps[0]) as any).router;
        }

        function serviceIn(router: ChatOpsRouter, channelName: string) {
            return router.serviceFor({ channelName } as IChatThread) as any;
        }

        const chatOpsIn = (channel: string, chatOps: any) => ({
            [channel]: {
                type: "slack",
                token: "test-bot-token",
                channel: `#${ channel }`,
                "chat-ops": chatOps
            }
        });

        describe("when two channels share a bot token but configure chat ops differently", () => {
            it("should answer each under its own settings", () => {
                // arrange - keying only by the token would hand the second channel the first
                // one's settings, so it would enforce a mute ceiling nobody asked it for and
                // point people at another channel's dashboard, with nothing said about it
                const digest = {
                    channels: {
                        ...chatOpsIn("slack-ops", {
                            enabled: true,
                            "app-token": "test-app-token",
                            "max-mute": "1d"
                        }),
                        ...chatOpsIn("slack-db", {
                            enabled: true,
                            "app-token": "test-app-token",
                            "max-mute": "7d",
                            "dashboard-url": "https://barky.acme.com/db"
                        })
                    }
                };

                // act
                const router = routerFor(digest);

                // assert
                expect(serviceIn(router, "slack-ops").config.maxMuteMs).toEqual(OneDayMs);
                expect(serviceIn(router, "slack-db").config.maxMuteMs).toEqual(7 * OneDayMs);
                expect(serviceIn(router, "slack-db").config.dashboardUrl).toEqual("https://barky.acme.com/db");
            });
        });

        describe("when one channel covers another", () => {
            it("should answer both with the one service, so pending lists are shared", () => {
                // arrange - the covered channel is answered under the settings of the channel
                // that declared chat ops, because they are the same install
                const digest = {
                    channels: {
                        ...chatOpsIn("slack-ops", { enabled: true, "app-token": "test-app-token" }),
                        "slack-db": { type: "slack", token: "test-bot-token", channel: "#db" }
                    }
                };

                // act
                const router = routerFor(digest);

                // assert
                expect(serviceIn(router, "slack-db")).toBe(serviceIn(router, "slack-ops"));
            });
        });

        describe("when two channels declare the same ai settings", () => {
            it("should share one resolver, so the hourly call budget stays the ceiling it says it is", () => {
                // arrange - a resolver each would let an app answering in two installs spend
                // twice what the configuration allows, without anything saying so
                const ai = { "api-key": "test-ai-key", "max-calls-per-hour": 60 };
                const digest = {
                    channels: {
                        ...chatOpsIn("slack-ops", { enabled: true, "app-token": "test-app-token", ai }),
                        ...chatOpsIn("slack-db", { enabled: true, "app-token": "test-app-token", ai, "max-mute": "7d" })
                    }
                };

                // act
                const router = routerFor(digest);

                // assert - separate services, since their settings differ, but one budget
                expect(serviceIn(router, "slack-db")).not.toBe(serviceIn(router, "slack-ops"));
                expect(serviceIn(router, "slack-ops").resolver).toBeTruthy();
                expect(serviceIn(router, "slack-db").resolver).toBe(serviceIn(router, "slack-ops").resolver);
            });

            describe("and one of them asks for a budget of its own", () => {
                it("should give it one, since that is what it was configured with", () => {
                    // arrange
                    const digest = {
                        channels: {
                            ...chatOpsIn("slack-ops", {
                                enabled: true,
                                "app-token": "test-app-token",
                                ai: { "api-key": "test-ai-key", "max-calls-per-hour": 60 }
                            }),
                            ...chatOpsIn("slack-db", {
                                enabled: true,
                                "app-token": "test-app-token",
                                ai: { "api-key": "test-ai-key", "max-calls-per-hour": 10 }
                            })
                        }
                    };

                    // act
                    const router = routerFor(digest);

                    // assert
                    expect(serviceIn(router, "slack-db").resolver)
                        .not.toBe(serviceIn(router, "slack-ops").resolver);
                });
            });
        });

        describe("when ai is not configured", () => {
            it("should build no resolver at all", () => {
                // arrange - chat ops still works, on the commands it can parse itself
                const digest = {
                    channels: chatOpsIn("slack-ops", { enabled: true, "app-token": "test-app-token" })
                };

                // act
                const router = routerFor(digest);

                // assert
                expect(serviceIn(router, "slack-ops").resolver).toBeNull();
            });
        });
    });

    function logged() {
        return (console.log as any).mock.calls.map(args => args.map(a => String(a)).join(" ")).join("\n");
    }
});
