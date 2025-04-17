import { BaseEvaluator, EvaluatorType, findTriggerRulesFor, generateValueForVariable } from "./base";
import { IApp } from "../models/app";
import { IUniqueKey } from "../lib/key";
import { MonitorFailureResult, Result, ShellResult } from "../models/result";
import { log } from "../models/logger";
import { execShellScript, IShellResult } from "../lib/shell-runner";
import { renderTemplate } from "../lib/renderer";
import path from "path";

export class ShellEvaluator extends BaseEvaluator {

    public async dispose(): Promise<void> {
        return;
    }

    public generateSkippedAppUniqueKey(name: string): IUniqueKey {
        return {
            type: this.type,
            label: name,
            identifier: "*"
        };
    }

    public isResultForApp(app: IApp, result: Result): boolean {
        return app.name === result.label;
    }

    public async tryEvaluate(app: IApp): Promise<Result | Result[]> {
        try {
            const scriptPath = path.resolve(path.dirname(app.__configPath), app.path);
            const result = await execShellScript(
                scriptPath,
                app.timeout,
                app.variation);
            const results = this.validateShellResult(app, result);
            return results.length > 0
                ? results
                : new ShellResult(
                    app.name,
                    "*",
                    "inferred",
                    "OK",
                    0,
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
            log(`error executing shell evaluator for '${ app.name }': ${ err.message }`, errorInfo);
            return new MonitorFailureResult(
                "shell",
                app.name,
                err.message,
                app);
        }
    }

    get type(): EvaluatorType {
        return EvaluatorType.shell;
    }

    configureApp(app: IApp): void {
        app.timeout ??= 10000;
    }

    validateShellResult(app: IApp, result: IShellResult): Result[] {
        const variables = {
            stdout: result.stdout,
            exitCode: result.exitCode,
        };
        const parsedResults = this.parseResultAndMergeWithVariables(app, result, variables);
        if (parsedResults.length === 1 && parsedResults[0].value === undefined) {
            super.fillMissing(app, parsedResults);
            return this.processEmptyResult(app);
        }
        return parsedResults.map(x => this.validateParsedResult(x, app));
    }

    private processEmptyResult(app: IApp) {
        const emptyRule = app.triggers.find(x => typeof x.empty === "string");
        if (!emptyRule) {
            return [];
        }
        return [new ShellResult(
            app.name,
            "-",
            0,
            emptyRule.empty,
            app.timeTaken,
            false,
            app)];
    }

    private validateParsedResult(parsed: IParsedResult, app: IApp) {
        let identifier = app["variation"]?.join(",") ?? app.name;
        if (parsed.type === "object" && app.identifier) {
            identifier = this.getIdentifierValueForObject(
                parsed.value,
                app.identifier,
                identifier);
        }
        const rules = findTriggerRulesFor(identifier, app);
        const variables = { identifier, ...parsed.variables };
        let failure = false;
        const msgs = [];
        rules.find(rule => {
            const variableDefinitions = Object.keys(variables).map(x => `const ${ x } = ${ generateValueForVariable(variables[x]) }`).join(";");
            const expression = `;${ rule.expression }`;
            const fail = eval(variableDefinitions + expression);
            failure ||= fail;
            if (fail) {
                msgs.push(renderTemplate(rule.message, variables));
            }
        });
        const resultOutput = parsed.type === "object"
            ? { ...(parsed.value as object), exitCode: parsed.variables.exitCode }
            : { ...parsed.variables };
        return new ShellResult(
            `${ app.name }`,
            identifier,
            this.filterResultWithEmitConfig(app, resultOutput),
            msgs,
            app.timeTaken,
            !failure,
            app
        );
    }

    private parseResultAndMergeWithVariables(
        app: IApp,
        result: IShellResult,
        variables: any): IParsedResult[] {
        if (/json/i.test(app.responseType ?? "")) {
            try {
                const parsed = tryParseJsonResult(result);
                if (Array.isArray(parsed)) {
                    return parsed.map(x => ({
                        type: "object",
                        value: x,
                        variables: { ...variables, ...x }
                    }));
                }
                return [{
                    type: "object",
                    value: parsed,
                    variables: { ...variables, ...parsed }
                }];
            } catch (err) {
                throw new Error(`Invalid JSON result from shell script (${err.toString().replace(/^Error:\s+/, "")}), result: ${ result.stdout }`)
            }
        }
        return [
            {
                type: "string",
                value: result.stdout,
                variables
            }
        ]
    }

    private filterResultWithEmitConfig(app: IApp, resultOutput: any): any {
        if (!app.emit || !Array.isArray(app.emit)) {
            return resultOutput;
        }
        const final = {};
        app.emit.forEach(x => {
            final[x] = resultOutput[x];
        });
        return final;
    }
}

interface IParsedResult {
    type: string,
    value: string | object,
    variables: any
}

function tryParseJsonResult(result: IShellResult) {
    try {
        return JSON.parse(result.stdout);
    } catch(err) {
        try {
        const lines = result.stdout.split(/[\r\n]+/g);
        return lines.map(x => JSON.parse(x));
        } catch(err2) {
            throw new Error(`failed to parse JSON result as JSON/JSONL [json:${ err.message };jsonl:${ err2.message }]`)
        }
    }
}
