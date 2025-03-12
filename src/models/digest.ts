import { ChannelConfig, ChannelType } from "./channels/base";
import { getChannelConfigFor } from "./channel";
import { AlertConfiguration } from "./alert_configuration";
import { MonitorFailureResult, Result } from "./result";
import { log } from "./logger";
import { MuteWindow } from "./mute-window";

export class DigestConfiguration {
    public channelConfigs: ChannelConfig[];
    public alertPolicies: Map<string, AlertConfiguration>;
    public muteWindows: MuteWindow[];
    private _noDigest: boolean;

    constructor(config: any) {
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
