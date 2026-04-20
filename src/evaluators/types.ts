import { Result } from "../models/result.js";
import { IApp } from "../models/app.js";

export type Evaluator = (config: any) => Promise<EvaluatorResult>;
export type EvaluatorResult = {
    results: Result[],
    apps: IApp[],
    skippedApps?: IApp[]
};
