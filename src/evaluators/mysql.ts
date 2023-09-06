import mysql from "mysql2/promise";
import { startClock, stopClock } from "../lib/profiler";
import { renderTemplate } from "../lib/renderer";
import { MonitorFailureResult, MySqlResult, Result } from "../models/result";
import { log } from "../models/logger";
import { EvaluatorResult } from "./types";
import { getAppVariations, IApp } from "../models/app";
import { BaseEvaluator, EvaluatorType } from "./base";
import { IUniqueKey } from "../lib/key";
import { flatten } from "../lib/utility";

export class MySqlEvaluator extends BaseEvaluator {
    constructor(config: any) {
        super(config);
    }

    public get type(): EvaluatorType {
        return EvaluatorType.mysql;
    }

    configureAndExpandApp(app: IApp, name: string): IApp[] {
        return getAppVariations(app, name).map(variant => {
            return {
                timeout: 15000,
                ...app,
                ...variant,
            };
        });
    }

    public async evaluate(): Promise<EvaluatorResult> {
        const apps = this.getAppsToEvaluate();
        try {
            const results = flatten(await Promise.all(apps.map(app => tryEvaluate(app))));
            return {
                results,
                apps
            };
        } finally {
            disposeConnections();
        }
    }

    protected generateSkippedAppUniqueKey(name: string): IUniqueKey {
        return {
            type: this.type,
            label: name,
            identifier: "*" // when skipped, we want to match all identifiers under the type:label
        };
    }
}

async function tryEvaluate(app): Promise<Result | Result[]> {
    try {
        const connection = await getConnection(app);
        const timer = startClock();
        const results = await runQuery(connection, app);
        app.timeTaken = stopClock(timer);
        return validateResults(app, results);
    } catch (err) {
        log(`Error evaluating app ${ app.name }: ${ err.message }`, err);
        return new MonitorFailureResult(
            "mysql",
            app.name,
            err.message,
            app);
    }
}

export function validateResults(app, results): Result[] {
    return results.map(row => {
        const identifier = row[app.identifier] ?? app.identifier;
        const trigger = findTriggerForRow(identifier, app.triggers);
        return validateRow(app, identifier, row, trigger);
    });
}

function findTriggerForRow(identifier, triggers) {
    const trigger = (triggers ?? []).find(trigger => {
        const regex = new RegExp(trigger.match, "i");
        if (regex.test(identifier)) {
            return trigger;
        }
    });
    if (!trigger) {
        throw new Error(`Could not find trigger for row with identifier: ${ identifier }`);
    }
    return trigger;
}

function generateVariablesAndValues(row, app) {
    const variables = Object.keys(row).filter(x => x !== app.identifier);
    const values = {};
    const emit: Array<string> = app.emit ?? [];
    const shouldEmitAll = emit.length === 0;
    variables.forEach(x => {
        if (shouldEmitAll || emit.includes(x)) {
            values[x] = row[x];
        }
    });
    return { variables, values };
}

export function validateRow(
    app,
    identifier,
    row,
    trigger): MySqlResult {
    if (!trigger.rules || trigger.rules.length === 0) {
        throw new Error(`trigger for app '${ app.name }' has no rules`);
    }
    convertRowValuesToInferredType(row);
    let failure = false;
    const { variables, values } = generateVariablesAndValues(row, app);
    const msgs = [];
    trigger.rules.find(rule => {
        const variableDefinitions = variables.map(x => `const ${ x } = ${ generateValueForVariable(row[x]) }`).join(";");
        const expression = `;${ rule.expression }`;
        const fail = eval(variableDefinitions + expression);
        failure ||= fail;
        if (fail) {
            msgs.push(renderTemplate(rule.message, row, { humanizeNumbers: true }));
        }
    });
    return new MySqlResult(
        `${ app.name }`,
        identifier,
        values,
        msgs,
        app.timeTaken,
        !failure,
        app
    );
}

function convertRowValuesToInferredType(entry) {
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
    if (isNumber) {
        return valueAsNumber.toFixed(3);
    } else {
        return `'${ value }'`;
    }
}

async function runQuery(connection: mysql.Connection, app) {
    const timeout = app.timeout ?? 15000;
    const timeoutSeconds = Math.round(timeout / 1000);
    const query = `set innodb_lock_wait_timeout=${ timeoutSeconds }; ${ app.query }`;
    const results = await connection.query({
        sql: query,
        timeout: app.timeout ?? 15000,
    });
    let resultIndex = parseInt(app["result-index"]);
    if (Number.isNaN(resultIndex)) {
        // @ts-ignore
        resultIndex = results[0].length;
    }
    const rows = results[0][resultIndex > 0 ? resultIndex - 1 : 0];
    return Array.isArray(rows) ? rows : [rows];
}

let connections: mysql.Connection[] = [];

function configureSSLForConnection(app, config: {
    ssl: {}
}) {
    const sslDisabledValue = process.env[`mysql-${ app.connection }-ssl-disabled`];
    if (!sslDisabledValue) {
        return;
    }
    const disabledValues = ["1", "true"];
    const disabled = disabledValues.includes(sslDisabledValue.toLowerCase().trim());
    if (disabled) {
        config.ssl["rejectUnauthorized"] = false;
    }
}

export async function getConnection(app): Promise<mysql.Connection> {
    const config = {
        host: process.env[`mysql-${ app.connection }-host`],
        user: process.env[`mysql-${ app.connection }-user`],
        password: process.env[`mysql-${ app.connection }-password`],
        port: process.env[`mysql-${ app.connection }-port`],
        database: process.env[`mysql-${ app.connection }-database`],
        timezone: 'Z',
        multipleStatements: true,
        ssl: {}
    };
    configureSSLForConnection(app, config);
    // @ts-ignore
    const connection = await mysql.createConnection(config);
    connections.push(connection);
    return connection;
}

export function disposeConnections() {
    connections.forEach(x => {
        try {
            x.destroy();
        } catch {
            // no-op
        }
    });
    connections = [];
}

