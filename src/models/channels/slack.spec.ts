import mockConsole from "jest-mock-console";
import { SlackChannelConfig } from "./slack.js";
import { SlackApi, SlackApiError } from "./slack-api.js";
import { Snapshot } from "../snapshot.js";
import { AlertState } from "../alerts.js";
import * as os from "os";
import { deleteDbIfExists, destroy, getChatThread, initConnection } from "../db.js";

describe("slack", () => {
    describe("generateMessage", () => {
        describe("with message that fits into 4k chars", () => {
            it("should generate expanded version with links etc", async () => {
                // arrange
                const sut = new SlackChannelConfig(null, {
                    channel: "channel",
                });
                const snapshots = [
                    new Snapshot({
                        date: new Date(),
                        type: "web",
                        label: "health",
                        identifier: "www.codeo.co.za",
                        success: false,
                        last_result: "Expected 200, got 500",
                        alert_config: {
                            links: [
                                {
                                    label: "View",
                                    url: "https://www.notion.so"
                                }
                            ]
                        }
                    })
                ];
                let dt = new Date();
                dt = new Date(dt.setHours(dt.getHours() - 1));
                const alertState = new AlertState({
                    channel: "channel",
                    start_date: dt,
                    end_date: null,
                })

                // act
                const msg = sut.generateMessage(snapshots, alertState);

                // assert
                expect(msg.length).toBeLessThan(4000);
                expect(msg).toContain("*Duration:* `1h`");
                expect(msg).toContain(snapshots[0].alert.links[0].label);
                expect(msg).toContain(snapshots[0].alert.links[0].url);
                expect(msg).toContain(os.hostname());
            });
        });
        describe("with message that does not fit into 4k chars", () => {
            it("should generate summarised version", async () => {
                // arrange
                const sut = new SlackChannelConfig(null, {
                    channel: "channel",
                });
                const snapshot =  new Snapshot({
                    date: new Date(),
                    type: "web",
                    label: "health",
                    identifier: "www.codeo.co.za",
                    success: false,
                    last_result: "Expected 200, got 500",
                    alert_config: {
                        links: [
                            {
                                label: "View",
                                url: "https://www.notion.so"
                            }
                        ]
                    }
                });
                const snapshots = [];
                for (let i = 0; i < 40; i++) {
                    snapshots.push(snapshot);
                }
                let dt = new Date();
                dt = new Date(dt.setHours(dt.getHours() - 1));
                const alertState = new AlertState({
                    channel: "channel",
                    start_date: dt,
                    end_date: null,
                })

                // act
                const msg = sut.generateMessage(snapshots, alertState);

                // assert
                expect(msg.length).toBeLessThan(4000);
                expect(msg).toContain("*Duration:* `1h`");
                expect(msg).toContain("40 failing web checks");
                expect(msg).not.toContain(snapshots[0].alert.links[0].label);
                expect(msg).not.toContain(snapshots[0].alert.links[0].url);
            });
            describe("and if has summary template", () => {
                it("is included", async () => {
                    // arrange
                    const sut = new SlackChannelConfig(null, {
                        channel: "channel",
                        template: {
                            summary: "my-summary!"
                        }
                    });
                    const snapshot =  new Snapshot({
                        date: new Date(),
                        type: "web",
                        label: "health",
                        identifier: "www.codeo.co.za",
                        success: false,
                        last_result: "Expected 200, got 500",
                        alert_config: {
                            links: [
                                {
                                    label: "View",
                                    url: "https://www.notion.so"
                                }
                            ]
                        }
                    });
                    const snapshots = [];
                    for (let i = 0; i < 40; i++) {
                        snapshots.push(snapshot);
                    }
                    let dt = new Date();
                    dt = new Date(dt.setHours(dt.getHours() - 1));
                    const alertState = new AlertState({
                        channel: "channel",
                        start_date: dt,
                        end_date: null,
                    })

                    // act
                    const msg = sut.generateMessage(snapshots, alertState);

                    // assert
                    expect(msg.length).toBeLessThan(4000);
                    expect(msg).toContain("my-summary");
                });
            });
        });
    });
    describe("sendOngoingAlert", () => {
        describe("without workspace info", () => {
            it("should post an update without mutating state, and shouldn't attempt to delete last message", async () => {
                // arrange
                const sut = new SlackChannelConfig(null, {
                    channel: "my-channel",
                    template: {
                        summary: "my-summary!"
                    }
                });
                const snapshot = generateSnapshot();
                const snapshots = [];
                for (let i = 0; i < 40; i++) {
                    snapshots.push(snapshot);
                }
                let dt = new Date();
                dt = new Date(dt.setHours(dt.getHours() - 1));
                const alertState = new AlertState({
                    channel: "channel",
                    start_date: dt,
                    end_date: null,
                });
                const before = JSON.stringify(alertState);
                sut.postToSlack = jest.fn();
                sut.pingAboutOngoingAlert = jest.fn();
                sut.deleteMessage = jest.fn();

                // act
                await sut.sendOngoingAlert(snapshots, alertState);

                // assert
                const after = JSON.stringify(alertState);
                expect(after).toEqual(before);
                expect(sut.postToSlack).toHaveBeenCalledWith(
                    '🔥 <!channel> Alert ongoing: `40 problems` for `1h`. See above ☝️ \n_please do not reply to this msg_',
                    null);
                expect(sut.pingAboutOngoingAlert).toHaveBeenCalledWith(snapshots, alertState);
                expect(sut.deleteMessage).not.toHaveBeenCalledWith();
            });
        });
        describe("with workspace info", () => {
            it("should post an update without mutating state", async () => {
                // arrange
                const sut = new SlackChannelConfig(null, {
                    channel: "my-channel",
                    workspace: "codeo",
                    template: {
                        summary: "my-summary!"
                    }
                });
                const snapshot = generateSnapshot();
                const snapshots = [];
                for (let i = 0; i < 40; i++) {
                    snapshots.push(snapshot);
                }
                let dt = new Date();
                dt = new Date(dt.setHours(dt.getHours() - 1));
                const alertState = new AlertState({
                    channel: "channel",
                    start_date: dt,
                    end_date: null,
                    state: JSON.stringify({
                        ts: 123,
                        channel: 'reply-channel',
                        ongoing: {
                            channel: 'reply-channel',
                            ts: 321
                        }
                    })
                });
                sut.postToSlack = jest.fn().mockResolvedValue({ channel: "reply-channel", ts: 999 });
                sut.pingAboutOngoingAlert = jest.fn();
                sut.deleteMessage = jest.fn();

                // act
                await sut.sendOngoingAlert(snapshots, alertState);

                // assert
                expect(sut.postToSlack).toHaveBeenCalledWith(
                    '🔥 <!channel> Alert ongoing: `40 problems` for `1h`. <https://codeo.slack.com/archives/reply-channel/p123|See above ☝️> \n_please do not reply to this msg_',
                    null);
                expect(sut.pingAboutOngoingAlert).toHaveBeenCalledWith(snapshots, alertState);
                expect(sut.deleteMessage).toHaveBeenCalledWith('reply-channel', 321);
            });
        });
    });

    describe("when the message barky has been updating is gone", () => {

        let restoreConsole;

        beforeEach(() => restoreConsole = mockConsole());
        afterEach(() => restoreConsole());

        // what reaches the channel once the retry has wrapped it
        function messageNotFound() {
            return new Error(
                "Error executing posting to slack (chat.update to C123) after 1 attempt",
                { cause: new SlackApiError("message_not_found") });
        }

        function stubApi(sut: SlackChannelConfig, update: () => Promise<any>) {
            const api = {
                updateMessage: jest.fn().mockImplementation(update),
                postMessage: jest.fn().mockResolvedValue({ channel: "C123", ts: "222" }),
                deleteMessage: jest.fn()
            };
            Object.defineProperty(sut, "api", { get: () => api });
            return api;
        }

        it("should post a new one in its place", async () => {
            /*
             Someone deleted it, or it is older than the workspace keeps. The reference is dead
             however many times it is retried, so without this the channel could never alert again
             until its stored state was cleared by hand.
             */
            const sut = new SlackChannelConfig("slack", { channel: "#ops" });
            const api = stubApi(sut, () => Promise.reject(messageNotFound()));

            // act
            const result = await sut.postToSlack("still broken", { channel: "C123", ts: 111 });

            // assert
            expect(api.postMessage).toHaveBeenCalledWith("C123", "still broken");
            expect(result.ts).toEqual("222");
        });

        it("should say so out loud, since it is not what barky meant to do", async () => {
            // arrange
            const sut = new SlackChannelConfig("slack", { channel: "#ops" });
            stubApi(sut, () => Promise.reject(messageNotFound()));

            // act
            await sut.postToSlack("still broken", { channel: "C123", ts: 111 });

            // assert
            expect(console.log).toHaveBeenCalledWith(
                expect.stringContaining("is gone, so barky is posting a new one in its place"));
        });

        it("should pass on anything else, rather than posting twice", async () => {
            // arrange - a rate limit or a timeout is not a dead message, and posting a second
            // copy of an alert is worse than failing the attempt
            const sut = new SlackChannelConfig("slack", { channel: "#ops" });
            const api = stubApi(sut, () => Promise.reject(new Error("timeout of 5000ms exceeded")));

            // act
            await expect(sut.postToSlack("still broken", { channel: "C123", ts: 111 }))
                .rejects.toThrow("timeout");

            // assert
            expect(api.postMessage).not.toHaveBeenCalled();
        });

        describe("and the alert is ongoing", () => {
            it("should adopt the new message, rather than posting a fresh one every pass", async () => {
                // arrange
                const sut = new SlackChannelConfig("slack", { channel: "#ops" });
                stubApi(sut, () => Promise.reject(messageNotFound()));
                const alert = new AlertState({
                    channel: "slack",
                    start_date: new Date(),
                    state: JSON.stringify({ ts: "111", channel: "C123", ongoing: { channel: "C123", ts: "999" } })
                });

                // act
                await sut.pingAboutOngoingAlert([], alert);

                // assert
                expect(alert.state.ts).toEqual("222");
                // and the follow-up ping it still has to delete is not forgotten
                expect(alert.state.ongoing).toEqual({ channel: "C123", ts: "999" });
            });
            it("should take ownership of its first message where it never had one", async () => {
                // arrange - an alert whose first send failed has no message to update, and would
                // otherwise post a fresh one on every pass
                const sut = new SlackChannelConfig("slack", { channel: "#ops" });
                stubApi(sut, () => Promise.reject(messageNotFound()));
                const alert = AlertState.New("slack");

                // act
                await sut.pingAboutOngoingAlert([], alert);

                // assert
                expect(alert.state).toEqual({ channel: "C123", ts: "222" });
            });
            it("should leave the state alone when the update worked", async () => {
                // arrange
                const sut = new SlackChannelConfig("slack", { channel: "#ops" });
                stubApi(sut, () => Promise.resolve({ channel: "C123", ts: "111" }));
                const alert = new AlertState({
                    channel: "slack",
                    start_date: new Date(),
                    state: JSON.stringify({ ts: "111", channel: "C123", ongoing: { channel: "C123", ts: "999" } })
                });

                // act
                await sut.pingAboutOngoingAlert([], alert);

                // assert
                expect(alert.state).toEqual({ ts: "111", channel: "C123", ongoing: { channel: "C123", ts: "999" } });
            });
        });
    });

    describe("postToSlack", () => {
        describe("when the alert already has a message", () => {
            it("should update that message in place", async () => {
                // arrange
                const sut = new SlackChannelConfig(null, { channel: "my-channel" });
                const api = stubApiOn(sut);

                // act
                await sut.postToSlack("updated", { channel: "C1", ts: 123 });

                // assert
                expect(api.updateMessage).toHaveBeenCalledWith("C1", 123, "updated");
                expect(api.postMessage).not.toHaveBeenCalled();
            });
        });
        describe("when the alert has no message yet", () => {
            it("should post a new one to the configured channel", async () => {
                // arrange
                const sut = new SlackChannelConfig(null, { channel: "my-channel" });
                const api = stubApiOn(sut);

                // act
                await sut.postToSlack("new", null);

                // assert
                expect(api.postMessage).toHaveBeenCalledWith("my-channel", "new");
            });
        });
    });

    describe("replyInThreadOnSlack", () => {
        describe("when barky has already posted the alert", () => {
            it("should reply under that message rather than replacing it", async () => {
                // arrange
                const sut = new SlackChannelConfig(null, { channel: "my-channel" });
                const api = stubApiOn(sut);

                // act
                await sut.replyInThreadOnSlack("resolved", { channel: "C1", ts: 123 });

                // assert
                expect(api.postMessage).toHaveBeenCalledWith("C1", "resolved", 123);
                expect(api.updateMessage).not.toHaveBeenCalled();
            });
        });
        describe("when there is no message to reply to", () => {
            it("should post it to the channel instead", async () => {
                // arrange
                const sut = new SlackChannelConfig(null, { channel: "my-channel" });
                const api = stubApiOn(sut);

                // act
                await sut.replyInThreadOnSlack("resolved", null);

                // assert
                expect(api.postMessage).toHaveBeenCalledWith("my-channel", "resolved");
            });
        });
    });

    function stubApiOn(sut: SlackChannelConfig) {
        const api = {
            postMessage: jest.fn(async () => ({ channel: "C1", ts: "1" })),
            updateMessage: jest.fn(async () => ({ channel: "C1", ts: "1" }))
        };
        sut["_api"] = api as unknown as SlackApi;
        return api;
    }

    // integration/exploratory test
    xit("should be able to send a message", async () => {
        process.env["slack-token"] = "/* insert token here */";
        const sut = new SlackChannelConfig(null, {
            channel: "#my-channel",
            workspace: "my-workspace",
            template: {
                summary: "my-summary!"
            },
            token: "slack-token"
        });
        const msg = "hello world!";
        const result = await sut.postToSlack(msg, null);
        console.log("result", result);
    });

    function generateSnapshot() {
        const snapshot =  new Snapshot({
            date: new Date(),
            type: "web",
            label: "health",
            identifier: "www.codeo.co.za",
            success: false,
            last_result: "Expected 200, got 500",
            alert_config: {
                links: [
                    {
                        label: "View",
                        url: "https://www.notion.so"
                    }
                ]
            }
        });
        return snapshot;
    }
    describe("sendNewAlert", () => {

        const testDb = "dbslackthreads";

        beforeEach(async () => {
            deleteDbIfExists(testDb);
            await initConnection(testDb);
        });

        afterEach(async () => {
            await destroy();
            deleteDbIfExists(testDb);
        });

        it("should note which alerts the message reported, so a thread reply can resolve them", async () => {
            // arrange
            const sut = new SlackChannelConfig("slack", {
                channel: "#ops",
                "chat-ops": { enabled: true }
            });
            sut.postToSlack = jest.fn().mockResolvedValue({ channel: "C1", ts: "1700000000.000100" }) as any;
            const snapshots = [
                new Snapshot({
                    date: new Date(),
                    type: "web",
                    label: "health",
                    identifier: "www.codeo.co.za",
                    success: false,
                    last_result: "Expected 200, got 500",
                    alert_config: null
                })
            ];
            const alert = new AlertState({ channel: "slack", start_date: new Date() });

            // act
            await sut.sendNewAlert(snapshots, alert);

            // assert
            const thread = await getChatThread("C1", "1700000000.000100");
            expect(thread.alertIds).toEqual(["web::health::www.codeo.co.za"]);
            // so a reply in the thread is answered by the config that posted it, with the bot
            // token that can post in that channel
            expect(thread.channelName).toEqual("slack");
        });
        describe("for a channel chat ops does not cover", () => {
            it("should not record a thread, since the record is what authorises a reply", async () => {
                // arrange - a channel posting with a bot that has no chat ops app behind it. What
                // is covered is worked out from the digest as a whole, in resolveChatOpsCoverage
                const sut = new SlackChannelConfig("slack", { channel: "#quiet" });
                sut.postToSlack = jest.fn().mockResolvedValue({ channel: "C2", ts: "1700000000.000200" }) as any;
                const alert = new AlertState({ channel: "slack", start_date: new Date() });

                // act
                await sut.sendNewAlert([], alert);

                // assert
                expect(await getChatThread("C2", "1700000000.000200")).toBeNull();
            });
        });
    });

    describe("the ongoing alert ping", () => {
        describe("with chat ops enabled", () => {
            it("should point people at the thread rather than telling them not to reply", async () => {
                // arrange
                const sut = new SlackChannelConfig("slack", {
                    channel: "#ops",
                    "chat-ops": { enabled: true }
                });
                const posted = [];
                sut.postToSlack = jest.fn().mockImplementation((msg: string) => {
                    posted.push(msg);
                    return Promise.resolve({ channel: "C1", ts: "1" });
                }) as any;
                const alert = new AlertState({ channel: "slack", start_date: new Date() });

                // act
                await sut.sendOngoingAlert([], alert);

                // assert
                expect(posted.some(x => x.includes("reply in the thread above"))).toEqual(true);
                expect(posted.some(x => x.includes("do not reply"))).toEqual(false);
            });
        });
        describe("without chat ops", () => {
            it("should keep the original wording", async () => {
                const sut = new SlackChannelConfig("slack", { channel: "#ops" });
                const posted = [];
                sut.postToSlack = jest.fn().mockImplementation((msg: string) => {
                    posted.push(msg);
                    return Promise.resolve({ channel: "C1", ts: "1" });
                }) as any;
                const alert = new AlertState({ channel: "slack", start_date: new Date() });
                await sut.sendOngoingAlert([], alert);
                expect(posted.some(x => x.includes("do not reply"))).toEqual(true);
            });
        });

        describe("its own thread", () => {

            const testDb = "dbslackping";
            const pingTs = "1700000000.000900";
            const alertTs = "1700000000.000100";

            beforeEach(async () => {
                deleteDbIfExists(testDb);
                await initConnection(testDb);
            });

            afterEach(async () => {
                await destroy();
                deleteDbIfExists(testDb);
            });

            function getSut(config: any = {}) {
                const sut = new SlackChannelConfig("slack", {
                    channel: "#ops",
                    "chat-ops": { enabled: true },
                    ...config
                });
                sut.postToSlack = jest.fn().mockResolvedValue({ channel: "C1", ts: pingTs }) as any;
                // posts an update to the alert message itself, which records its own thread
                sut.pingAboutOngoingAlert = jest.fn() as any;
                return sut;
            }

            function alertWithMessage() {
                return new AlertState({
                    channel: "slack",
                    start_date: new Date(),
                    state: JSON.stringify({ ts: alertTs, channel: "C1" })
                });
            }

            it("should be recorded as pointing at the alert's own thread", async () => {
                // arrange - without this a mention in the ping's thread matches nothing barky
                // knows and is dropped in silence, which reads like barky having stopped working
                const sut = getSut({ workspace: "codeo" });

                // act
                await sut.sendOngoingAlert([], alertWithMessage());

                // assert
                const thread = await getChatThread("C1", pingTs);
                expect(thread.pointsToTs).toEqual(alertTs);
                expect(thread.pointsToUrl).toEqual(`https://codeo.slack.com/archives/C1/p1700000000000100`);
            });
            it("should not be recorded as reporting the alerts", async () => {
                // arrange - barky deletes and reposts this message on every check, so a mute
                // asked for here would be confirmed in a message about to vanish
                const sut = getSut({ workspace: "codeo" });

                // act
                await sut.sendOngoingAlert([generateSnapshot()], alertWithMessage());

                // assert
                expect((await getChatThread("C1", pingTs)).alertIds).toEqual([]);
            });
            it("should be answerable where no workspace is configured to link to", async () => {
                // arrange
                const sut = getSut();

                // act
                await sut.sendOngoingAlert([], alertWithMessage());

                // assert
                const thread = await getChatThread("C1", pingTs);
                expect(thread.pointsToTs).toEqual(alertTs);
                expect(thread.pointsToUrl).toBeNull();
            });
            describe("for a channel chat ops does not cover", () => {
                it("should not be recorded, since the record is what authorises a reply", async () => {
                    // arrange
                    const sut = getSut({ "chat-ops": { enabled: false } });

                    // act
                    await sut.sendOngoingAlert([], alertWithMessage());

                    // assert
                    expect(await getChatThread("C1", pingTs)).toBeNull();
                });
            });
            describe("before barky has posted the alert itself", () => {
                it("should not be recorded, since there is nothing to point at", async () => {
                    // arrange
                    const sut = getSut({ workspace: "codeo" });

                    // act
                    await sut.sendOngoingAlert([], new AlertState({ channel: "slack", start_date: new Date() }));

                    // assert
                    expect(await getChatThread("C1", pingTs)).toBeNull();
                });
            });
        });
    });
});
