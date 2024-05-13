import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { startClock, stopClock } from "../lib/profiler";
import { MonitorFailureResult, Result, WebResult } from "../models/result";
import { log } from "../models/logger";
import { IApp } from "../models/app";
import { BaseEvaluator, EvaluatorType } from "./base";
import { IUniqueKey } from "../lib/key";
import * as https from "node:https";
import { parsePeriodToHours } from "../lib/period-parser";

export class WebEvaluator extends BaseEvaluator {
    constructor(config: any) {
        super(config);
    }

    get type(): EvaluatorType {
        return EvaluatorType.web;
    }

    async tryEvaluate(app: IApp) {
        return await tryEvaluate(app);
    }

    configureApp(_app: IApp) {
    }

    protected generateSkippedAppUniqueKey(name: string): IUniqueKey {
        return {
            type: this.type,
            label: "*", // when skipped, we match on type:*:identifier (label is always set to health in any case)
            identifier: name
        };
    }

    protected async dispose(): Promise<void> {
        return;
    }

    protected isResultForApp(
        app: IApp,
        result: Result): boolean {
        return app.name === result.identifier;
    }
}

interface IWebValidator {
    text?: string;
    message?: string;
}

async function tryEvaluate(app: IApp) {
    try {
        return await evaluate(app);
    } catch (err) {
        return new MonitorFailureResult(
            "web",
            app.name,
            err.message,
            app);
    }
}

function transformWebResult(
    statusResult: number,
    expectedStatus: number,
    webResult: AxiosResponse<any, any>,
    app: IApp,
    date: Date,
    timeTaken: number) {
    const { success, msg } = evaluateResult(
        statusResult,
        expectedStatus,
        webResult,
        app.validators);
    const result = new WebResult(
        date,
        "health",
        app.name,
        success,
        statusResult,
        msg,
        timeTaken,
        app);
    log(`${ success === true ? "OK: " : "FAIL: " } ${ app.name } - ${ app.url } [${ timeTaken.toFixed(2) }ms]`);
    return result;
}

export function validateCertificateExpiry(
    app: IApp,
    date: Date,
    webResult: IWebResponse,
    results: WebResult[]) {
    if (!webResult?.certInfo || app.tls?.verify === false) {
        return;
    }
    const tlsConfig = app.tls ?? {
        verify: true,
        expiry: "7d"
    };
    const expiryHours = parsePeriodToHours(tlsConfig.expiry ?? "7d");
    const validTo = webResult.certInfo.validTo;
    const expiringInHours = ((+validTo - +new Date()) / 1000 / 60 / 60);
    if (expiringInHours > expiryHours) {
        return;
    }
    const hrsToExpiry = expiringInHours.toFixed(2);
    const daysToExpiry = expiringInHours / 24;
    const msg = `certificate expiring in ${ expiringInHours < 24 ? hrsToExpiry + " hours" : daysToExpiry.toFixed(1) + " days"}`;
    results.push(new WebResult(
        date,
        "cert-expiring",
        app.name,
        false,
        hrsToExpiry,
        msg,
        0,
        app));
    log(`FAIL: ${ app.url } ${ msg }`);
}

async function evaluate(app: IApp) {
    const url = app?.url;
    app.timeout ||= 5000;
    if (!url) {
        const error = `missing url for web app '${ app.name }'`;
        log(`error: ${ error })`);
        throw new Error(error);
    }
    const expectedStatus = app.status ?? 200;
    let statusResult, webResult: AxiosResponse;
    const timer = startClock();
    const date = new Date();
    try {
        webResult = await execWebRequest(app);
        statusResult = webResult.status;
    } catch (err) {
        const isTimeout = err.code === "ECONNABORTED" && stopClock(timer) >= app.timeout;
        statusResult = isTimeout ? `Timed out after ${ app.timeout }ms` : err.response?.status || (err.code ?? err.name ?? err.toString());
    }
    const timeTaken = stopClock(timer);
    const results = [transformWebResult(
        statusResult,
        expectedStatus,
        webResult,
        app,
        date,
        timeTaken)];
    validateCertificateExpiry(
        app,
        date,
        webResult,
        results);
    return results;
}

interface ICertInfo {
    validFrom: Date;
    validTo: Date;
}

export interface IWebResponse extends AxiosResponse {
    certInfo?: ICertInfo;
}

export async function execWebRequest(app: IApp): Promise<IWebResponse> {
    const method = app.method?.toLowerCase() ?? "get";
    const headers = getCustomHeaders(app.headers);
    const timeout = app.timeout ?? 5000;
    headers["user-agent"] = "barky";
    headers["accept-encoding"] ??= "gzip";
    const exec = axios[method];
    if (!exec) {
        throw new Error(`unsupported http method '${ method }'`);
    }
    let tlsCert;
    const request = {
        params: {
            __barky: new Date().valueOf()
        },
        headers,
        maxRedirects: app["max-redirects"] ?? 5,
        timeout,
        validateStatus: (_status) => true,
        httpsAgent: new https.Agent({
            rejectUnauthorized: app.tls?.verify ?? true
        }).on('keylog', (_, tlsSocket) => {
            const cInfo = tlsSocket.getPeerCertificate(false);
            const certHasExpiryInfo = cInfo.valid_to;
            if (certHasExpiryInfo) {
                tlsCert = cInfo;
            }
        })
    } as AxiosRequestConfig;
    const result = await exec(app.url, request);
    const certInfo = tlsCert ? getCertInfo(tlsCert) : null;
    return {
        ...result,
        certInfo
    };
}

function getCertInfo(tlsCert: any) {
    if (!tlsCert) {
        return null;
    }
    const validFrom = new Date(tlsCert.valid_from);
    const validTo = new Date(tlsCert.valid_to);
    return {
        validFrom,
        validTo
    };
}

function evaluateResult(
    status: number,
    expectedStatus: number,
    webResult: AxiosResponse,
    validators: IWebValidator[]) {
    if (status != expectedStatus) {
        return {
            success: false,
            msg: `Expected status:${ expectedStatus }, got ${ status }`
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

export function getCustomHeaders(headers: any): any {
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

export function isFailureWebResult(
    webResult: AxiosResponse,
    validator: IWebValidator) {
    if (validator?.text) {
        const text = typeof(webResult.data) === "object"
            ? JSON.stringify(webResult.data)
            : webResult.data;
        if (!text.toLowerCase().includes(validator.text.toString().toLowerCase())) {
            return true;
        }
    }
    return false;
}
