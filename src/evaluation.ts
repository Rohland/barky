import { PingResult, Result } from "./models/result";
import { flatten } from "./lib/utility";
import { webEvaluator } from "./evaluators/web";
import { mysqlEvaluator } from "./evaluators/mysql";
import { sumoEvaluator } from "./evaluators/sumo";
import { Evaluator, EvaluatorWithType } from "./evaluators/types";
import { startClock, stopClock } from "./lib/profiler";

export async function evaluate(
    config: any,
    evals: string): Promise<Result[]> {
    const types = getEvaluators(config, evals);
    const results = await Promise.all(types.map(type => evaluateType(type, config)));
    return flatten(results);
}

const evaluators = new Map<string, Evaluator>();
evaluators.set("web", webEvaluator);
evaluators.set("sumo", sumoEvaluator);
evaluators.set("mysql", mysqlEvaluator);

export async function evaluateType(
    type: EvaluatorWithType,
    config: any): Promise<Result[]> {
    const timer = startClock();
    const now = new Date();
    const { apps, results } = await type.evaluator(config);
    const elapsed = stopClock(timer);
    return [
        new PingResult(now, type.type, elapsed, apps.length),
        ...results
    ];
}

export function getEvaluators(config, evalName): EvaluatorWithType[] {
    const evaluatorsToConfigure =
        evalName?.trim()?.toLowerCase()?.split(",")
        || Object.keys(config.env ?? {});
    return evaluatorsToConfigure
        .map(x => x?.trim())
        .filter(x => !!x && x !== "config")
        .map(e => {
            const evaluator = evaluators.get(e);
            if (!evaluator) {
                const error = `no evaluator found for '${ e }'`;
                throw new Error(error);
            }
            return {
                type: e,
                evaluator
            };
        });
}
