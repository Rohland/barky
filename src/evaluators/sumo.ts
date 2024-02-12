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

const SumoDomain = process.env["sumo-domain"] ?? "api.eu.sumologic.com";
const SumoUrl = `https://${ SumoDomain }/api/v1/search/jobs`;

const JobPollMillis = 1000;
// sumo logic queries tend to be quite slow (upwards of 2-3s+), so no point in polling every second right from the outset
// that may lead to rate limits being reached
const JobInitialPollMillis = 3000;

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
    }

    async tryEvaluate(app: IApp) {
        return await tryEvaluate(app);
    }

    protected generateSkippedAppUniqueKey(name: string): IUniqueKey {
        return {
            type: this.type,
            label: name,
            identifier: "*" // when skipped, we want to match all identifiers under the type:label
        };
    }

    protected async dispose(): Promise<void> {
        return;
    }

    protected isResultForApp(app: IApp, result: Result): boolean {
        return app.name === result.label;
    }
}

async function tryEvaluate(app: IApp) {
    try {
        const timer = startClock();
        app.jobId = await startSearch(app, log);
        await isJobComplete(app, log);
        const results = await getSearchResult(app, log);
        const timeTaken = stopClock(timer);
        const finalResults = validateResults(app, results, log);
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
        log(`error executing sumo evaluator for '${ app.name }': ${ err.message }`, errorInfo);
        return new MonitorFailureResult(
            "sumo",
            app.name,
            err.message,
            app);
    }
}

function validateResults(app: IApp, data, log) {
    const entries = data.records?.map(x => x.map);
    return entries.map(x => validateEntry(app, x, log));
}

function validateEntry(app: IApp, entry, _log) {
    const identifier = entry[app.identifier];
    if (!identifier) {
        throw new Error(`expected to find identifier field in result set named: ${ app.identifier }`);
    }
    convertEntryValuesToInferredType(entry);
    const rules = findTriggerRulesFor(identifier, app);
    let failure = false;
    const variables = Object.keys(entry).filter(x => x !== app.identifier);
    const values = {};
    variables.forEach(x => values[x] = entry[x]);
    const msgs = [];
    rules.forEach(rule => {
        const variableDefinitions = variables.map(x => `const ${ x } = ${ generateValueForVariable(entry[x]) }`).join(";");
        const expression = `;${ rule.expression }`;
        const fail = eval(variableDefinitions + expression);
        failure ||= fail;
        if (fail) {
            msgs.push(renderTemplate(rule.message, entry, { humanizeNumbers: true }));
        }
    });
    return new SumoResult(
        `${ app.name }`,
        identifier,
        values,
        msgs,
        app.timeTaken,
        !failure,
        app
    );
}

function convertEntryValuesToInferredType(entry) {
    Object.entries(entry).forEach(([key, value]) => {
        const valueAsFloat = parseFloat(value as string);
        const isFloat = !Number.isNaN(valueAsFloat);
        if (!isFloat) {
            return;
        }
        const valueAsInt = parseInt(value as string);
        const isInt = valueAsInt == valueAsFloat;
        entry[key] = isInt ? valueAsInt : valueAsFloat.toFixed(3);
    });
}

async function startSearch(app, log) {
    const search = {
        query: app.query,
        from: toSumoTime(app.period.from),
        to: toSumoTime(app.period.to),
        timeZone: "UTC",
        autoParsingMode: "intelligent"
    };
    const result = await executeSumoRequest(() => axios.post(
        SumoUrl,
        search,
        getRequestConfig(app.token))
    );
    log(`started sumo job search for '${ app.name }'`, result.data);
    return result.data.id;
}

async function isJobComplete(app, log) {
    const startTime = +new Date();
    let pollCount = 0;
    while (+new Date() - startTime < app.timeout) {
        try {
            const status = await executeSumoRequest(() => axios.get(`${ SumoUrl }/${ app.jobId }`, getRequestConfig(app.token)));
            if (status.data.state.match(/done gathering results/i)) {
                return status.data;
            }
            await sleepMs(pollCount === 0 ? JobInitialPollMillis : JobPollMillis);
            pollCount++;
        } catch (err) {
            await deleteJob(app, log);
            throw err;
        }
    }
    const timedOutAfter = +new Date() - startTime;
    // job failed
    try {
        await deleteJob(app, log);
    } finally {
        throw new Error(`timed out after ${ timedOutAfter }ms`);
    }
}

async function getSearchResult(app, log) {
    try {
        const result = await executeSumoRequest(() => axios.get(`${ SumoUrl }/${ app.jobId }/records?offset=0&limit=100`, getRequestConfig(app.token)));
        log(`successfully completed sumo job search for '${ app.name }', result:`, result.data);
        return result.data;
    } catch(err) {
        log(`failed to complete sumo job search for '${ app.name }', result:`, err.response?.data);
        throw err;
    }
}

async function deleteJob(app, log) {
    try {
        await executeSumoRequest(() => axios.delete(`${ SumoUrl }/${ app.jobId }`, getRequestConfig(app.token)));
    } catch (error) {
        log("error: could not delete job", { app, error });
        // no-op
    }
}

function getRequestConfig(tokenName): AxiosRequestConfig {
    if (!process.env[tokenName]) {
        throw new Error(`missing sumo logic env var with name '${ tokenName }'`);
    }
    return {
        timeout: 10000,
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Basic ${ Buffer.from(process.env[tokenName]).toString('base64') }`
        }
    };
}

function toSumoTime(date: Date): string {
    return date.toISOString().split(".")[0];
}



interface ISumoRequest {
    request: () => Promise<any>;
    resolve: (res: any) => void;
    reject: (err: Error) => void;
}

const MAX_SUMO_CONCURRENCY = 3; // sumo logic has strict concurrency rules, limited to 10 per key - let's be cautious
const sumoRequestQueue: ISumoRequest[] = [];
const sumoExecutingRequests: ISumoRequest[] = [];

export async function executeSumoRequest<T>(request: () => Promise<T>): Promise<T> {
    let resolve, reject;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    sumoRequestQueue.push({
        request,
        resolve,
        reject
    });
    rateLimitSumoRequests();
    return await promise;
}

function rateLimitSumoRequests() {
    const requests = sumoRequestQueue.splice(0, MAX_SUMO_CONCURRENCY - sumoExecutingRequests.length);
    if (requests.length === 0) {
        return;
    }
    sumoExecutingRequests.push(...requests);
    requests.map(x => x.request()
        .then((res) => {
            x.resolve(res);
            sumoExecutingRequests.splice(sumoExecutingRequests.indexOf(x), 1);
            rateLimitSumoRequests();
        })
        .catch((err: Error) => {
            x.reject(err);
            sumoExecutingRequests.splice(sumoExecutingRequests.indexOf(x), 1);
            rateLimitSumoRequests();
    }));
}
