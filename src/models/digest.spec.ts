import { ConsoleChannelConfig } from "./channels/console";
import { ChannelType } from "./channels/base";
import { SlackChannelConfig } from "./channels/slack";
import { SMSChannelConfig } from "./channels/sms";
import { DigestConfiguration } from "./digest";
import { MuteWindow } from "./mute-window";

describe("digest", () => {
    describe("mute windows", () => {
        describe("with none", () => {
            describe.each([
                [null],
                [undefined],
                [{}],
                [{ "mute-windows": [] }]
            ])(`when config is %p`, (config) => {
                it("should instantiate with none", async () => {
                    // arrange
                    // act
                    const digest = new DigestConfiguration(config);

                    // assert
                    expect(digest.muteWindows).toEqual([]);
                });
            });
        });
        describe("with valid mute windows", () => {
            it("should configure them", async () => {
                // arrange
                const config = {
                    "mute-windows": [
                        {
                            "match": "\\dtest\\d",
                            "time": "00:00-1:00"
                        }
                    ]
                };

                // act
                const digest = new DigestConfiguration(config);

                // assert
                expect(digest.muteWindows.length).toEqual(1);
                expect(digest.muteWindows[0]).toBeInstanceOf(MuteWindow);
            });
        });
    });
    describe("channel configuration", () => {

        function assertConsoleConfig(config: ConsoleChannelConfig) {
            expect(config.type).toEqual(ChannelType.Console);
            expect(config.name).toEqual("console");
            expect(config.interval).toEqual("0m");
            expect(config.prefix).toEqual("");
            expect(config.postfix).toEqual("");
        }

        describe("with none", () => {
            it("should return array with console config", async () => {
                // arrange
                const digestConfig = {};

                // act
                const config = new DigestConfiguration(digestConfig);

                // assert
                expect(config.channelConfigs.length).toEqual(1);
                assertConsoleConfig(config.getChannelConfig("console"))
            });
        });
        describe("with channels", () => {
            describe("but empty", () => {
                it("should return array with console config", async () => {
                    // arrange
                    const digestConfig = { channels: {} };

                    // act
                    const config = new DigestConfiguration(digestConfig);

                    // assert
                    expect(config.channelConfigs.length).toEqual(1);
                    assertConsoleConfig(config.getChannelConfig("console"))
                });
            });
            describe("with unknown type", () => {
                it("should throw", async () => {
                    // arrange
                    const digestConfig = { channels: { "foo": { type: "bar" } } };

                    // act
                    // assert
                    expect(() => new DigestConfiguration(digestConfig)).toThrowError("Unsupported channel type: 'bar'");
                });
            });
            describe("with prefix and postfix including vars", () => {
                it("should render them out", async () => {
                    // arrange
                    const digestConfig = {
                        title: "custom_title",
                        channels: {
                            "foo": {
                                template: {
                                    prefix: "{{title}} start",
                                    postfix: "end {{title}}"
                                },
                                type: "console",
                                interval: "30m"
                            }
                        }
                    };
                    const digest = new DigestConfiguration(digestConfig);

                    // act
                    const config: ConsoleChannelConfig = digest.getChannelConfig("foo") as ConsoleChannelConfig;

                    // assert
                    expect(config.prefix).toEqual("custom_title start");
                    expect(config.postfix).toEqual("end custom_title");
                });
            });
            describe("with console type", () => {
                it("should generate instance of console type", async () => {
                    const digestConfig = {
                        title: "title",
                        channels: {
                            "foo": {
                                template: {
                                    prefix: "start",
                                    postfix: "end"
                                },
                                type: "console",
                                interval: "30m"
                            }
                        }
                    };
                    const digest = new DigestConfiguration(digestConfig);

                    // act
                    const config: ConsoleChannelConfig = digest.getChannelConfig("foo") as ConsoleChannelConfig;

                    // assert
                    expect(config.title).toEqual("title");
                    expect(config.type).toEqual(ChannelType.Console);
                    expect(config.name).toEqual("foo");
                    expect(config.interval).toEqual("30m");
                    expect(config.prefix).toEqual("start");
                    expect(config.postfix).toEqual("end");
                });
            });
            describe("with slack type", () => {
                it("should generate instance of Slack config", async () => {
                    // arrange
                    process.env["slack_token"] = "secret_slack_token";
                    const digestConfig = {
                        title: "title",
                        channels: {
                            "foo": {
                                template: {
                                    prefix: "start",
                                    postfix: "end"
                                },
                                type: "slack",
                                token: "slack_token",
                                channel: "123",
                                interval: "30m"
                            }
                        }
                    };
                    const digest = new DigestConfiguration(digestConfig);

                    // act
                    const config = digest.getChannelConfig("foo") as SlackChannelConfig;

                    // assert
                    expect(config.type).toEqual(ChannelType.Slack);
                    expect(config.name).toEqual("foo");
                    expect(config.title).toEqual("title");
                    expect(config.prefix).toEqual("start");
                    expect(config.postfix).toEqual("end");
                    expect(config.channel).toEqual("123");
                    expect(config.interval).toEqual("30m");
                    expect(config.token).toEqual("secret_slack_token");
                });
            });
            describe("with sms config", () => {
                it("should generate instance of SMS Config", async () => {
                    // arrange
                    const digestConfig = {
                        title: "title",
                        channels: {
                            "foo": {
                                template: {
                                    prefix: "start",
                                    postfix: "end"
                                },
                                type: "SMS",
                                contacts: [
                                    {
                                        name: "Joe",
                                        mobile: "1234567890"
                                    }
                                ],
                                interval: "30m"
                            }
                        }
                    };
                    const digest = new DigestConfiguration(digestConfig);

                    // act
                    const config = digest.getChannelConfig("foo") as SMSChannelConfig;

                    // assert
                    expect(digest.channelConfigs.length).toEqual(2);
                    expect(config.type).toEqual(ChannelType.SMS);
                    expect(config.name).toEqual("foo");
                    expect(config.title).toEqual("title");
                    expect(config.prefix).toEqual("start");
                    expect(config.postfix).toEqual("end");
                    expect(config.interval).toEqual("30m");
                    expect(config.contacts).toEqual(digestConfig.channels.foo.contacts);
                });
            });
        });
    });
});
