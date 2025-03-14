import { parsePeriod } from "../lib/period-parser";
import { MonitorLog } from "./log";
import { DayAndTimeEvaluator } from "../lib/time";
import { ChannelType } from "./channels/base";

export interface IAlertRule {
    isDefault?: boolean;
    description?: string;
    count?: number;
    any?: number;
    window?: string;
    days?: string[];
    time?: string | string[];
    match?: string;
}

export interface IAlertLink {
    label: string;
    url: string;
}

export interface IAlertConfig {
    channels?: string[];
    rules?: IAlertRule[];
    links?: IAlertLink[];
    "exception-policy"?: string;
}

export enum AlertRuleType {
    ConsecutiveCount,
    AnyInWindow
}

const DefaultAlertRule = {
    count: 1
};

export class AlertRule {
    public description?: string;
    public count?: number;
    public any?: number;
    public fromDate?: Date;
    public match?: string;
    private _isDefault: boolean;
    private _dayAndTimeEvaluator: DayAndTimeEvaluator;

    constructor(rule: IAlertRule) {
        this._isDefault = rule.isDefault ?? false;
        this.description = rule.description;
        this.count = rule.count;
        this.any = rule.any;
        this.match = rule.match;
        const noTypeConfigured = !this.count && !this.any;
        if (noTypeConfigured) {
            this.count = 1;
        }
        const window = rule.window ? rule.window : "-5m";
        this.fromDate = parsePeriod(window.startsWith("-") ? window : `-${ window }`)
        this._dayAndTimeEvaluator = new DayAndTimeEvaluator(rule.days, rule.time);
    }

    get type(): AlertRuleType {
        return this.count > 0
            ? AlertRuleType.ConsecutiveCount
            : AlertRuleType.AnyInWindow;
    }

    isValidNow(date?: Date): boolean {
        return this._dayAndTimeEvaluator.isValidNow(date);
    }

    get isNotValidNow(): boolean {
        return this.isDefault || !this.isValidNow();
    }

    isFailureInWindowGivenLogs(logs: MonitorLog[]) {
        const count = logs.filter(x => x.date >= this.fromDate && !x.success).length;
        return count >= this.any;
    }

    isFailureForConsecutiveCount(previousLogs: MonitorLog[]) {
        const count = previousLogs.length;
        return count >= this.count;
    }

    get isDefault(): boolean {
        return this._isDefault;
    }

    public static Default(): AlertRule {
        return new AlertRule({
            ...DefaultAlertRule,
            isDefault: true
        });
    }

    getLogCountToClear(length: number) {
        const count = length - this.count;
        return count < 0 ? 0 : count;
    }

    isMatchFor(uniqueId: string): boolean {
        return this.match && new RegExp(this.match, "i").test(uniqueId);
    }
}

export class AlertConfiguration {
    private readonly _config: any;
    public channels: string[];
    public rules: AlertRule[];
    public exceptionPolicyName?: string;
    public links: IAlertLink[];

    constructor(config: IAlertConfig) {
        this._config = config;
        this.channels = config.channels ?? [];
        this.addWebChannel();
        this.rules = config.rules?.map(x => new AlertRule(x)) ?? [];
        this.exceptionPolicyName = config["exception-policy"];
        this.links = (config.links ?? []).filter(x => !!x.label && !!x.url);
    }

    private addWebChannel() {
        if (this.channels.includes(ChannelType.Web)) {
            return;
        }
        this.channels.push(ChannelType.Web); // always include this channel type in the alert configuration
    }

    public getConfig(): IAlertConfig {
        return this._config;
    }

    public findFirstValidRule(uniqueId: string, date: Date = null): AlertRule {
        if (!this.rules || this.rules.length === 0) {
            return AlertRule.Default();
        }
        const rules = this.rules.filter(x => x.isMatchFor(uniqueId));
        const noDirectlyMatchedRules = rules.length === 0;
        if (noDirectlyMatchedRules) {
            return this.rules.find(x => !x.match && x.isValidNow(date)) ?? null;
        }
        return rules.find(x => x.isValidNow(date)) ?? null;
    }
}
