import axios from "axios";
import { parsePeriodRange } from "../lib/period-parser";
import { sleepMs } from "../lib/sleep";
import { MonitorFailureResult, Result, SumoResult } from "../models/result";
import { startClock, stopClock } from "../lib/profiler";
import { renderTemplate } from "../lib/renderer";
import { log } from "../models/logger";
import { getAppVariations, IApp } from "../models/app";
import { BaseEvaluator, EvaluatorType, findTriggerRulesFor } from "./base";
import { IUniqueKey } from "../lib/key";

const SumoDomain = process.env["sumo-domain"] ?? "api.eu.sumologic.com";
const SumoUrl = `https://${ SumoDomain }/api/v1/search/jobs`;
const JobPollMillis = 1000;

export class SumoEvaluator extends BaseEvaluator {
    constructor(config: any) {
        super(config);
    }

    get type(): EvaluatorType {
        return EvaluatorType.sumo;
    }

    configureAndExpandApp(app: IApp): IApp[] {
        return getAppVariations(app).map(variant => {
            return {
                timeout: 10000,
                ...app,
                ...variant,
                period: parsePeriodRange(app.period ?? "-5m to 0m"),
            };
        });
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
        app.timeTaken = stopClock(timer);
        const finalResults = validateResults(app, results, log);
        return finalResults.length > 0
            ? finalResults
            : new SumoResult( // no result means OK for all identifiers!
                app.name,
                "*",
                "inferred",
                "OK",
                app.timeTaken,
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

function generateValueForVariable(value) {
    const valueAsNumber = parseFloat(value);
    const isNumber = !Number.isNaN(valueAsNumber);
    ;
    if (isNumber) {
        return valueAsNumber.toFixed(3);
    } else {
        return `'${ value }'`;
    }
}

async function startSearch(app, log) {
    const search = {
        query: app.query,
        from: toSumoTime(app.period.from),
        to: toSumoTime(app.period.to),
        timeZone: "UTC",
        autoParsingMode: "intelligent"
    };
    const result = await axios.post(
        SumoUrl,
        search,
        getHeaders(app.token));
    log(`started sumo job search for '${ app.name }'`, result.data);
    return result.data.id;
}

async function isJobComplete(app, log) {
    const startTime = +new Date();
    while (+new Date() - startTime < app.timeout) {
        try {
            const status = await axios.get(`${ SumoUrl }/${ app.jobId }`, getHeaders(app.token));
            if (status.data.state.match(/done gathering results/i)) {
                return status.data;
            }
            await sleepMs(JobPollMillis);
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
        const result = await axios.get(`${ SumoUrl }/${ app.jobId }/records?offset=0&limit=100`, getHeaders(app.token));
        log(`successfully completed sumo job search for '${ app.name }', result:`, result.data);
        return result.data;
    } catch(err) {
        log(`failed to complete sumo job search for '${ app.name }', result:`, err.response?.data);
        throw err;
    }
}

async function deleteJob(app, log) {
    try {
        await axios.delete(`${ SumoUrl }/${ app.jobId }`, getHeaders(app.token));
    } catch (error) {
        log("error: could not delete job", { app, error });
        // no-op
    }
}

function getHeaders(tokenName) {
    if (!process.env[tokenName]) {
        throw new Error(`missing sumo logic env var with name '${ tokenName }'`);
    }
    return {
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Basic ${ Buffer.from(process.env[tokenName]).toString('base64') }`
        }
    };
}

function toSumoTime(date) {
    return date.toISOString().split(".")[0];
}
