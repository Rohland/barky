import { ConsoleChannelConfig } from "./channels/console.js";
import { SMSChannelConfig } from "./channels/sms.js";
import { SlackChannelConfig } from "./channels/slack.js";
import { ChannelConfig, ChannelType } from "./channels/base.js";
import { WebChannelConfig } from "./channels/web.js";

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
