import mysql, { ConnectionOptions } from "mysql2/promise";
import { renderTemplate } from "../lib/renderer";
import { MonitorFailureResult, MySqlResult, Result } from "../models/result";
import { log } from "../models/logger";
import { IApp } from "../models/app";
import { BaseEvaluator, EvaluatorType, findTriggerRulesFor, generateValueForVariable } from "./base";
import { IUniqueKey } from "../lib/key";
import { IRule } from "../models/trigger";
import { getEnvVar, getEnvVarAsBoolean } from "../lib/env";

let connections: mysql.Connection[] = [];

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
        try {
            const connection = await this.getConnection(app);
            const results = await this.runQuery(connection, app);
            const finalResults = this.validateResults(app, results);
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
            log(`Error evaluating app ${app.name}: ${err.message}`, err);
            return new MonitorFailureResult(
                "mysql",
                app.name,
                err.message,
                app);
        }
    }

    public validateResults(app: IApp, results: Result[]): Result[] {
        super.fillMissing(app, results);
        if (results.length === 0) {
            return this.processEmptyResult(app);
        }
        return results.map(row => {
            const identifier = this.getIdentifierValueForObject(
                row,
                app.identifier,
                app.name);
            const rules = findTriggerRulesFor(identifier, app);
            return this.validateRow(app, identifier, row, rules);
        });
    }

    private processEmptyResult(app: IApp) {
        const emptyRule = app.triggers.find(x => typeof x.empty === "string");
        if (!emptyRule) {
            return [];
        }
        return [new MySqlResult(
            app.name,
            "-",
            0,
            emptyRule.empty,
            app.timeTaken,
            false,
            app)];
    }

    private validateRow(
        app: IApp,
        identifier: string,
        row: object,
        rules: IRule[]): MySqlResult {
        if (!rules || rules.length === 0) {
            throw new Error(`trigger for app '${app.name}' has no rules`);
        }
        this.convertItemValuesToInferredType(row);
        let failure = false;
        const { variables, values, emit } = this.generateVariablesAndValues(row, app);
        const msgs = [];
        rules.find(rule => {
            const variableDefinitions = variables.map(x => `const ${x} = ${generateValueForVariable(values[x])}`).join(";");
            const expression = `;${rule.expression}`;
            const fail = eval(variableDefinitions + expression);
            failure ||= fail;
            if (fail) {
                msgs.push(renderTemplate(rule.message, values));
            }
        });
        return new MySqlResult(
            `${app.name}`,
            identifier,
            emit,
            msgs,
            app.timeTaken,
            !failure,
            app
        );
    }

    protected generateSkippedAppUniqueKey(name: string): IUniqueKey {
        return {
            type: this.type,
            label: name,
            identifier: "*" // when skipped, we want to match all identifiers under the type:label
        };
    }

    public async dispose(): Promise<void> {
        await Promise.allSettled(connections.map(x => x.end()));
        connections = [];
    }

    protected isResultForApp(app: IApp, result: Result): boolean {
        return app.name === result.label;
    }

    async runQuery(
        connection: mysql.Connection,
        app: IApp) {
        const timeout = Math.max(app.timeout || 15_000, 30_000);
        const query = `set session max_execution_time = ${ timeout }; ${ app.query };`;
        const results = await connection.query({
            sql: query,
            timeout
        });
        log("[mysql] query executed", { host: connection.config.host, query, app: app.name });
        let resultIndex = parseInt(app["result-index"]);
        if (Number.isNaN(resultIndex)) {
            // @ts-ignore
            resultIndex = results[0].length;
        }
        const rows = results[0][resultIndex > 0 ? resultIndex - 1 : 0];
        return Array.isArray(rows) ? rows : [rows];
    }

    configureSSLForConnection(app: IApp, config: any) {
        const sslDisabledValue = getEnvVarAsBoolean(`mysql-${app.connection}-ssl-disabled`);
        if (!sslDisabledValue) {
            return;
        }
        config.ssl ??= {};
        config.ssl["rejectUnauthorized"] = false;
    }

    async getConnection(app: IApp): Promise<mysql.Connection> {
        const config: ConnectionOptions = {
            host: getEnvVar(`mysql-${app.connection}-host`),
            user: getEnvVar(`mysql-${app.connection}-user`),
            password: getEnvVar(`mysql-${app.connection}-password`),
            port: getEnvVar(`mysql-${app.connection}-port`),
            database: getEnvVar(`mysql-${app.connection}-database`),
            timezone: 'Z',
            multipleStatements: true,
        };
        this.configureSSLForConnection(app, config);
        log(`[mysql] connecting to: ${config.host}`);
        // @ts-ignore
        const connection = await mysql.createConnection(config);
        log(`[mysql] connected to: ${config.host}`);
        connections.push(connection);
        return connection;
    }
}





