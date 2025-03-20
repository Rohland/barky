import mysql from "mysql2/promise";
import { renderTemplate } from "../lib/renderer";
import { MonitorFailureResult, MySqlResult, Result } from "../models/result";
import { log } from "../models/logger";
import { IApp } from "../models/app";
import { BaseEvaluator, EvaluatorType, findTriggerRulesFor, generateValueForVariable } from "./base";
import { IUniqueKey } from "../lib/key";
import { IRule } from "../models/trigger";
import { getEnvVar, getEnvVarAsBoolean } from "../lib/env";

export class MySqlEvaluator extends BaseEvaluator {
    constructor(config: any) {
        super(config);
    }

    public get type(): EvaluatorType {
        return EvaluatorType.mysql;
    }

    public configureApp(app: IApp) {
        app.timeout ??= 15000;
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
        await disposeConnections();
    }

    protected isResultForApp(app: IApp, result: Result): boolean {
        return app.name === result.label;
    }
}

async function tryEvaluate(app: IApp): Promise<Result | Result[]> {
    try {
        const connection = await getConnection(app);
        const results = await runQuery(connection, app);
        const finalResults = validateResults(app, results);
        return finalResults.length > 0
            ? finalResults
            : new MySqlResult( // no results from mysql means OK for all identifiers!
                app.name,
                "*",
                "inferred",
                "OK",
                0,
                true,
                app);
    } catch (err) {
        log(`Error evaluating app ${ app.name }: ${ err.message }`, err);
        return new MonitorFailureResult(
            "mysql",
            app.name,
            err.message,
            app);
    }
}

export function validateResults(app: IApp, results: Result[]): Result[] {
    return results.map(row => {
        const identifier = row[app.identifier] ?? app.identifier;
        const rules = findTriggerRulesFor(identifier, app);
        return validateRow(app, identifier, row, rules);
    });
}

function generateVariablesAndValues(row: any, app: IApp) {
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
    app: IApp,
    identifier: string,
    row: object,
    rules: IRule[]): MySqlResult {
    if (!rules || rules.length === 0) {
        throw new Error(`trigger for app '${ app.name }' has no rules`);
    }
    convertRowValuesToInferredType(row);
    let failure = false;
    const { variables, values } = generateVariablesAndValues(row, app);
    const msgs = [];
    rules.find(rule => {
        const variableDefinitions = variables.map(x => `const ${ x } = ${ generateValueForVariable(row[x]) }`).join(";");
        const expression = `;${ rule.expression }`;
        const fail = eval(variableDefinitions + expression);
        failure ||= fail;
        if (fail) {
            msgs.push(renderTemplate(rule.message, row));
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

async function runQuery(
    connection: mysql.Connection,
    app: IApp) {
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

function configureSSLForConnection(app: IApp, config: any) {
    const sslDisabledValue = getEnvVarAsBoolean(`mysql-${ app.connection }-ssl-disabled`);
    if (!sslDisabledValue) {
        return;
    }
    config.ssl ??= {};
    config.ssl["rejectUnauthorized"] = false;
}

export async function getConnection(app: IApp): Promise<mysql.Connection> {
    const config = {
        host: getEnvVar(`mysql-${ app.connection }-host`),
        user: getEnvVar(`mysql-${ app.connection }-user`),
        password: getEnvVar(`mysql-${ app.connection }-password`),
        port: getEnvVar(`mysql-${ app.connection }-port`),
        database: getEnvVar(`mysql-${ app.connection }-database`),
        timezone: 'Z',
        multipleStatements: true
    };
    configureSSLForConnection(app, config);
    // @ts-ignore
    const connection = await mysql.createConnection(config);
    connections.push(connection);
    return connection;
}

export async function disposeConnections() {
    await Promise.allSettled(connections.map(x => x.end()));
    connections = [];
}
