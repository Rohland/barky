import axios from "axios";
import { startClock, stopClock } from "../lib/profiler";
import { MonitorFailureResult, WebResult } from "../models/result";
import { log } from "../models/logger";
import { EvaluatorResult } from "./types";
import { getAppVariations, IApp } from "../models/app";
import { BaseEvaluator, EvaluatorType } from "./base";
import { IUniqueKey } from "../lib/key";

export class WebEvaluator extends BaseEvaluator {
    constructor(config: any) {
        super(config);
    }

    get type(): EvaluatorType {
        return EvaluatorType.web;
    }

    async evaluate(): Promise<EvaluatorResult> {
        const apps = this.getAppsToEvaluate();
        const results = await Promise.all(apps.map(app => tryEvaluate(app)));
        return {
            results,
            apps
        };
    }

    configureAndExpandApp(app: IApp, name: string): IApp[] {
        return getAppVariations(app, name).map(variant => {
            return {
                ...app,
                ...variant
            };
        });
    }

    protected generateSkippedAppUniqueKey(name: string): IUniqueKey {
        return {
            type: this.type,
            label: "*", // when skipped, we match on type:*:identifier (label is always set to health in any case)
            identifier: name
        };
    }
}

async function tryEvaluate(app) {
    try {
        return await evaluate(app, log);
    } catch (err) {
        return new MonitorFailureResult(
            "web",
            app.name,
            err.message,
            app);
    }
}

async function evaluate(app, log) {
    const url = app?.url;
    const name = app.name;
    if (!url) {
        const error = `missing url for web app '${ name }'`;
        log(`error: ${ error })`);
        throw new Error(error);
    }
    const method = app.method ?? "get";
    const headers = getCustomHeaders(app.headers);
    const expectedStatus = app.status ?? 200;
    const timeout = app.timeout ?? 5000;
    headers["user-agent"] = "barky";
    headers["accept-encoding"] ??= "gzip";
    const exec = axios[method];
    let statusResult;
    const timer = startClock();
    const date = new Date();
    let webResult;
    try {
        webResult = await exec(url, {
            params: {
                __barky: new Date().valueOf()
            },
            headers,
            maxRedirects: app["max-redirects"] ?? 5,
            timeout
        });
        statusResult = webResult.status;
    } catch (err) {
        const isTimeout = err.code === "ECONNABORTED" && stopClock(timer) >= timeout;
        statusResult = isTimeout ? `Timed out after ${ timeout }ms` : err.response?.status || (err.code ?? err.name ?? err.toString());
    }
    const timeTaken = stopClock(timer);
    const {success, msg} = evaluateResult(
        statusResult,
        expectedStatus,
        webResult,
        app.validators);
    const result = new WebResult(
        date,
        "health",
        name,
        success,
        statusResult,
        msg,
        timeTaken,
        app);
    log(`${success === true ? "OK: " : "FAIL: "} ${name} - ${url} [${timeTaken.toFixed(2)}ms]`);
    return result;
}

function evaluateResult(
    status,
    expectedStatus,
    webResult,
    validators) {
    if (status != expectedStatus) {
        return {
            success: false,
            msg: `Expected status:${expectedStatus}, got ${status}`
        };
    }

    let failure;
    if (validators && validators.length > 0) {
        const failedValidator = validators.find(validator => isFailureWebResult(webResult, validator));
        failure = failedValidator ? (failedValidator?.message ?? "failed validator") : null;
    }

    return {
        success: !failure,
        msg: failure ?? "OK"
    };
}

export function getCustomHeaders(headers) {
    headers ??= {};
    for (const key in headers) {
        const value = (headers[key] ?? "").toString();
        const match = value.match(/^\$(.*)$/);
        if (match) {
            const envVar = process.env[match[1]];
            if (!envVar) {
                log(`warning: environment variable used in custom header, '${ match[1] }' not found`)
            }
            headers[key] = process.env[match[1]] ?? value;
        }
    }
    return headers;
}

export function isFailureWebResult(webResult, validator) {
    if (validator?.text) {
        if (!webResult.data.toLowerCase().includes(validator.text.toString().toLowerCase())) {
            return true;
        }
    }
    return false;
}
