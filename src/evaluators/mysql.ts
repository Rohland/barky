import mysql from "mysql2/promise";
import { startClock, stopClock } from "../lib/profiler";
import { renderTemplate } from "../lib/renderer";
import { MonitorFailureResult, MySqlResult } from "../models/result";
import { log } from "../models/logger";
import { EvaluatorResult } from "./types";
import { getAppVariations, IApp } from "../models/app";
import { BaseEvaluator } from "./base";
import { IUniqueKey } from "../lib/key";

export class MySqlEvaluator extends BaseEvaluator {
    constructor(config: any) {
        super(config);
    }

    public get type(): string {
        return "mysql";
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
            const results = await Promise.all(apps.map(app => tryEvaluate(app)));
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

async function tryEvaluate(app) {
    try {
        const connection = await getConnection(app);
        const timer = startClock();
        const results = await runQuery(connection, app);
        app.timeTaken = stopClock(timer);
        return validateResults(app, results, log);
    } catch (err) {
        log(`Error evaluating app ${ app.name }: ${ err.message }`, err);
        return new MonitorFailureResult(
            "mysql",
            app.name,
            err.message,
            app);
    }
}

function validateResults(app, results, _log) {
    return results.map(row => {
        const identifier = row[app.identifier] ?? "unknown";
        const validator = findValidatorForRow(identifier, row, app.validators);
        return validateRow(app, identifier, row, validator);
    });
}

function findValidatorForRow(identifier, row, validators) {
    const validator = (validators ?? []).find(validator => {
        const regex = new RegExp(validator.match, "gi");
        if (regex.test(row[identifier])) {
            return validator;
        }
    });
    if (!validator) {
        throw new Error(`Could not find validator for row with identifier: ${ identifier }`);
    }
    return validator;
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
    validator) {
    if (!validator.rules || validator.rules.length === 0) {
        throw new Error(`validator for app '${ app.name }' has no rules`);
    }
    convertRowValuesToInferredType(row);
    let failure = false;
    const { variables, values } = generateVariablesAndValues(row, app);
    const msgs = [];
    validator.rules.find(rule => {
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

function generateValueForVariable(value) {
    const valueAsNumber = parseFloat(value);
    const isNumber = !Number.isNaN(valueAsNumber);
    if (isNumber) {
        return valueAsNumber.toFixed(3);
    } else {
        return `'${ value }'`;
    }
}

async function runQuery(connection, app) {
    const results = await connection.query({
        sql: app.query,
        timeout: app.timeout ?? 15000,
    });
    let resultIndex = parseInt(app["result-index"]);
    if (Number.isNaN(resultIndex)) {
        resultIndex = results[0].length;
    }
    const rows = results[0][resultIndex > 0 ? resultIndex - 1 : 0];
    return Array.isArray(rows) ? rows : [rows];
}

const connections = [];

async function getConnection(app) {
    // @ts-ignore
    const connection = await mysql.createConnection({
        host: process.env[`mysql-${ app.connection }-host`],
        user: process.env[`mysql-${ app.connection }-user`],
        password: process.env[`mysql-${ app.connection }-password`],
        port: process.env[`mysql-${ app.connection }-port`],
        database: process.env[`mysql-${ app.connection }-database`],
        timezone: 'Z',
        multipleStatements: true
    });
    connections.push(connection);
    return connection;
}

function disposeConnections() {
    connections.map(x => x.destroy())
}

