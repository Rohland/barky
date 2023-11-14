import { BaseEvaluator, EvaluatorType, findTriggerRulesFor, generateValueForVariable } from "./base";
import { IApp } from "../models/app";
import { IUniqueKey } from "../lib/key";
import { MonitorFailureResult, Result, ShellResult } from "../models/result";
import { log } from "../models/logger";
import { execShellScript, IShellResult } from "../lib/shell-runner";
import { renderTemplate } from "../lib/renderer";
import path from "path";

export class ShellEvaluator extends BaseEvaluator {

    protected async dispose(): Promise<void> {
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
                app["vary-by"]);
            return this.validateShellResult(app, result);
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

    validateShellResult(app: IApp, result: IShellResult): Result {
        const identifier = app["vary-by"]?.join("|") ?? app.name;
        const rules = findTriggerRulesFor(identifier, app);
        const variables = {
            stdout: result.stdout,
            exitCode: result.exitCode,
            identifier,
        };
        const parsed = this.parseResultAndMergeWithVariables(app, result, variables);
        let failure = false;
        const msgs = [];
        rules.find(rule => {
            const variableDefinitions = Object.keys(variables).map(x => `const ${ x } = ${ generateValueForVariable(variables[x]) }`).join(";");
            const expression = `;${ rule.expression }`;
            const fail = eval(variableDefinitions + expression);
            failure ||= fail;
            if (fail) {
                msgs.push(renderTemplate(rule.message, variables, { humanizeNumbers: true }));
            }
        });
        const resultOutput = parsed
            ? { ...parsed, exitCode: result.exitCode }
            : result;
        return new ShellResult(
            `${ app.name }`,
            identifier,
            resultOutput,
            msgs,
            app.timeTaken,
            !failure,
            app
        );
    }

    private parseResultAndMergeWithVariables(
        app: IApp,
        result: IShellResult,
        variables: any) {
        if (/json/i.test(app.responseType ?? "")) {
            try {
                const parsed = JSON.parse(result.stdout);
                Object.assign(variables, parsed);
                return parsed;
            } catch (err) {
                throw new Error(`Invalid JSON response from shell script: ${ result.stdout }`)
            }
        }
        return null;
    }
}
