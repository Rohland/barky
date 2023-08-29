import { EvaluatorResult } from "./types";
import { IApp } from "../models/app";
import { flatten } from "../lib/utility";
import { log } from "../models/logger";
import { parsePeriodToSeconds } from "../lib/period-parser";
import { LoopMs } from "../loop";
import { IUniqueKey } from "../lib/key";

const executionCounter = new Map<string, number>();

export function resetExecutionCounter() {
    executionCounter.clear();
}

export abstract class BaseEvaluator {

    private _globalConfig: any;
    private _skippedApps: IUniqueKey[] = [];

    constructor(config: any) {
        this._globalConfig = config;
    }

    public async evaluateApps(): Promise<EvaluatorResult> {
        const results = await this.evaluate();
        results.skippedApps = this._skippedApps;
        return results;
    }

    protected abstract evaluate(): Promise<EvaluatorResult>;

    protected abstract generateSkippedAppUniqueKey(name: string): IUniqueKey;

    abstract configureAndExpandApp(app: IApp, name: string): IApp[];

    abstract get type(): string;

    public get config(): any {
        return this._globalConfig[this.type];
    }

    public get skippedApps(): IApp[] {
        return this._skippedApps;
    }

    public getAppsToEvaluate(): IApp[] {
        const appNames = Object.keys(this.config);
        const apps = [];
        for (let name of appNames) {
            const app = this.config[name];
            const expanded = this.configureAndExpandApp(app, name);
            expanded.forEach(x => {
                x.type = this.type;
                if (this.shouldEvaluateApp(x, name)) {
                    apps.push(x);
                }
            });
        }
        const expanded = flatten(apps);
        log(`found ${ expanded.length } ${ this.type } checks to evaluate`);
        return expanded;
    }

    private shouldEvaluateApp(
        app: IApp,
        name: string): boolean {
        if (!app.every) {
            return true;
        }
        const durationMs = parsePeriodToSeconds(app.every) * 1000;
        const everyCount = Math.round(durationMs / LoopMs);
        const key = `${ this.type }-${ name }`;
        const count = executionCounter.get(key) ?? 0;
        const shouldEvaluate = count % everyCount === 0;
        executionCounter.set(key, count + 1);
        if (!shouldEvaluate) {
            log(`skipping ${ this.type } check for '${ name }' - every set to: ${ app.every }`);
            this.skippedApps.push( {
                ...app,
                ...this.generateSkippedAppUniqueKey(name)
            });
        }
        return shouldEvaluate;
    }
}