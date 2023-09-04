import axios from "axios";
import { parsePeriodRange } from "../lib/period-parser";
import { sleepMs } from "../lib/sleep";
import { MonitorFailureResult, SumoResult } from "../models/result";
import { startClock, stopClock } from "../lib/profiler";
import { renderTemplate } from "../lib/renderer";
import { log } from "../models/logger";
import { EvaluatorResult } from "./types";
import { getAppVariations, IApp } from "../models/app";
import { BaseEvaluator } from "./base";
import { IUniqueKey } from "../lib/key";

const SumoDomain = process.env["sumo-domain"] ?? "api.eu.sumologic.com";
const SumoUrl = `https://${ SumoDomain }/api/v1/search/jobs`;
const JobPollMillis = 1000;

export class SumoEvaluator extends BaseEvaluator {
    constructor(config: any) {
        super(config);
    }

    get type(): string {
        return "sumo";
    }

    configureAndExpandApp(app: IApp, name: string): IApp[] {
        return getAppVariations(app, name).map(variant => {
            return {
                timeout: 10000,
                ...app,
                ...variant,
                period: parsePeriodRange(app.period ?? "-5m to 0m"),
            };
        });
    }

    async evaluate(): Promise<EvaluatorResult> {
        const apps = this.getAppsToEvaluate();
        const results = await Promise.all(apps.map(app => tryEvaluate(app)));
        return {
            results,
            apps
        };
    }

    protected generateSkippedAppUniqueKey(name: string): IUniqueKey {
        return {
            type: this.type,
            label: name,
            identifier: "*" // when skipped, we want to match all identifiers under the type:label
        };
    }
}

async function tryEvaluate(app) {
    try {
        const timer = startClock();
        app.jobId = await startSearch(app, log);
        await isJobComplete(app, log);
        const results = await getSearchResult(app, log);
        app.timeTaken = stopClock(timer);
        return validateResults(app, results, log);
    } catch (err) {
        log(`error executing sumo evaluator for '${ app.name }': ${ err.message }`, err);
        return new MonitorFailureResult(
            "sumo",
            app.name,
            err.message,
            app);
    }
}

function validateResults(app, data, log) {
    const entries = data.records?.map(x => x.map);
    return entries.map(x => validateEntry(app, x, log));
}

function validateEntry(app, entry, _log) {
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

interface IRule {
    expression: string;
    message: string;
}

export function findTriggerRulesFor(identifier, app): IRule[] {
    const triggers = app.triggers;
    if (!triggers || triggers.length === 0) {
        throw new Error("expected sumo app configuration to have triggers, but did not");
    }
    const trigger = triggers.find(x => new RegExp(x.match, "i").test(identifier));
    if (!trigger) {
        throw new Error(`expected to find one trigger that matched ${ identifier } but did not`);
    }
    if (!trigger.rules || trigger.rules.length === 0) {
        throw new Error(`expected to find one or more rules for trigger but did not`);
    }
    return trigger.rules;
}

async function startSearch(app, _log) {
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
    return result.data.id;
}

async function isJobComplete(app, log) {
    const now = +new Date();
    while (+new Date() - now < app.timeout) {
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
}

async function getSearchResult(app, _log) {
    const result = await axios.get(`${ SumoUrl }/${ app.jobId }/records?offset=0&limit=100`, getHeaders(app.token));
    return result.data;
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
