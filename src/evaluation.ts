import { PingResult, Result, SkippedResult } from "./models/result";
import { flatten } from "./lib/utility";
import { WebEvaluator } from "./evaluators/web";
import { MySqlEvaluator } from "./evaluators/mysql";
import { SumoEvaluator } from "./evaluators/sumo";
import { startClock, stopClock } from "./lib/profiler";
import { BaseEvaluator } from "./evaluators/base";
import { ShellEvaluator } from "./evaluators/shell";

export async function evaluate(
    config: any,
    evals: string): Promise<Result[]> {
    const types = getEvaluators(config, evals);
    const results = await Promise.all(types.map(evaluateType));
    return flatten(results);
}

const evaluators = new Map<string, typeof BaseEvaluator>();
evaluators.set("web", WebEvaluator);
evaluators.set("sumo", SumoEvaluator);
evaluators.set("mysql", MySqlEvaluator);
evaluators.set("shell", ShellEvaluator)

export async function evaluateType(type: BaseEvaluator): Promise<Result[]> {
    const timer = startClock();
    const now = new Date();
    const { apps, results, skippedApps } = await type.evaluateApps();
    const elapsed = stopClock(timer);
    return flatten([
        new PingResult(now, type.type, elapsed, apps.length),
        ...results,
        skippedApps.map(x => new SkippedResult(now, type.type, x.label, x.identifier, x)),
    ]);
}

export function getEvaluators(config, evalName): BaseEvaluator[] {
    const evaluatorsToConfigure =
        evalName?.trim()?.toLowerCase()?.split(",")
        || Object.keys(config.env ?? {});
    const reservedKeys = ["config", "import"];
    return evaluatorsToConfigure
        .map(x => x?.trim())
        .filter(x => !!x && !reservedKeys.includes(x))
        .map(e => {
            const constructor = evaluators.get(e);
            if (!constructor) {
                const error = `no evaluator found for '${ e }'`;
                throw new Error(error);
            }
            // @ts-ignore
            return new constructor(config.env);
        });
}
