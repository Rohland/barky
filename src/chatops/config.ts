import { getEnvVar } from "../lib/env.js";
import { parsePeriodToMillis } from "../lib/period-parser.js";

export const DefaultSelectionTtl = "10m";
export const DefaultMaxMute = "7d";
export const DefaultAiUrl = "https://api.openai.com/v1";
export const DefaultAiTimeout = "15s";
export const DefaultAiMaxCallsPerHour = 60;

export class AiConfig {
    public apiKey: string;
    public model: string;
    public url: string;
    public timeoutMs: number;
    public maxCallsPerHour: number;

    constructor(config: any) {
        config ??= {};
        this.apiKey = getEnvVar(config["api-key"]);
        // left unset unless configured - the model is discovered from the api, so barky follows
        // the lineup rather than being pinned to a name that ages out
        this.model = config.model ?? null;
        this.url = (config.url ?? DefaultAiUrl).replace(/\/+$/, "");
        this.timeoutMs = parsePeriodToMillis(config.timeout ?? DefaultAiTimeout);
        this.maxCallsPerHour = config["max-calls-per-hour"] ?? DefaultAiMaxCallsPerHour;
    }

    public get configured(): boolean {
        return !!this.apiKey;
    }

    /*
     Two channels pointing at the same service, model and ceiling are one ai setup however many
     channels declare it, so they share a resolver - and with it the call budget, which is meant
     to be what barky spends in an hour rather than what each channel may spend.
     */
    public get signature(): string {
        return [this.apiKey, this.url, this.model, this.timeoutMs, this.maxCallsPerHour].join("|");
    }
}

export class ChatOpsConfig {
    public enabled: boolean;
    public appToken: string;
    public dashboardUrl: string;
    public selectionTtlMs: number;
    public maxMuteMs: number;
    public ai: AiConfig;

    constructor(config: any) {
        config ??= {};
        this.enabled = !!config.enabled;
        this.appToken = getEnvVar(config["app-token"]);
        this.dashboardUrl = config["dashboard-url"];
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
