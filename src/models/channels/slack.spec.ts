import { SlackChannelConfig } from "./slack";
import { Snapshot } from "../snapshot";
import { AlertState } from "../alerts";

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
});
