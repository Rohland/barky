import { getEnvVar } from "../lib/env.js";
import { IBusinessHours } from "../lib/time.js";
import { parsePeriodToMillis } from "../lib/period-parser.js";

export const DefaultMaxAlertsListed = 20;
export const DefaultSelectionTtl = "10m";
export const DefaultMaxMute = "7d";
export const DefaultAiModel = "gpt-4o-mini";
export const DefaultAiBaseUrl = "https://api.openai.com/v1";
export const DefaultAiTimeout = "10s";
export const DefaultAiMaxCallsPerHour = 60;

export class AiConfig {
    public apiKey: string;
    public model: string;
    public baseUrl: string;
    public timeoutMs: number;
    public maxCallsPerHour: number;

    constructor(config: any) {
        config ??= {};
        this.apiKey = getEnvVar(config["api-key"]);
        this.model = config.model ?? DefaultAiModel;
        this.baseUrl = (config["base-url"] ?? DefaultAiBaseUrl).replace(/\/+$/, "");
        this.timeoutMs = parsePeriodToMillis(config.timeout ?? DefaultAiTimeout);
        this.maxCallsPerHour = config["max-calls-per-hour"] ?? DefaultAiMaxCallsPerHour;
    }

    public get configured(): boolean {
        return !!this.apiKey;
    }
}

export class ChatOpsConfig {
    public enabled: boolean;
    public appToken: string;
    public dashboardUrl: string;
    public maxAlertsListed: number;
    public businessHours: IBusinessHours;
    public selectionTtlMs: number;
    public maxMuteMs: number;
    public ai: AiConfig;

    constructor(config: any) {
        config ??= {};
        this.enabled = !!config.enabled;
        this.appToken = getEnvVar(config["app-token"]);
        this.dashboardUrl = config["dashboard-url"];
        this.maxAlertsListed = config["max-alerts-listed"] ?? DefaultMaxAlertsListed;
        const businessHours = config["business-hours"] ?? {};
        this.businessHours = {
            days: businessHours.days,
            start: businessHours.start
        };
        this.selectionTtlMs = parsePeriodToMillis(config["selection-ttl"] ?? DefaultSelectionTtl);
        this.maxMuteMs = parsePeriodToMillis(config["max-mute"] ?? DefaultMaxMute);
        this.ai = new AiConfig(config.ai);
    }

    /*
     Anyone who can see the channel can mute - channel membership is the authorisation boundary,
     so there is deliberately no user allowlist here.
     */
    public get configured(): boolean {
        return this.enabled && !!this.appToken;
    }

    public get dashboardHint(): string {
        return this.dashboardUrl
            ? `the <${ this.dashboardUrl }|alerts dashboard>`
            : "the alerts dashboard";
    }
}
