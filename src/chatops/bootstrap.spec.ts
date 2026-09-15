import mockConsole from "jest-mock-console";
import { findChatOpsChannelConfig, startChatOps, stopChatOps } from "./bootstrap.js";

describe("chatops bootstrap", () => {

    let restoreConsole;

    beforeEach(() => {
        restoreConsole = mockConsole();
        process.env["test-app-token"] = "xapp-not-a-real-token";
    });

    afterEach(async () => {
        await stopChatOps();
        restoreConsole();
        delete process.env["test-app-token"];
    });

    const digestWith = (chatOps: any) => ({
        channels: {
            "team-slack": {
                type: "slack",
                token: "slack-token",
                "chat-ops": chatOps
            }
        }
    });

    describe("findChatOpsChannelConfig", () => {
        it("should find the slack channel whatever it is named", async () => {
            const result = findChatOpsChannelConfig(digestWith({ enabled: true }));
            expect(result.type).toEqual("slack");
        });
        describe("when no channel has chat ops configured", () => {
            it("should return nothing", async () => {
                expect(findChatOpsChannelConfig({ channels: { slack: { type: "slack" } } })).toBeUndefined();
                expect(findChatOpsChannelConfig(null)).toBeUndefined();
            });
        });
        describe("when an earlier slack channel has chat ops switched off", () => {
            it("should skip it and find the one that is enabled", async () => {
                // arrange
                const digest = {
                    channels: {
                        "old-slack": { type: "slack", "chat-ops": { enabled: false } },
                        "team-slack": { type: "slack", "chat-ops": { enabled: true, "app-token": "t" } }
                    }
                };

                // act
                const result = findChatOpsChannelConfig(digest);

                // assert
                expect(result["chat-ops"].enabled).toEqual(true);
            });
        });
    });

    describe("startChatOps", () => {
        describe("when it is not configured", () => {
            it("should do nothing", async () => {
                expect(await startChatOps({ loop: true }, digestWith(null))).toBeNull();
                expect(await startChatOps({ loop: true }, digestWith({ enabled: false }))).toBeNull();
            });
        });
        describe("when there is no app token", () => {
            it("should do nothing", async () => {
                expect(await startChatOps({ loop: true }, digestWith({ enabled: true }))).toBeNull();
            });
        });
        describe("when not running under the loop command", () => {
            it("should not start, as the socket would outlive nothing", async () => {
                const digest = digestWith({ enabled: true, "app-token": "test-app-token" });
                expect(await startChatOps({ loop: false }, digest)).toBeNull();
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
                expect(result).toBeNull();
            });
        });

        describe("once a listener is running", () => {
            function fakeListener(record: { started: number, stopped: number, warmed: number }) {
                return () => ({
                    start: async () => {
                        record.started++;
                    },
                    warmUp: async () => {
                        record.warmed++;
                    },
                    stop: async () => {
                        record.stopped++;
                    }
                }) as any;
            }

            it("should reuse it rather than starting another", async () => {
                // arrange
                const record = { started: 0, stopped: 0, warmed: 0 };
                const digest = digestWith({ enabled: true, "app-token": "test-app-token" });

                // act
                await startChatOps({ loop: true }, digest, { now: Date.now(), createListener: fakeListener(record) });
                await startChatOps({ loop: true }, digest, { now: Date.now(), createListener: fakeListener(record) });

                // assert
                expect(record.started).toEqual(1);
                expect(record.warmed).toEqual(1);
            });

            describe("and chat ops is then removed from the configuration", () => {
                it("should shut it down rather than leaving the socket live", async () => {
                    // arrange - the config is reloaded on every pass, so disabling chat ops has to
                    // take effect without waiting for a restart
                    const record = { started: 0, stopped: 0, warmed: 0 };
                    const factory = fakeListener(record);
                    await startChatOps(
                        { loop: true },
                        digestWith({ enabled: true, "app-token": "test-app-token" }),
                        { now: Date.now(), createListener: factory });
                    expect(record.started).toEqual(1);

                    // act - the next pass sees a channel with chat ops switched off
                    const result = await startChatOps(
                        { loop: true },
                        digestWith({ enabled: false, "app-token": "test-app-token" }),
                        { now: Date.now(), createListener: factory });

                    // assert
                    expect(result).toBeNull();
                    expect(record.stopped).toEqual(1);
                });
                it("should start again if it is switched back on", async () => {
                    // arrange
                    const record = { started: 0, stopped: 0, warmed: 0 };
                    const factory = fakeListener(record);
                    const enabled = digestWith({ enabled: true, "app-token": "test-app-token" });
                    await startChatOps({ loop: true }, enabled, { now: Date.now(), createListener: factory });
                    await startChatOps({ loop: true }, digestWith(null), { now: Date.now(), createListener: factory });

                    // act
                    await startChatOps({ loop: true }, enabled, { now: Date.now(), createListener: factory });

                    // assert
                    expect(record.started).toEqual(2);
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
                expect(result).toBeNull();
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
});
