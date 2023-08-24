import { ConsoleChannelConfig } from "./channels/console";
import { SMSChannelConfig } from "./channels/sms";
import { SlackChannelConfig } from "./channels/slack";
import { ChannelConfig, ChannelType } from "./channels/base";

export function getChannelConfigFor(
    name: string,
    config: any): ChannelConfig {
    if (!config.type) {
        throw new Error("expected channel config to have a type");
    }
    switch (config.type?.toLowerCase()) {
        case ChannelType.Console:
            return new ConsoleChannelConfig(name, config);
        case ChannelType.Slack:
            return new SlackChannelConfig(name, config);
        case ChannelType.SMS:
            return new SMSChannelConfig(name, config);
        default:
            throw new Error(`Unsupported channel type: '${ config.type }'`);
    }
}

export function getChannelConfigs(digestConfig: any): ChannelConfig[] {
    const config = digestConfig ?? { };
    config.channels ??= {};
    config.channels.console ??= {
        type: "console",
        name: "console",
        notification_interval: "0m"
    };
    const title = config.title ?? "";
    const keys = Object.keys(config.channels);
    return keys.map(name => {
        const channelConfig = config.channels[name];
        channelConfig.title ??= title;
       return getChannelConfigFor(name, channelConfig);
    });
}
