import { Result } from "./models/result";
import { flatten } from "./lib/utility";
import { webEvaluator } from "./evaluators/web";
import { mysqlEvaluator } from "./evaluators/mysql";
import { sumoEvaluator } from "./evaluators/sumo";

export async function evaluate(
    config: any,
    evals: string,
    logger: (msg: string, data?: any) => void): Promise<Result[]> {
    const evaluators = getEvaluators(config, evals);
    const results = await Promise.all(evaluators.map(evaluator => evaluator(config, logger)));
    return flatten(results);
}

const evaluators = {
    "web": webEvaluator,
    "mysql": mysqlEvaluator,
    "sumo": sumoEvaluator
};

export function getEvaluators(config, evalName) {
    const evaluatorsToConfigure =
        evalName?.trim()?.toLowerCase()?.split(",")
        || Object.keys(config.env ?? {});
    return evaluatorsToConfigure
        .map(x => x?.trim())
        .filter(x => !!x && x !== "config")
        .map(e => {
            const evaluator = evaluators[e];
            if (!evaluator) {
                const error = `no evaluator found for '${ e }'`;
                throw new Error(error);
            }
            return evaluator;
        });
}
