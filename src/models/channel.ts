import { ConsoleChannelConfig } from "./channels/console";
import { SMSChannelConfig } from "./channels/sms";
import { SlackChannelConfig } from "./channels/slack";
import { ChannelConfig, ChannelType } from "./channels/base";
import { WebChannelConfig } from "./channels/web";

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
        case ChannelType.Web:
            return new WebChannelConfig(name, config);
        default:
            throw new Error(`Unsupported channel type: '${ config.type }'`);
    }
}
