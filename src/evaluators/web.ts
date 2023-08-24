import axios from "axios";
import { startClock, stopClock } from "../lib/profiler";
import { MonitorFailureResult, WebResult } from "../models/result";
import { flatten } from "../lib/utility";

export async function webEvaluator(options, log) {
    log("evaluating web");
    const apps = getAppsToEvaluate(options.env);
    log(`found ${apps.length} sites to evaluate`);
    return await Promise.all(apps.map(app => tryEvaluate(app, log)));
}

function getAppsToEvaluate(options) {
    const appNames = Object.keys(options.web);
    const apps = [];
    for (let name of appNames) {
        const app = options.web[name];
        apps.push(expandAndConfigureApp(app, name));
    }
    return flatten(apps);
}

function expandAndConfigureApp(app, name) {
    const apps = app["vary-by"]?.length > 0
        ? app["vary-by"]
        : [app];
    return apps.map(variant => {
        return {
            ...app,
            name: (app.name ?? name).replaceAll("$1", variant),
            url: app.url?.replaceAll("$1", variant)
        };
    });
}

async function tryEvaluate(app, log) {
    try {
        return await evaluate(app, log);
    } catch (err) {
        return new MonitorFailureResult(
            "web",
            app.name,
            err.message,
            app.alert);
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
    const headers = app.headers ?? {};
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
                __ts: new Date().valueOf()
            },
            headers,
            timeout
        });
        statusResult = webResult.status;
    } catch (err) {
        statusResult = err.response?.status || (err.code ?? err.name ?? err.toString());
    }
    const timeTaken = stopClock(timer);
    const {success, msg} = evaluateResult(statusResult, expectedStatus, webResult, app.validators);
    const result = new WebResult(
        date,
        "health check",
        name,
        success,
        statusResult,
        msg,
        timeTaken,
        app.alert);
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
            msg: `Expected status:${expectedStatus},received ${status}`
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

function isFailureWebResult(webResult, validator) {
    if (validator.text) {
        if (!webResult.data.toLowerCase().includes(validator.text)) {
            return true;
        }
    }
    return false;
}
