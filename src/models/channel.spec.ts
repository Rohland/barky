import { ConsoleChannelConfig } from "./channels/console";
import { ChannelType } from "./channels/base";
import { getChannelConfigs } from "./channel";
import { SlackChannelConfig } from "./channels/slack";
import { SMSChannelConfig } from "./channels/sms";

describe("channels", () => {
    describe("getChannelConfigs", () => {

        function assertConsoleConfig(config: ConsoleChannelConfig) {
            expect(config.type).toEqual(ChannelType.Console);
            expect(config.name).toEqual("console");
            expect(config.notification_interval).toEqual("0m");
            expect(config.prefix).toEqual("");
            expect(config.postfix).toEqual("");
        }

        describe("with none", () => {
            it("should return array with console config", async () => {
                // arrange
                const digestConfig = {};

                // act
                const configs = getChannelConfigs(digestConfig);

                // assert
                expect(configs.length).toEqual(1);
                assertConsoleConfig(configs[0])
            });
        });
        describe("with channels", () => {
            describe("but empty", () => {
                it("should return array with console config", async () => {
                    // arrange
                    const digestConfig = { channels: {} };

                    // act
                    const configs = getChannelConfigs(digestConfig);

                    // assert
                    expect(configs.length).toEqual(1);
                    assertConsoleConfig(configs[0])
                });
            });
            describe("with unknown type", () => {
                it("should throw", async () => {
                    // arrange
                    const digestConfig = { channels: { "foo": { type: "bar" } } };

                    // act
                    // assert
                    expect(() => getChannelConfigs(digestConfig)).toThrowError("Unsupported channel type: 'bar'");
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
                                notification_interval: "30m"
                            }
                        }
                    };

                    // act
                    const config: ConsoleChannelConfig = getChannelConfigs(digestConfig)[0] as ConsoleChannelConfig;

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
                                notification_interval: "30m"
                            }
                        }
                    };

                    // act
                    const config: ConsoleChannelConfig = getChannelConfigs(digestConfig)[0] as ConsoleChannelConfig;

                    // assert
                    expect(config.title).toEqual("title");
                    expect(config.type).toEqual(ChannelType.Console);
                    expect(config.name).toEqual("foo");
                    expect(config.notification_interval).toEqual("30m");
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
                                notification_interval: "30m"
                            }
                        }
                    };

                    // act
                    const config: SlackChannelConfig = getChannelConfigs(digestConfig)[0] as SlackChannelConfig;

                    // assert
                    expect(config.type).toEqual(ChannelType.Slack);
                    expect(config.name).toEqual("foo");
                    expect(config.title).toEqual("title");
                    expect(config.prefix).toEqual("start");
                    expect(config.postfix).toEqual("end");
                    expect(config.channel).toEqual("123");
                    expect(config.notification_interval).toEqual("30m");
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
                                notification_interval: "30m"
                            }
                        }
                    };

                    // act
                    const configs = getChannelConfigs(digestConfig);
                    const config: SMSChannelConfig = configs[0] as SMSChannelConfig;

                    // assert
                    expect(configs.length).toEqual(2);
                    expect(config.type).toEqual(ChannelType.SMS);
                    expect(config.name).toEqual("foo");
                    expect(config.title).toEqual("title");
                    expect(config.prefix).toEqual("start");
                    expect(config.postfix).toEqual("end");
                    expect(config.notification_interval).toEqual("30m");
                    expect(config.contacts).toEqual(digestConfig.channels.foo.contacts);
                });
            });
        });
    });
});
