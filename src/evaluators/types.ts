import { Result } from "../models/result";

export type Evaluator = (config: any) => Promise<EvaluatorResult>;
export type EvaluatorResult = {
    results: Result[],
    apps: any[]
};

export type EvaluatorWithType = { type: string, evaluator: Evaluator };
