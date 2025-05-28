import axios, { AxiosRequestConfig } from "axios";
import { parsePeriodRange } from "../lib/period-parser";
import { sleepMs } from "../lib/sleep";
import { MonitorFailureResult, Result, SumoResult } from "../models/result";
import { startClock, stopClock } from "../lib/profiler";
import { renderTemplate } from "../lib/renderer";
import { log } from "../models/logger";
import { IApp } from "../models/app";
import { BaseEvaluator, EvaluatorType, findTriggerRulesFor, generateValueForVariable } from "./base";
import { IUniqueKey } from "../lib/key";
import { RateLimiter } from "../lib/rate-limiter";
import { getEnvVar } from "../lib/env";

const SumoDomain = getEnvVar("sumo-domain") ?? "api.eu.sumologic.com";
const SumoLogsUrl = `https://${SumoDomain}/api/v1/search/jobs`;
const SumoMetricsUrl = `https://${SumoDomain}/api/v1/metrics/results`;

const JobPollMillis = 1000;
// sumo logic queries tend to be quite slow (upwards of 2-3s+), so no point in polling every second right from the outset
// that may lead to rate limits being reached
const JobInitialPollMillis = 3000;

// sumo logic has strict concurrency rules, limited to 10 per key - let's be cautious
const MaxSumoConcurrency = 3;
const MaxSumoRequestsPerSecond = 5;

export class SumoEvaluator extends BaseEvaluator {
    constructor(config: any) {
        super(config);
    }

    get type(): EvaluatorType {
        return EvaluatorType.sumo;
    }

    configureApp(app: IApp) {
        app.timeout ??= 10000;
        app.period = parsePeriodRange(app.period ?? "-5m to 0m");
        app.mode ??= "logs";
    }

    protected generateSkippedAppUniqueKey(name: string): IUniqueKey {
        return {
            type: this.type,
            label: name,
            identifier: "*" // when skipped, we want to match all identifiers under the type:label
        };
    }

    public async dispose(): Promise<void> {
        return;
    }

    protected isResultForApp(app: IApp, result: Result): boolean {
        return app.name === result.label;
    }

    async tryEvaluate(app: IApp) {
        try {
            const timer = startClock();
            app._job = await this.startSearch(app);
            await this.isJobComplete(app);
            const results = await this.getSearchResult(app);
            const timeTaken = stopClock(timer);
            const finalResults = this.validateResults(app, results);
            return finalResults.length > 0
                ? finalResults
                : new SumoResult( // no result means OK for all identifiers!
                    app.name,
                    "*",
                    "inferred",
                    "OK",
                    timeTaken,
                    true,
                    app);
        } catch (err) {
            const errorInfo = new Error(err.message);
            errorInfo.stack = err.stack;
            // @ts-ignore
            errorInfo.response = {
                status: err?.response?.status,
                data: err?.response?.data
            };
            log(`error executing sumo evaluator for '${app.name}': ${err.message}`, errorInfo);
            return new MonitorFailureResult(
                "sumo",
                app.name,
                err.message,
                app);
        }
    }

    validateResults(app: IApp, data: any) {
        const entries = Array.isArray(data)
            ? data
            : data.records?.map(x => x.map);
        super.fillMissing(app, entries);
        if (entries.length === 0) {
            return this.processEmptyResult(app);
        }
        return entries.map(x => this.validateEntry(app, x));
    }

    private processEmptyResult(app: IApp) {
        const emptyRule = app.triggers.find(x => typeof x.empty === "string");
        if (!emptyRule) {
            return [];
        }
        return [new SumoResult(
            app.name,
            "-",
            0,
            emptyRule.empty,
            app.timeTaken,
            false,
            app)];
    }

    public validateEntry(app: IApp, entry: any) {
        const identifier = this.getIdentifierValueForObject(
            entry,
            app.identifier,
            app.name);
        this.convertItemValuesToInferredType(entry);
        const rules = findTriggerRulesFor(identifier, app);
        let failure = false;
        const { variables, values, emit } = this.generateVariablesAndValues(entry, app);
        const msgs = [];
        rules.forEach(rule => {
            const variableDefinitions = this.generateVariableJsDefinitions(variables, values);
            const expression = `;${rule.expression}`;
            const script = variableDefinitions + expression;
            const fail = eval(script);
            failure ||= fail;
            if (fail) {
                msgs.push(renderTemplate(rule.message, values));
            }
        });
        return new SumoResult(
            `${app.name}`,
            identifier,
            emit,
            msgs,
            app.timeTaken,
            !failure,
            app
        );
    }

    generateVariableJsDefinitions(variables: string[], entry: any) {
        const usedKeys = new Set();
        const vars = variables.map(key => {
            const varValue = generateValueForVariable(entry[key]);
            usedKeys.add(key);
            return `let ${key} = ${varValue};`;
        });
        variables.forEach(key => {
            const loweredKey = key.toLowerCase();
            if (usedKeys.has(loweredKey)) {
                return;
            }
            usedKeys.add(loweredKey);
            const value = generateValueForVariable(entry[key]);
            vars.push(`let ${loweredKey} = ${value};`);
        });
        const variableString = vars.join("\n");
        return variableString;
    }

    async startSearch(app: IApp) {
        if (this.isLogsMode(app)) {
            return this.startLogSearch(app);
        }
        if (this.isMetricsMode(app)) {
            return this.startMetricSearch(app);
        }
        throw new Error(`unsupported sumo mode: ${app.mode}`);
    }

    async startLogSearch(app: IApp) {
        const search = {
            query: app.query,
            from: toSumoTime(app.period.from),
            to: toSumoTime(app.period.to),
            timeZone: "UTC",
            autoParsingMode: "intelligent"
        };
        const result = await executeSumoRequest(app.token, () => axios.post(
            SumoLogsUrl,
            search,
            getRequestConfig(app.token))
        );
        log(`started sumo job search for '${app.name}'`, result.data);
        return result.data.id;
    }

    async startMetricSearch(app: IApp) {
        const search = {
            query: [
                {
                    query: app.query,
                    rowId: "result"
                }],
            // metrics endpoint expects epoch
            endTime: +app.period.to,
            startTime: +app.period.from,
        };
        const result = await executeSumoRequest(app.token, () => axios.post(
            SumoMetricsUrl,
            search,
            getRequestConfig(app.token))
        );
        log(`started sumo metric search for '${app.name}'`, result.data);
        const response = result.data?.response;
        if (!response || response.length === 0) {
            throw new Error(`unsupported sumo metric response for ${app.name}, response: ${JSON.stringify(result.data)}`);
        }
        log(`raw metrics result: ${JSON.stringify(result.data)}`);
        return parseMetricResults(response[0].results);
    }

    async isJobComplete(app: IApp) {
        if (!this.isLogsMode(app)) {
            return;
        }
        const startTime = +new Date();
        let pollCount = 0;
        await sleepMs(JobInitialPollMillis);
        while (+new Date() - startTime < app.timeout) {
            try {
                const status = await executeSumoRequest(app.token, () => axios.get(`${SumoLogsUrl}/${app._job}`, getRequestConfig(app.token)));
                if (status.data.state.match(/done gathering results/i)) {
                    return status.data;
                }
                await sleepMs(JobPollMillis);
                pollCount++;
            } catch (err) {
                await this.deleteJob(app);
                throw err;
            }
        }
        const timedOutAfter = +new Date() - startTime;
        await sleepMs(JobPollMillis);
        // job failed
        try {
            await this.deleteJob(app);
        } finally {
            throw new Error(`timed out after ${timedOutAfter}ms`);
        }
    }

    async getSearchResult(app: IApp) {
        if (this.isMetricsMode(app)) {
            return app._job;
        }
        try {
            const result = await executeSumoRequest(app.token, () => axios.get(`${SumoLogsUrl}/${app._job}/records?offset=0&limit=100`, getRequestConfig(app.token)));
            log(`successfully completed sumo job search for '${app.name}', result:`, result.data);
            return result.data;
        } catch (err) {
            log(`failed to complete sumo job search for '${app.name}', result:`, err.response?.data);
            throw err;
        }
    }

    async deleteJob(app: IApp) {
        try {
            await executeSumoRequest(app.token, () => axios.delete(`${SumoLogsUrl}/${app._job}`, getRequestConfig(app.token)));
        } catch (error) {
            log("error: could not delete job", { app, error });
            // no-op
        }
    }

    private isLogsMode(app: IApp) {
        return /logs/i.test(app.mode);
    }

    private isMetricsMode(app: IApp) {
        return /metric/i.test(app.mode);
    }
}

function getRequestConfig(tokenName: string): AxiosRequestConfig {
    if (!getEnvVar(tokenName)) {
        throw new Error(`missing sumo logic env var with name '${tokenName}'`);
    }
    return {
        timeout: 10000,
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Basic ${Buffer.from(getEnvVar(tokenName)).toString('base64')}`
        }
    };
}

function toSumoTime(date: Date): string {
    return date.toISOString().split(".")[0];
}

const rateLimiters = new Map<string, RateLimiter>();

export async function executeSumoRequest<T>(
    key: string,
    request: () => Promise<T>): Promise<T> {
    let limiter = rateLimiters.get(key) ?? new RateLimiter(MaxSumoRequestsPerSecond, MaxSumoConcurrency);
    rateLimiters.set(key, limiter);
    return await limiter.execute(request);
}

export function parseMetricResults(results: any[]) {
    return results.map(x => {
        const obj = {};
        x.metric.dimensions?.forEach((dimension) => {
            const key = dimension.key.replace(/[^_a-z0-9]/gi, "_");
            obj[key] = dimension.value;
        });
        Object.keys(x.horAggs).forEach((metric) => {
            obj[metric] = x.horAggs[metric];
        });
        return obj;
    });
}
