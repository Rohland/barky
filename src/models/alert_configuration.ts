import { parsePeriod } from "../lib/period-parser";
import { MonitorLog } from "./log";
import { DayAndTimeEvaluator } from "../lib/time";

export interface IAlertRule {
    isDefault?: boolean;
    description?: string;
    count?: number;
    any?: number;
    window?: string;
    days?: string[];
    time?: string | string[];
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
    private _isDefault: boolean;
    private _dayAndTimeEvaluator: DayAndTimeEvaluator;

    constructor(rule: IAlertRule) {
        this._isDefault = rule.isDefault ?? false;
        this.description = rule.description;
        this.count = rule.count;
        this.any = rule.any;
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

    get isNotValidNow() : boolean {
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
        return count < 0 ? 0: count;
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
        this.rules = config.rules?.map(x => new AlertRule(x)) ?? [];
        this.exceptionPolicyName = config["exception-policy"];
        this.links = (config.links ?? []).filter(x => !!x.label && !!x.url);
    }

    public getConfig(): IAlertConfig {
        return this._config;
    }

    public findFirstValidRule(): AlertRule {
        if (!this.rules || this.rules.length === 0) {
            return AlertRule.Default();
        }
        const result = this.rules.find(x => x.isValidNow());
        return result ?? null;
    }
}
