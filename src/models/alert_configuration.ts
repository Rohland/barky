import { parseDaysOfWeek, parsePeriod, parseTimeRange } from "../lib/period-parser";
import { dayOfWeek, flatten } from "../lib/utility";
import { MonitorLog } from "./log";
import { Time } from "../lib/time";

export interface IAlertRule {
    description?: string;
    count?: number;
    any?: number;
    window?: string;
    days?: string[];
    time?: string | string[];
}

export interface IAlertConfig {
    channels?: string[];
    rules?: IAlertRule[];
    "exception-policy"?: string;
}

export enum AlertRuleType {
    ConsecutiveCount,
    AnyInWindow
}

export class AlertRule {
    public description?: string;
    public count?: number;
    public any?: number;
    public fromDate?: Date;
    private _daysOfWeek?: number[];
    private _timesOfDay: string[];

    constructor(rule: IAlertRule) {
        this.description = rule.description;
        this.count = rule.count;
        this.any = rule.any;
        const noTypeConfigured = !this.count && !this.any;
        if (noTypeConfigured) {
            this.count = 1;
        }
        const window = rule.window ? rule.window : "-5m";
        this.fromDate = parsePeriod(window.startsWith("-") ? window : `-${ window }`)
        this._daysOfWeek = parseDaysOfWeek(rule.days);
        this._timesOfDay = rule.time ? flatten([rule.time]) : [];
    }

    get type(): AlertRuleType {
        return this.count > 0
            ? AlertRuleType.ConsecutiveCount
            : AlertRuleType.AnyInWindow;
    }

    isValidNow(date?: Date): boolean {
        const hasDateRule = this._daysOfWeek?.length > 0;
        const hasTimeRule = this._timesOfDay.length > 0;
        if (hasDateRule) {
            return this.isToday(date);
        }
        if (hasTimeRule) {
            return this.isValidAtTime(date);
        }
        return true;
    }

    private isValidAtTime(date?: Date): boolean {
        const now = date ?? new Date();
        const time = new Time(now);
        for(const entry of this._timesOfDay) {
            if (!entry?.trim()){
                continue;
            }
            const period = parseTimeRange(entry);
            const isWithinPeriod = time.isBetween(period.start, period.end);
            if (isWithinPeriod) {
                return true;
            }
        }
        return false;
    }

    private isToday(date?: Date): boolean {
        date = date ?? new Date();
        const dayOfWeekInTimezone = dayOfWeek(date);
        return this._daysOfWeek.includes(dayOfWeekInTimezone);
    }

    isFailureInWindowGivenLogs(logs: MonitorLog[]) {
        const count = logs.filter(x => x.date >= this.fromDate && !x.success).length;
        return count >= this.any;
    }

    isFailureForConsecutiveCount(previousLogs: MonitorLog[]) {
        const count = previousLogs.length;
        return count >= this.count;
    }
}

export class AlertConfiguration {
    private readonly _config: any;
    public channels: string[];
    public rules: AlertRule[];
    public exceptionPolicyName?: string;

    constructor(config: IAlertConfig) {
        this._config = config;
        this.channels = config.channels ?? [];
        this.rules = config.rules?.map(x => new AlertRule(x)) ?? [];
        this.exceptionPolicyName = config["exception-policy"];
    }

    public getConfig(): IAlertConfig {
        return this._config;
    }

    public findFirstValidRule(): AlertRule {
        if (!this.rules || this.rules.length === 0) {
            return new AlertRule({
                count: 1
            });
        }
        const result = this.rules.find(x => x.isValidNow());
        return result ?? null;
    }
}
