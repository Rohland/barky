import { SlackChannelConfig } from "./slack.js";
import { SlackApi } from "./slack-api.js";
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
        });
        describe("for a channel without chat ops", () => {
            it("should not record a thread, since the record is what authorises a reply", async () => {
                // arrange - another slack channel having chat ops on must not make this one's
                // threads actionable
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
    });
});
