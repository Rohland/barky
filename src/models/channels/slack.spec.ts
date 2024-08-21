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
                expect(msg).toContain("*Duration:* `1 hr`");
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
                expect(msg).toContain("*Duration:* `1 hr`");
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
            it("should post an update without mutating state", async () => {
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

                // act
                await sut.sendOngoingAlert(snapshots, alertState);

                // assert
                const after = JSON.stringify(alertState);
                expect(after).toEqual(before);
                expect(sut.postToSlack).toHaveBeenCalledWith(
                    '🔥 <!channel> Woof! Alert ongoing: `40 problems` for `1 hr`. See above ☝️',
                    null);
                expect(sut.pingAboutOngoingAlert).toHaveBeenCalledWith(snapshots, alertState);
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
                        channel: 'reply-channel'
                    })
                });
                const before = JSON.stringify(alertState);
                sut.postToSlack = jest.fn();
                sut.pingAboutOngoingAlert = jest.fn();

                // act
                await sut.sendOngoingAlert(snapshots, alertState);

                // assert
                const after = JSON.stringify(alertState);
                expect(after).toEqual(before);
                expect(sut.postToSlack).toHaveBeenCalledWith(
                    '🔥 <!channel> Woof! Alert ongoing: `40 problems` for `1 hr`. <https://codeo.slack.com/archives/reply-channel/p123|See above ☝️>',
                    null);
                expect(sut.pingAboutOngoingAlert).toHaveBeenCalledWith(snapshots, alertState);
            });
        });
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
