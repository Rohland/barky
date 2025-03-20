import { SlackChannelConfig } from "./slack";
import { Snapshot } from "../snapshot";
import { AlertState } from "../alerts";
import * as os from "os";

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
        const result = await sut.postToSlack(msg, null, false);
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
});
