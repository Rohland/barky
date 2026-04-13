import { PingResult, Result, SkippedResult } from "./models/result.js";
import { flatten } from "./lib/utility.js";
import { WebEvaluator } from "./evaluators/web.js";
import { MySqlEvaluator } from "./evaluators/mysql.js";
import { SumoEvaluator } from "./evaluators/sumo.js";
import { startClock, stopClock } from "./lib/profiler.js";
import { BaseEvaluator } from "./evaluators/base.js";
import { ShellEvaluator } from "./evaluators/shell.js";

export async function evaluate(
    config: any,
    evals: string): Promise<Result[]> {
    const types = getEvaluators(config, evals);
    const results = await Promise.all(types.map(async type => {
        return await evaluateType(type)
    }));
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

export function getEvaluators(config, evalName: string): BaseEvaluator[] {
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
