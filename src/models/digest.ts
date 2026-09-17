import { ChannelConfig, ChannelType } from "./channels/base.js";
import { getChannelConfigFor } from "./channel.js";
import { SlackChannelConfig } from "./channels/slack.js";
import { resolveChatOpsCoverage } from "../chatops/coverage.js";
import { AlertConfiguration } from "./alert_configuration.js";
import { MonitorFailureResult, Result } from "./result.js";
import { log } from "./logger.js";
import { MuteWindow } from "./mute-window.js";

export interface IDigestConfig {
    "alert-policies"?: any;
    "mute-windows"?: any[];
    "channels"?: any;
    "monitor"?: any;
}

export class DigestConfiguration {
    public channelConfigs: ChannelConfig[];
    public alertPolicies: Map<string, AlertConfiguration>;
    public muteWindows: MuteWindow[];
    private _noDigest: boolean;

    constructor(config: IDigestConfig) {
        this._noDigest = !config;
        this.extractChannelConfig(config);
        this.extractAlertPolicies(config);
        this.extractMuteWindows(config);
    }

    private extractAlertPolicies(config: any) {
        this.alertPolicies = new Map();
        const alertPolicies = (config ?? {})["alert-policies"] ?? {};
        Object.keys(alertPolicies).forEach(policy => {
            this.alertPolicies.set(policy, new AlertConfiguration(alertPolicies[policy]));
        });
    }

    private extractMuteWindows(config) {
        const candidates = (config ?? [])["mute-windows"] ?? [];
        this.muteWindows = candidates.map(x => new MuteWindow(x));
    }

    private extractChannelConfig(config: any) {
        config = config ?? {};
        config.channels ??= {};
        config.channels.console ??= {
            type: "console",
            name: "console",
            interval: "0m"
        };
        config.channels.web ??= {
            type: "web",
            name : "web",
            interval: "0m"
        };
        const title = config.title ?? "";
        const keys = Object.keys(config.channels);
        this.channelConfigs = keys.map(name => {
            const channelConfig = config.channels[name];
            channelConfig.title ??= title;
            return getChannelConfigFor(name, channelConfig);
        });
        this.applyChatOpsCoverage(config);
    }

    /*
     Chat ops answers in every channel the app it is configured on posts to, not only the channel
     that declared it. Each of those has to note which alerts its messages were reporting, since a
     reply barky has no note for is one it will not act on.
     */
    private applyChatOpsCoverage(config: any) {
        const covered = new Set(resolveChatOpsCoverage(config).apps
            .flatMap(app => app.channels)
            .map(x => x.name));
        this.channelConfigs
            .filter(x => x instanceof SlackChannelConfig)
            .forEach(x => x.applyChatOpsCoverage(covered));
    }

    public trackChannelConfigIssues(results: Result[]) {
        if (!this.configured) {
            return;
        }
        const issues = [];
        const types = this.channelConfigs.map(x => x.name);
        results.forEach(x => {
            x.app?.alert?.channels?.forEach(channel => {
                if (channel === ChannelType.Web) {
                    // no need to validate the web channel config, its internal
                    return;
                }
                if (!types.includes(channel)) {
                    issues.push(
                        new MonitorFailureResult(
                            x.type,
                            x.identifier,
                            `Channel '${ channel }' not found in digest config`
                        )
                    );
                }
            });
        });
        issues.forEach(i => results.push(i));
    }

    getChannelConfig(channel: string): ChannelConfig | null {
        const config = this.channelConfigs.find(x => x.name === channel);
        if (!config) {
            log(`Channel ${ channel } not found in digest configuration`);
        }
        return config;
    }

    getAlertPolicy(name: string) {
        const policy = this.alertPolicies.get(name);
        if (!policy) {
            throw new Error(`alert exception policy '${ name }' not found in digest config`);
        }
        return policy;
    }

    get configured(): boolean {
        return !this._noDigest;
    }
}
