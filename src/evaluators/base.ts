import { EvaluatorResult } from "./types";
import { AppVariant, IApp } from "../models/app";
import { flatten } from "../lib/utility";
import { log } from "../models/logger";
import { parsePeriodToMillis, parsePeriodToSeconds } from "../lib/period-parser";
import { LoopMs } from "../loop";
import { IUniqueKey } from "../lib/key";
import { DefaultTrigger, IRule } from "../models/trigger";
import { DayAndTimeEvaluator } from "../lib/time";
import { MonitorFailureResult, Result } from "../models/result";
import { startClock, stopClock } from "../lib/profiler";

const executionCounter = new Map<string, number>();

export function resetExecutionCounter() {
    executionCounter.clear();
}

export enum EvaluatorType {
    "web" = "web",
    "mysql" = "mysql",
    "sumo" = "sumo",
    "shell" = "shell"
};

export abstract class BaseEvaluator {

    private _globalConfig: any;
    private _skippedApps: IUniqueKey[] = [];

    constructor(config: any) {
        this._globalConfig = config || {};
    }

    public async evaluateApps(): Promise<EvaluatorResult> {
        try {
            const results = await this.evaluate();
            this.detectAnyDuplicateIdentifiers(results.results);
            results.skippedApps ||= [];
            results.skippedApps.push(...(this.skippedApps || []));
            const appResults = results.results;
            const apps = results.apps;
            apps.forEach(app => {
                const hasResultOrWasSkipped =
                    appResults.find(result => this.isResultForApp(app, result))
                    || results.skippedApps.find(x => x.name === app.name);
                if (!hasResultOrWasSkipped) {
                    log(`No result found for app ${ app.name }`);
                    results.skippedApps.push({
                        ...app,
                        ...this.generateSkippedAppUniqueKey(app.name)
                    });
                }
            });
            return results;
        } finally {
            if (typeof this.dispose === "function") {
                await this.dispose();
            }
        }
    }

    protected abstract isResultForApp(app: IApp, result: Result): boolean;

    public async evaluate(): Promise<EvaluatorResult> {
        const apps = this.getAppsToEvaluate();
        const results = await Promise.allSettled(apps.map(async app => {
            try {
                const timer = startClock();
                const results = await this.tryEvaluate(app);
                const timeTaken = stopClock(timer);
                [results].flat().map(x => x.timeTaken ||= timeTaken);
                return results;
            } catch (err) {
                try {
                    const errorInfo = new Error(err.message);
                    errorInfo.stack = err.stack;
                    // @ts-ignore
                    errorInfo.response = {
                        status: err?.response?.status,
                        data: err?.response.data
                    };
                    log(`error executing ${ app.type } evaluator for '${ app.name }': ${ err.message }`, errorInfo);
                } catch {
                    // no-op
                }
                return new MonitorFailureResult(
                    app.type,
                    app.name,
                    err.message,
                    app);
            }
        }));
        // see above - we don't expect any failures, as we catch errors
        const values = results.map(x => x.status === "fulfilled" ? x.value : null).filter(x => !!x);
        return {
            results: values.flat(),
            apps
        };
    }

    protected abstract tryEvaluate(app: IApp): Promise<Result | Result []>;

    protected abstract generateSkippedAppUniqueKey(name: string): IUniqueKey;

    protected abstract dispose(): Promise<void>;

    abstract configureApp(app: IApp): void;

    abstract get type(): EvaluatorType;

    public get config(): any {
        return this._globalConfig[this.type] || {};
    }

    public get skippedApps(): IApp[] {
        return this._skippedApps;
    }

    public getAppsToEvaluate(): IApp[] {
        const appNames = Object.keys(this.config);
        const apps = [];
        for (let name of appNames) {
            const app = this.config[name];
            app.name ??= name;
            const expanded = this.getAppVariations(app);
            expanded.forEach(x => {
                this.configureApp(x);
                x.timeout = parsePeriodToMillis(x.timeout ?? 10000);
                x.type = this.type;
                if (this.shouldEvaluateApp(x)) {
                    apps.push(x);
                }
            });
        }
        const expanded = flatten(apps);
        log(`found ${ expanded.length } ${ this.type } checks to evaluate`);
        return expanded;
    }

    private shouldEvaluateApp(app: IApp): boolean {
        if (!app.every) {
            return true;
        }
        const durationMs = parsePeriodToSeconds(app.every) * 1000;
        const everyCount = Math.round(durationMs / LoopMs);
        const key = `${ this.type }-${ app.name }`;
        const count = executionCounter.get(key) ?? 0;
        const shouldEvaluate = count % everyCount === 0;
        executionCounter.set(key, count + 1);
        if (!shouldEvaluate) {
            log(`skipping ${ this.type } check for '${ app.name }' - every set to: ${ app.every }`);
            this.skippedApps.push({
                ...app,
                ...this.generateSkippedAppUniqueKey(app.name)
            });
        }
        return shouldEvaluate;
    }

    public getAppVariations(app: any): IApp[] {
        if (!app) {
            return [];
        }
        const variations = app["vary-by"]?.length > 0
            ? app["vary-by"]
            : [null];
        return variations.map(instance => {
            const variant = new AppVariant(app, instance);
            return {
                ...app,
                ...variant,
            };
        });
    }

    private detectAnyDuplicateIdentifiers(results: Result | Result[]) {
        const entries = [results].flat();
        const lookup = new Map<string, number>();
        entries.forEach(result => {
            let count = 0;
            const uniqueId = result.uniqueId;
            if (lookup.has(uniqueId)) {
                count = lookup.get(uniqueId) + 1;
                result.identifier = `${ result.identifier}-${ count }`;
            }
            lookup.set(uniqueId, count);
        });
    }
}

export function findTriggerRulesFor(
    identifier: string,
    app: IApp,
    date?: Date): IRule[] {
    const triggers = app.triggers;
    if (!triggers || triggers.length === 0) {
        return DefaultTrigger.rules;
    }
    const trigger = triggers.find(x => new RegExp(x.match, "i").test(identifier));
    if (!trigger) {
        return DefaultTrigger.rules;
    }
    const rules = findMatchingTriggerRulesValidRightNow(trigger.rules, date);
    return rules.length === 0
        ? DefaultTrigger.rules
        : rules;
}

function findMatchingTriggerRulesValidRightNow(
    rules: IRule[],
    date?: Date): IRule[] {
    return (rules ?? []).filter(rule => {
        const dayAndTimeEvaluator = new DayAndTimeEvaluator(rule.days, rule.time);
        return dayAndTimeEvaluator.isValidNow(date);
    });
}

export function generateValueForVariable(value: string | number) {
    // @ts-ignore
    const valueAsNumber = parseFloat(value);
    const isNumber = !Number.isNaN(valueAsNumber);
    if (isNumber) {
        // @ts-ignore
        const isRound = parseInt(value) === valueAsNumber;
        return isRound ? valueAsNumber : valueAsNumber.toFixed(3);
    } else {
        return JSON.stringify(value);
    }
}
